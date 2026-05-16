// Anonymous read helpers for /p/<token>. Loaded into the public-only
// bundle chunk; must not import auth helpers or admin paths (those
// belong in public-links-admin.ts), or Vite/Rollup will co-locate the
// management URLs into the shared chunk anonymous viewers download.

export type PublicReaction = { emoji: string; count: number };

export type PublicProjectStem = {
  id: string;
  name: string;
  position: number;
  duration_ms: number | null;
  size_bytes: number | null;
  peaks: string | null;
};

export type PublicProjectDetail = {
  project: {
    id: string;
    name: string;
    band_name: string | null;
    recorded_on: string | null;
    created_at: number;
    updated_at: number;
  };
  stems: PublicProjectStem[];
};

export type PublicAnnotation = {
  id: string;
  project_id: string;
  user_display_name: string | null;
  start_ms: number;
  end_ms: number | null;
  body: string;
  starred: boolean;
  created_at: number;
  updated_at: number;
  reply_count: number;
  reactions: PublicReaction[];
};

export type PublicReply = {
  id: string;
  annotation_id: string;
  user_display_name: string | null;
  body: string;
  created_at: number;
  updated_at: number;
  reactions: PublicReaction[];
};

export type PublicSection = {
  id: string;
  project_id: string;
  start_ms: number;
  song_name: string | null;
  label: string | null;
  source: 'manual' | 'auto';
  created_at: number;
  updated_at: number;
};

// Result of probing whether the current cookie holder can see the
// project's authenticated endpoint. Drives the /p/<token> →
// /#p=<id> redirect for signed-in band members.
export type MembershipProbe =
  | { kind: 'anonymous' }
  | { kind: 'signed-in-member' }
  | { kind: 'signed-in-non-member' };

function publicBase(token: string): string {
  return `/api/public/links/${encodeURIComponent(token)}`;
}

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function fetchPublicProject(
  token: string,
): Promise<PublicProjectDetail> {
  const res = await fetch(publicBase(token));
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as PublicProjectDetail;
}

export async function fetchPublicAnnotations(
  token: string,
): Promise<PublicAnnotation[]> {
  const res = await fetch(`${publicBase(token)}/annotations`);
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { annotations: PublicAnnotation[] };
  return data.annotations;
}

export async function fetchPublicReplies(
  token: string,
  annotationId: string,
): Promise<PublicReply[]> {
  const res = await fetch(
    `${publicBase(token)}/annotations/${encodeURIComponent(annotationId)}/replies`,
  );
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { replies: PublicReply[] };
  return data.replies;
}

export async function fetchPublicSections(
  token: string,
): Promise<PublicSection[]> {
  const res = await fetch(`${publicBase(token)}/sections`);
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { sections: PublicSection[] };
  return data.sections;
}

export function publicAudioUrl(token: string, stemId: string): string {
  return `${publicBase(token)}/audio/${encodeURIComponent(stemId)}`;
}

// Cookie holder's relationship to the project. Encapsulates the
// /api/me + /api/projects/<id> double round-trip so the public-view
// loader doesn't grow another nested try/catch.
//
// Three states drive different UI:
//   - 'anonymous'              → show Sign in CTA, mutation bounces to /
//   - 'signed-in-member'       → caller redirects to /#p=<id>
//   - 'signed-in-non-member'   → show "no access" treatment; signing in
//                                again would loop, so we don't pretend
//                                Sign in helps.
export async function probeMembership(projectId: string): Promise<MembershipProbe> {
  let me: Response;
  try {
    me = await fetch('/api/me', { credentials: 'include' });
  } catch {
    return { kind: 'anonymous' };
  }
  if (!me.ok) return { kind: 'anonymous' };
  let meBody: { user?: { id: string } | null };
  try {
    meBody = (await me.json()) as { user?: { id: string } | null };
  } catch {
    return { kind: 'anonymous' };
  }
  if (!meBody.user) return { kind: 'anonymous' };
  let authed: Response;
  try {
    authed = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      credentials: 'include',
    });
  } catch {
    return { kind: 'signed-in-non-member' };
  }
  return authed.ok
    ? { kind: 'signed-in-member' }
    : { kind: 'signed-in-non-member' };
}
