/**
 * One-shot backfill of song_fingerprints rows for existing sections.
 *
 * Walks every section where:
 *   - source IN ('manual','auto')
 *   - song_id IS NOT NULL
 *   - no row in song_fingerprints with this section_id
 *
 * For each, picks the project's "primary stem" (the lowest-position
 * non-deleted stem — Paperstem has no separate "mixed audio" row, so the
 * first stem track is the practice's main audio source) and runs the Phase 2
 * Python classification sidecar against it. The sidecar emits per-music-
 * segment chroma in the same shape the web POST flow uses. The script
 * finds the music segment that overlaps the section's [start_ms, end_ms]
 * window, slices its chroma proportionally to the section's range, and
 * POSTs to the new fingerprint endpoint (in-process, via the same packer +
 * repository the route uses).
 *
 * Idempotent: a re-run skips sections that already have a fingerprint via
 * the SQL filter, and the repository's delete-then-insert transaction makes
 * even a forced replay safe.
 *
 * The sidecar is invoked exactly the way the CLI auto-classify path will
 * eventually invoke it:
 *     bin/auto-classify/.venv/bin/python bin/auto-classify/classify.py <wav>
 * If the .venv is missing the script prints a hint and exits 0 (so
 * scheduled runs don't fail loudly).
 *
 * Usage:
 *   DATABASE_PATH=./dev.sqlite PAPERSTEM_AUDIO_ROOT=./audio-dev \
 *     npx tsx bin/backfill-fingerprints.ts
 */
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../src/server/db.js';
import { packChroma } from '../src/server/auto-classify/chroma-blob.js';
import { insertFingerprint } from '../src/server/auto-classify/repository.js';
import { resolveFileIdToPath, StorageNotFoundError } from '../src/server/storage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CURRENT_FINGERPRINT_VERSION = 1;
const PYTHON_BIN = resolve(__dirname, 'auto-classify/.venv/bin/python');
const CLASSIFY_SCRIPT = resolve(__dirname, 'auto-classify/classify.py');

type ClassifyOutputSegment = {
  start_ms: number;
  end_ms: number;
  segment_type: string;
  chroma?: number[][];
};

type ClassifyOutput = {
  segments: ClassifyOutputSegment[];
  audio_hash: string;
  duration_ms: number;
};

type CandidateRow = {
  section_id: string;
  project_id: string;
  song_id: string;
  start_ms: number;
  band_id: string;
};

type SectionEndRow = { start_ms: number };

type StemRow = { file_id: string; duration_ms: number | null };

function listCandidates(): CandidateRow[] {
  return db
    .prepare(
      `SELECT s.id            AS section_id,
              s.project_id    AS project_id,
              s.song_id       AS song_id,
              s.start_ms      AS start_ms,
              p.band_id       AS band_id
         FROM sections s
         JOIN projects p ON p.id = s.project_id
         LEFT JOIN song_fingerprints fp ON fp.section_id = s.id
        WHERE s.source IN ('manual','auto')
          AND s.song_id IS NOT NULL
          AND fp.id IS NULL
          AND p.deleted_at IS NULL
        ORDER BY s.created_at`,
    )
    .all() as CandidateRow[];
}

function findEndMs(projectId: string, sectionId: string, startMs: number): number | null {
  const next = db
    .prepare(
      `SELECT start_ms FROM sections
         WHERE project_id = ? AND start_ms > ? AND id != ?
         ORDER BY start_ms ASC LIMIT 1`,
    )
    .get(projectId, startMs, sectionId) as SectionEndRow | undefined;
  if (next) return next.start_ms;
  // No next section: fall back to the longest live stem on the project.
  const stem = db
    .prepare(
      `SELECT duration_ms FROM stems
         WHERE project_id = ? AND deleted_at IS NULL AND duration_ms IS NOT NULL
         ORDER BY duration_ms DESC LIMIT 1`,
    )
    .get(projectId) as { duration_ms: number } | undefined;
  if (stem) return stem.duration_ms;
  return null;
}

function findPrimaryStem(projectId: string): StemRow | null {
  return (
    (db
      .prepare(
        `SELECT file_id, duration_ms FROM stems
           WHERE project_id = ? AND deleted_at IS NULL
           ORDER BY position ASC LIMIT 1`,
      )
      .get(projectId) as StemRow | undefined) ?? null
  );
}

function runSidecar(audioPath: string): ClassifyOutput {
  if (!existsSync(PYTHON_BIN)) {
    throw new Error(
      `python sidecar missing: ${PYTHON_BIN}. Run bin/auto-classify/setup.sh to create the venv.`,
    );
  }
  if (!existsSync(CLASSIFY_SCRIPT)) {
    throw new Error(`classify.py missing: ${CLASSIFY_SCRIPT}`);
  }
  const r = spawnSync(PYTHON_BIN, [CLASSIFY_SCRIPT, audioPath], {
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(
      `classify.py exited with ${r.status}: ${r.stderr.trim() || r.stdout.trim()}`,
    );
  }
  return JSON.parse(r.stdout) as ClassifyOutput;
}

/**
 * Given the sidecar's per-music-segment chroma and a section's [start, end],
 * find the music segment with maximal overlap and slice its chroma rows
 * proportionally to the section's range. The chroma row index corresponds
 * linearly to time within the segment, so slicing by ratio is exact-enough
 * for matching (DTW is robust to a few frames of offset).
 */
export function sliceChromaForSection(
  segments: ClassifyOutputSegment[],
  startMs: number,
  endMs: number,
): number[][] | null {
  if (endMs <= startMs) return null;
  let best: { seg: ClassifyOutputSegment; overlap: number } | null = null;
  for (const seg of segments) {
    if (seg.segment_type !== 'music' || !seg.chroma || seg.chroma.length === 0) continue;
    const overlapStart = Math.max(seg.start_ms, startMs);
    const overlapEnd = Math.min(seg.end_ms, endMs);
    const overlap = overlapEnd - overlapStart;
    if (overlap <= 0) continue;
    if (!best || overlap > best.overlap) best = { seg, overlap };
  }
  if (!best) return null;
  const seg = best.seg;
  const segDur = seg.end_ms - seg.start_ms;
  if (segDur <= 0 || !seg.chroma) return null;
  const fromRatio = Math.max(0, (startMs - seg.start_ms) / segDur);
  const toRatio = Math.min(1, (endMs - seg.start_ms) / segDur);
  const fromIdx = Math.floor(fromRatio * seg.chroma.length);
  const toIdx = Math.max(fromIdx + 1, Math.ceil(toRatio * seg.chroma.length));
  const slice = seg.chroma.slice(fromIdx, toIdx);
  return slice.length > 0 ? slice : null;
}

async function processOne(row: CandidateRow): Promise<{ ok: boolean; reason?: string }> {
  const endMs = findEndMs(row.project_id, row.section_id, row.start_ms);
  if (endMs === null) return { ok: false, reason: 'no end_ms (no next section + no stem duration)' };
  if (endMs <= row.start_ms) return { ok: false, reason: 'computed end_ms <= start_ms' };

  const stem = findPrimaryStem(row.project_id);
  if (!stem) return { ok: false, reason: 'project has no live stems' };

  let audioPath: string;
  try {
    audioPath = await resolveFileIdToPath(stem.file_id);
  } catch (e) {
    if (e instanceof StorageNotFoundError) return { ok: false, reason: 'stem audio missing on disk' };
    throw e;
  }

  const out = runSidecar(audioPath);
  const chroma = sliceChromaForSection(out.segments, row.start_ms, endMs);
  if (!chroma) return { ok: false, reason: 'no overlapping music segment with chroma' };

  const blob = Buffer.from(packChroma(chroma));
  const replace = db.transaction(() => {
    db.prepare('DELETE FROM song_fingerprints WHERE section_id = ?').run(row.section_id);
    insertFingerprint(db, {
      id: randomUUID(),
      band_id: row.band_id,
      song_id: row.song_id,
      section_id: row.section_id,
      fingerprint_blob: blob,
      fingerprint_version: CURRENT_FINGERPRINT_VERSION,
      duration_ms: endMs - row.start_ms,
      created_at: Date.now(),
    });
  });
  replace();
  return { ok: true };
}

async function main(): Promise<void> {
  const candidates = listCandidates();
  console.log(`backfill-fingerprints: ${candidates.length} section(s) to process`);
  if (candidates.length === 0) {
    console.log('done (no work).');
    return;
  }

  let ok = 0;
  let skipped = 0;
  for (const row of candidates) {
    try {
      const result = await processOne(row);
      if (result.ok) {
        ok += 1;
        console.log(`ok    ${row.section_id} (project=${row.project_id})`);
      } else {
        skipped += 1;
        console.log(`skip  ${row.section_id}: ${result.reason}`);
      }
    } catch (e) {
      skipped += 1;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`error ${row.section_id}: ${msg}`);
    }
  }
  console.log(
    `done. processed=${ok} skipped=${skipped} version=${CURRENT_FINGERPRINT_VERSION}`,
  );
}

// Only run as a script when invoked directly (not when imported by tests).
const invokedAsScript = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedAsScript) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
