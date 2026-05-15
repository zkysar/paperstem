import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { Context } from 'hono';
import { db, stmts } from '../db.js';
import { requireUser, type AuthVariables } from '../auth/middleware.js';
import { insertFingerprint } from './repository.js';
import { CHROMA_DIMS, packChroma } from './chroma-blob.js';

// Phase 4 — fingerprint corpus building (web path).
//
// Endpoint: POST /api/projects/:id/sections/:sectionId/fingerprint
//
// Body:
//   {
//     chroma: number[][],           // beat-rate chroma; each row must be 12 floats
//     fingerprint_version: integer,
//     duration_ms: integer
//   }
//
// Behaviour:
//   - Section must reference a song (song_id non-null) and belong to the
//     project in the URL. Otherwise 400 / 404.
//   - Inserts a new row in `song_fingerprints` keyed to the section. If a
//     fingerprint already exists for the section, replaces it (delete +
//     insert in a transaction) so the endpoint is idempotent and bands can
//     re-upload chroma when an extraction algorithm changes.
//
// Wire format chosen to match the existing classify route (Phase 3): the
// chroma is sent as the same `number[][]` shape that arrives on
// `ClassifiedSegment.chroma`, so the client can forward what it already has
// without re-encoding.

type FingerprintRequestBody = {
  chroma: number[][];
  fingerprint_version: number;
  duration_ms: number;
};

function isChromaSequence(value: unknown): value is number[][] {
  if (!Array.isArray(value) || value.length === 0) return false;
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== CHROMA_DIMS) return false;
    for (const cell of row) {
      if (typeof cell !== 'number' || !Number.isFinite(cell)) return false;
    }
  }
  return true;
}

function validateBody(raw: unknown): FingerprintRequestBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (!isChromaSequence(b.chroma)) return null;
  if (
    typeof b.fingerprint_version !== 'number' ||
    !Number.isInteger(b.fingerprint_version) ||
    b.fingerprint_version < 1
  ) {
    return null;
  }
  if (
    typeof b.duration_ms !== 'number' ||
    !Number.isInteger(b.duration_ms) ||
    b.duration_ms < 0
  ) {
    return null;
  }
  return {
    chroma: b.chroma,
    fingerprint_version: b.fingerprint_version,
    duration_ms: b.duration_ms,
  };
}

export type FingerprintResponse = { id: string };

export async function handleSectionFingerprint(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const user = requireUser(c);
  const projectId = c.req.param('id') ?? '';
  const sectionId = c.req.param('sectionId') ?? '';
  if (!projectId || !sectionId) return c.json({ error: 'not_found' }, 404);

  const project = stmts.findProjectById.get(projectId);
  if (!project) return c.json({ error: 'not_found' }, 404);
  if (!stmts.findMembership.get(project.band_id, user.id)) {
    return c.json({ error: 'not_found' }, 404);
  }

  const section = stmts.findSectionById.get(sectionId);
  if (!section) return c.json({ error: 'not_found' }, 404);
  if (section.project_id !== projectId) return c.json({ error: 'not_found' }, 404);

  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const body = validateBody(parsed);
  if (!body) return c.json({ error: 'invalid_input' }, 400);

  if (!section.song_id) {
    return c.json({ error: 'section_must_reference_a_song' }, 400);
  }

  const id = randomUUID();
  const blob = Buffer.from(packChroma(body.chroma));

  // Idempotent replace: delete-then-insert inside a transaction so a
  // re-submission for the same section leaves at most one row.
  const replace = db.transaction(() => {
    db.prepare('DELETE FROM song_fingerprints WHERE section_id = ?').run(sectionId);
    insertFingerprint(db, {
      id,
      band_id: project.band_id,
      song_id: section.song_id as string,
      section_id: sectionId,
      fingerprint_blob: blob,
      fingerprint_version: body.fingerprint_version,
      duration_ms: body.duration_ms,
      created_at: Date.now(),
    });
  });
  replace();

  const response: FingerprintResponse = { id };
  return c.json(response);
}
