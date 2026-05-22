// Authenticated management of public-share links: owner-side create /
// list / revoke / URL build. Kept in its own module so the public read
// helpers in public-repo.ts can be tree-shaken cleanly — Rollup would
// otherwise co-locate management URLs (DELETE /api/public-links/<token>)
// into the shared chunk anonymous /p/<token> viewers download.

export type PublicLinkSummary = {
  token: string;
  created_at: number;
  created_by_email: string | null;
  revoked_at: number | null;
  last_accessed_at: number | null;
};

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

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
