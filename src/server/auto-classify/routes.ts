import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { db, stmts } from '../db.js';
import { requireUser, type AuthVariables } from '../auth/middleware.js';
import {
  insertClassificationRun,
  updateClassificationRunStatus,
  listFingerprintsForBand,
} from './repository.js';
import { matchSegmentToCorpus, type CorpusEntry, type MatchResult } from './matcher.js';
import { proposeSectionName, shouldEmitSection } from './naming.js';
import type {
  ClassifiedSegment,
  ClassificationSourceSurface,
  SegmentType,
} from '../../shared/types.js';

type ClassifyRequestBody = {
  segments: ClassifiedSegment[];
  audio_hash: string;
  classifier_version: string;
  fingerprint_version: number;
  source_surface: ClassificationSourceSurface;
};

export type CreatedAutoSection = {
  id: string;
  start_ms: number;
  end_ms: number;
  song_id: string | null;
  song_name: string | null;
  label: string | null;
  segment_type: SegmentType;
  confidence: number;
  tentative: boolean;
};

export type ClassifyResponse = {
  run_id: string;
  sections: CreatedAutoSection[];
  reused: boolean;
};

const VALID_SOURCE_SURFACES: readonly ClassificationSourceSurface[] = ['web', 'cli'];

function isClassifiedSegment(value: unknown): value is ClassifiedSegment {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.start_ms === 'number' &&
    typeof v.end_ms === 'number' &&
    typeof v.segment_type === 'string' &&
    Array.isArray(v.top_classes)
  );
}

function validateBody(raw: unknown): ClassifyRequestBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (!Array.isArray(b.segments)) return null;
  if (!b.segments.every(isClassifiedSegment)) return null;
  if (typeof b.audio_hash !== 'string' || b.audio_hash.length === 0) return null;
  if (typeof b.classifier_version !== 'string' || b.classifier_version.length === 0) return null;
  if (typeof b.fingerprint_version !== 'number' || !Number.isInteger(b.fingerprint_version)) return null;
  if (
    typeof b.source_surface !== 'string' ||
    !VALID_SOURCE_SURFACES.includes(b.source_surface as ClassificationSourceSurface)
  ) {
    return null;
  }
  return b as unknown as ClassifyRequestBody;
}

// Idempotency: if a finished classification_runs row exists for the same
// (project_id, audio_hash, classifier_version, fingerprint_version) tuple,
// return the auto sections it produced rather than running again. Double-
// submit safety net for the client (the design doc's "user might
// double-submit" case).
function findCompletedRun(
  projectId: string,
  audio_hash: string,
  classifier_version: string,
  fingerprint_version: number,
): { id: string } | undefined {
  return db
    .prepare(
      `SELECT id FROM classification_runs
        WHERE project_id = ?
          AND audio_hash = ?
          AND classifier_version = ?
          AND fingerprint_version = ?
          AND status = 'done'
        ORDER BY completed_at DESC
        LIMIT 1`,
    )
    .get(projectId, audio_hash, classifier_version, fingerprint_version) as
    | { id: string }
    | undefined;
}

type AutoSectionDbRow = {
  id: string;
  start_ms: number;
  song_id: string | null;
  song_name: string | null;
  label: string | null;
  segment_type: SegmentType | null;
  confidence: number | null;
};

function loadAutoSectionsForRun(runId: string): AutoSectionDbRow[] {
  return db
    .prepare(
      `SELECT sec.id, sec.start_ms, sec.song_id, sec.label,
              sec.segment_type, sec.confidence,
              song.name AS song_name
         FROM sections sec
         LEFT JOIN songs song ON song.id = sec.song_id
        WHERE sec.run_id = ?
        ORDER BY sec.start_ms ASC, sec.created_at ASC`,
    )
    .all(runId) as AutoSectionDbRow[];
}

// Conflict rule from design doc — "Conflict rule with concurrent manual
// edits": auto section is dropped if any manual section's start_ms falls
// within ±2 s of the auto segment's [start_ms, end_ms] interval.
const MANUAL_OVERLAP_THRESHOLD_MS = 2000;

function overlapsManual(
  seg: ClassifiedSegment,
  manual: { start_ms: number }[],
): boolean {
  for (const m of manual) {
    if (
      m.start_ms >= seg.start_ms - MANUAL_OVERLAP_THRESHOLD_MS &&
      m.start_ms <= seg.end_ms + MANUAL_OVERLAP_THRESHOLD_MS
    ) {
      return true;
    }
  }
  return false;
}

function toCreatedSection(row: AutoSectionDbRow, end_ms: number, tentative: boolean): CreatedAutoSection {
  return {
    id: row.id,
    start_ms: row.start_ms,
    end_ms,
    song_id: row.song_id,
    song_name: row.song_name,
    label: row.label,
    segment_type: row.segment_type ?? 'unknown',
    confidence: row.confidence ?? 0,
    tentative,
  };
}

export async function handleClassifyProject(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const user = requireUser(c);
  const projectId = c.req.param('id') ?? '';
  if (!projectId) return c.json({ error: 'not_found' }, 404);

  const project = stmts.findProjectById.get(projectId);
  if (!project) return c.json({ error: 'not_found' }, 404);
  if (!stmts.findMembership.get(project.band_id, user.id)) {
    return c.json({ error: 'not_found' }, 404);
  }

  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const body = validateBody(parsed);
  if (!body) return c.json({ error: 'invalid_input' }, 400);

  // Idempotency check on (project_id, audio_hash, classifier_version,
  // fingerprint_version).
  const existing = findCompletedRun(
    projectId,
    body.audio_hash,
    body.classifier_version,
    body.fingerprint_version,
  );
  if (existing) {
    const rows = loadAutoSectionsForRun(existing.id);
    const sections = rows.map((r) => toCreatedSection(r, r.start_ms, false));
    const response: ClassifyResponse = {
      run_id: existing.id,
      sections,
      reused: true,
    };
    return c.json(response);
  }

  const now = Date.now();
  const runId = randomUUID();
  insertClassificationRun(db, {
    id: runId,
    project_id: projectId,
    status: 'running',
    source_surface: body.source_surface,
    audio_hash: body.audio_hash,
    classifier_version: body.classifier_version,
    fingerprint_version: body.fingerprint_version,
    error: null,
    created_at: now,
    completed_at: null,
  });

  try {
    // Build the song-id → name map for matched fingerprints, then assemble
    // the in-memory corpus.
    const corpusRows = listFingerprintsForBand(db, project.band_id);
    const songNames = new Map<string, string>();
    if (corpusRows.length > 0) {
      const songRows = db
        .prepare(`SELECT id, name FROM songs WHERE band_id = ?`)
        .all(project.band_id) as { id: string; name: string }[];
      for (const s of songRows) songNames.set(s.id, s.name);
    }
    const corpus: CorpusEntry[] = corpusRows.map((r) => ({
      song_id: r.song_id,
      song_name: songNames.get(r.song_id) ?? 'Unknown',
      fingerprint_blob: r.fingerprint_blob,
      duration_ms: r.duration_ms,
    }));

    const manualSections = db
      .prepare(
        `SELECT start_ms FROM sections
           WHERE project_id = ? AND source = 'manual'
           ORDER BY start_ms`,
      )
      .all(projectId) as { start_ms: number }[];

    const insertSectionStmt = db.prepare(
      `INSERT INTO sections
         (id, project_id, start_ms, song_id, label, source, created_at, created_by, updated_at,
          confidence, run_id, segment_type, top_classes_json)
       VALUES (?, ?, ?, ?, ?, 'auto', ?, ?, ?, ?, ?, ?, ?)`,
    );

    const created: CreatedAutoSection[] = [];

    for (const seg of body.segments) {
      if (!shouldEmitSection(seg.segment_type)) continue;
      if (overlapsManual(seg, manualSections)) continue;

      let matchResult: MatchResult = {
        match: null,
        confidence: 0,
        raw_distance: Infinity,
      };
      if (seg.segment_type === 'music' && Array.isArray(seg.chroma) && corpus.length > 0) {
        matchResult = matchSegmentToCorpus(seg.chroma, corpus);
      }

      const named = proposeSectionName({
        segment_type: seg.segment_type,
        match: matchResult.match,
        confidence: matchResult.confidence,
      });

      const sectionId = randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      insertSectionStmt.run(
        sectionId,
        projectId,
        seg.start_ms,
        named.song_id,
        named.label,
        nowSec,
        user.id,
        nowSec,
        matchResult.confidence,
        runId,
        seg.segment_type,
        JSON.stringify(seg.top_classes),
      );

      created.push({
        id: sectionId,
        start_ms: seg.start_ms,
        end_ms: seg.end_ms,
        song_id: named.song_id,
        song_name: named.song_name,
        label: named.label,
        segment_type: seg.segment_type,
        confidence: matchResult.confidence,
        tentative: named.tentative,
      });
    }

    updateClassificationRunStatus(db, runId, 'done', {
      completed_at: Date.now(),
      error: null,
    });

    const response: ClassifyResponse = { run_id: runId, sections: created, reused: false };
    return c.json(response);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    updateClassificationRunStatus(db, runId, 'failed', {
      completed_at: Date.now(),
      error: message,
    });
    throw e;
  }
}
