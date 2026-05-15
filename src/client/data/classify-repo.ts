// Client wrapper for the auto-classification API. Mirrors the shape of
// sections-repo: thin fetch helpers that throw on non-2xx, accepting and
// returning the wire types defined in src/shared/types.ts.
import type { ClassifiedSegment, SegmentType } from '../../shared/types';

// Response shape from POST /api/projects/:id/classify. See Phase 3 summary
// at scripts/poc/phase-3-summary.md for the full contract.
export type ClassifyResponseSection = {
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
  reused: boolean;
  sections: ClassifyResponseSection[];
};

export type ClassifyRequest = {
  segments: ClassifiedSegment[];
  audio_hash: string;
  classifier_version: string;
  fingerprint_version: number;
  source_surface: 'web' | 'cli';
};

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function postClassify(
  projectId: string,
  body: ClassifyRequest,
): Promise<ClassifyResponse> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/classify`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as ClassifyResponse;
}

// Phase 4 endpoint — may not exist yet in the dev DB. 404 is a soft failure
// (Phase 4 hasn't landed); we log and move on. Any other error is surfaced
// to the caller so it can decide whether to block (we don't — fingerprint
// uploads are best-effort).
export async function postSectionFingerprint(
  projectId: string,
  sectionId: string,
  body: { chroma: number[][]; fingerprint_version: number },
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  let res: Response;
  try {
    res = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/sections/${encodeURIComponent(
        sectionId,
      )}/fingerprint`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: msg };
  }
  if (res.ok) return { ok: true };
  return { ok: false, status: res.status, error: await readError(res) };
}
