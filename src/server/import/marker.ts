import {
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export const markerFilename = '.paperstem-importing';
export const markerImportedFilename = '.paperstem-imported';

export type MarkerSegment = {
  index: number;
  of: number;
  start_sample: number;
  end_sample: number;
  name: string;
  project_id: string | null;
  uploaded_at: string | null;
};

export type Marker = {
  song_folder: string;
  host: string;
  paperstem_url: string;
  segments: MarkerSegment[];
  deleted_at?: string;
  deleted_files?: string[];
};

export function readMarker(folderPath: string): Marker | null {
  for (const name of [markerImportedFilename, markerFilename]) {
    const p = join(folderPath, name);
    if (!existsSync(p)) continue;
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8')) as Marker;
      if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray(parsed.segments)
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

export function writeMarker(folderPath: string, marker: Marker): void {
  const complete = marker.segments.every((s) => s.uploaded_at !== null);
  const targetName = complete ? markerImportedFilename : markerFilename;
  const targetPath = join(folderPath, targetName);
  writeFileSync(targetPath, JSON.stringify(marker, null, 2));
  const otherName = complete ? markerFilename : markerImportedFilename;
  const otherPath = join(folderPath, otherName);
  if (existsSync(otherPath)) unlinkSync(otherPath);
}

/**
 * If every segment has uploaded_at, rename .paperstem-importing →
 * .paperstem-imported and return true. Otherwise no-op, return false.
 */
export function promoteToImported(folderPath: string): boolean {
  const m = readMarker(folderPath);
  if (!m) return false;
  if (!m.segments.every((s) => s.uploaded_at !== null)) return false;
  const importing = join(folderPath, markerFilename);
  const imported = join(folderPath, markerImportedFilename);
  if (existsSync(importing) && !existsSync(imported)) {
    renameSync(importing, imported);
    return true;
  }
  return existsSync(imported);
}

export function markerState(m: Marker): 'imported' | 'importing' {
  return m.segments.every((s) => s.uploaded_at !== null)
    ? 'imported'
    : 'importing';
}

export function markerHasTombstone(m: Marker): boolean {
  return !!m.deleted_at;
}
