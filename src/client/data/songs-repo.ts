import type { Song } from '../../shared/types';

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

// Result of a rename that collided with an existing song with the same
// normalized name. The popover surfaces this as a "merge into existing
// song?" prompt rather than a hard failure.
export type RenameConflict = {
  kind: 'conflict';
  existing_song_id: string;
  existing_song_name: string;
};

export type RenameResult =
  | { kind: 'ok'; song: Song }
  | RenameConflict;

export async function listSongs(bandId: string): Promise<Song[]> {
  const res = await fetch(`/api/bands/${encodeURIComponent(bandId)}/songs`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { songs: Song[] };
  return data.songs;
}

export async function createSong(
  bandId: string,
  name: string,
): Promise<Song> {
  const res = await fetch(`/api/bands/${encodeURIComponent(bandId)}/songs`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { song: Song };
  return data.song;
}

export async function renameSong(
  id: string,
  name: string,
): Promise<RenameResult> {
  const res = await fetch(`/api/songs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (res.status === 409) {
    const data = (await res.json()) as {
      existing_song_id: string;
      existing_song_name: string;
    };
    return {
      kind: 'conflict',
      existing_song_id: data.existing_song_id,
      existing_song_name: data.existing_song_name,
    };
  }
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { song: Song };
  return { kind: 'ok', song: data.song };
}

export async function mergeSong(
  loserId: string,
  intoId: string,
): Promise<Song> {
  const res = await fetch(`/api/songs/${encodeURIComponent(loserId)}/merge`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ into: intoId }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { song: Song };
  return data.song;
}

export async function deleteSong(id: string): Promise<void> {
  const res = await fetch(`/api/songs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok && res.status !== 204) throw new Error(await readError(res));
}

export type SongUsageRow = { project_id: string; song_id: string };

export async function listSongUsage(bandId: string): Promise<SongUsageRow[]> {
  const res = await fetch(
    `/api/bands/${encodeURIComponent(bandId)}/songs/usage`,
    { credentials: 'include' },
  );
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { usage: SongUsageRow[] };
  return data.usage;
}
