import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readMarker,
  writeMarker,
  promoteToImported,
  markerFilename,
  markerImportedFilename,
  type Marker,
} from './marker.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'marker-'));
}

const sampleMarker: Marker = {
  song_folder: '040109_0001',
  host: 'zach-mbp',
  paperstem_url: 'https://paperstem.fly.dev',
  segments: [
    {
      index: 1,
      of: 2,
      start_sample: 0,
      end_sample: 1000,
      name: '2026-05-12 take 1',
      project_id: 'pr_abc',
      uploaded_at: '2026-05-12T22:00:00Z',
    },
    {
      index: 2,
      of: 2,
      start_sample: 1000,
      end_sample: 2000,
      name: '2026-05-12 take 2',
      project_id: null,
      uploaded_at: null,
    },
  ],
};

describe('marker', () => {
  it('readMarker returns null when neither file exists', () => {
    const dir = tempDir();
    expect(readMarker(dir)).toBeNull();
  });

  it('writeMarker creates .paperstem-importing while incomplete', () => {
    const dir = tempDir();
    writeMarker(dir, sampleMarker);
    const files = readdirSync(dir);
    expect(files).toContain(markerFilename);
    expect(files).not.toContain(markerImportedFilename);
  });

  it('readMarker round-trips data', () => {
    const dir = tempDir();
    writeMarker(dir, sampleMarker);
    const got = readMarker(dir);
    expect(got?.song_folder).toBe('040109_0001');
    expect(got?.segments[0]?.project_id).toBe('pr_abc');
    expect(got?.segments[1]?.project_id).toBeNull();
  });

  it('promoteToImported renames once all segments uploaded', () => {
    const dir = tempDir();
    const complete: Marker = {
      ...sampleMarker,
      segments: sampleMarker.segments.map((s) => ({
        ...s,
        project_id: 'pr_xyz',
        uploaded_at: '2026-05-12T22:01:00Z',
      })),
    };
    writeMarker(dir, complete);
    const renamed = promoteToImported(dir);
    expect(renamed).toBe(true);
    const files = readdirSync(dir);
    expect(files).toContain(markerImportedFilename);
    expect(files).not.toContain(markerFilename);
  });

  it('promoteToImported is a no-op when segments still pending', () => {
    const dir = tempDir();
    writeMarker(dir, sampleMarker);
    expect(promoteToImported(dir)).toBe(false);
    expect(readdirSync(dir)).toContain(markerFilename);
  });

  it('readMarker prefers .paperstem-imported when both somehow exist', () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, markerImportedFilename),
      JSON.stringify(sampleMarker),
    );
    writeFileSync(
      join(dir, markerFilename),
      JSON.stringify({ ...sampleMarker, song_folder: 'OTHER' }),
    );
    expect(readMarker(dir)?.song_folder).toBe('040109_0001');
  });

  it('returns null and does not throw on unparseable JSON', () => {
    const dir = tempDir();
    writeFileSync(join(dir, markerImportedFilename), 'not json');
    const got = readMarker(dir);
    expect(got).toBeNull();
  });
});
