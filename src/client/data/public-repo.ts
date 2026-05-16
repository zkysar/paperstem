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

export type PublicLinkSummary = {
  token: string;
  created_at: number;
  created_by_email: string | null;
  revoked_at: number | null;
  last_accessed_at: number | null;
};

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

// --- Admin-side: managing links from inside the app (auth required) ---

export async function listProjectPublicLinks(
  projectId: string,
): Promise<PublicLinkSummary[]> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/public-links`,
    { credentials: 'include' },
  );
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { links: PublicLinkSummary[] };
  return data.links;
}

export async function createPublicLink(
  projectId: string,
): Promise<PublicLinkSummary> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/public-links`,
    { method: 'POST', credentials: 'include' },
  );
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { link: PublicLinkSummary };
  return data.link;
}

export async function revokePublicLink(token: string): Promise<void> {
  const res = await fetch(`/api/public-links/${encodeURIComponent(token)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok && res.status !== 204) throw new Error(await readError(res));
}

export function buildPublicLinkUrl(token: string): string {
  if (typeof window === 'undefined') {
    return `/p/${encodeURIComponent(token)}`;
  }
  return `${window.location.origin}/p/${encodeURIComponent(token)}`;
}
