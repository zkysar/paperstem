import type { Section } from '../../shared/types';

export type CreateSectionInput = {
  start_ms: number;
  // Exactly one of these three may be set (or none, for an unnamed boundary).
  song_id?: string;
  song_name?: string;
  label?: string;
};

export type PatchSectionInput = {
  start_ms?: number;
  song_id?: string;
  song_name?: string;
  label?: string;
  // Explicitly unset song and label, turning the section into an unnamed
  // boundary. Without this flag, omitting song/label fields leaves the
  // current value untouched.
  clear_name?: boolean;
};

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function listSections(projectId: string): Promise<Section[]> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/sections`,
    { credentials: 'include' },
  );
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { sections: Section[] };
  return data.sections;
}

export async function createSection(
  projectId: string,
  input: CreateSectionInput,
): Promise<Section> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/sections`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { section: Section };
  return data.section;
}

export async function patchSection(
  id: string,
  input: PatchSectionInput,
): Promise<Section> {
  const res = await fetch(`/api/sections/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { section: Section };
  return data.section;
}

export async function deleteSection(id: string): Promise<void> {
  const res = await fetch(`/api/sections/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok && res.status !== 204) throw new Error(await readError(res));
}
