import { describe, it, expect, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runImporter } from './import-from-device.js';
import { markerImportedFilename } from '../src/server/import/marker.js';

function tempCard(): string {
  return mkdtempSync(join(tmpdir(), 'orch-card-'));
}

function placeOneStemFolder(
  card: string,
  songName: string,
  mtime: Date,
): string {
  const dir = join(card, 'MTR', songName);
  mkdirSync(dir, { recursive: true });
  const fmt = Buffer.alloc(8 + 16);
  fmt.write('fmt ', 0, 4, 'ascii');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(44100, 12);
  fmt.writeUInt32LE(88200, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);
  const dataBytes = 44100 * 2;
  const data = Buffer.alloc(8 + dataBytes);
  data.write('data', 0, 4, 'ascii');
  data.writeUInt32LE(dataBytes, 4);
  const payload = Buffer.concat([fmt, data]);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 4, 'ascii');
  riff.writeUInt32LE(4 + payload.length, 4);
  riff.write('WAVE', 8, 4, 'ascii');
  const wav = Buffer.concat([riff, payload]);
  const p = join(dir, `01_${songName}_TR01.wav`);
  writeFileSync(p, wav);
  const ts = mtime.getTime() / 1000;
  utimesSync(p, ts, ts);
  return dir;
}

describe('runImporter', () => {
  it('exits gracefully when SD card path does not exist', async () => {
    const cfg = {
      device: 'model12',
      sd_card_path: '/tmp/nonexistent-sd-card-paperstem-test-xyz',
      paperstem_url: 'https://paperstem.test',
      band_id: 'b1',
    };
    const result = await runImporter({
      config: cfg,
      token: 'tok',
      fetchImpl: vi.fn(),
    });
    expect(result.status).toBe('no-card');
  });

  it('imports a single-segment folder, writes the imported marker', async () => {
    const card = tempCard();
    placeOneStemFolder(
      card,
      '260512_0001',
      new Date(Date.now() - 60 * 60 * 1000),
    );
    const cfg = {
      device: 'model12',
      sd_card_path: card,
      paperstem_url: 'https://paperstem.test',
      band_id: 'b1',
    };
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string, init: RequestInit) => {
        if (
          url === 'https://paperstem.test/api/projects' &&
          init.method === 'POST'
        ) {
          return Promise.resolve(
            new Response(JSON.stringify({ project: { id: 'pr_new' } }), {
              status: 201,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        if (
          url.startsWith('https://paperstem.test/api/projects/pr_new/stems')
        ) {
          if (init.method === 'POST') {
            return Promise.resolve(
              new Response(JSON.stringify({ stem: { id: 's1' } }), {
                status: 201,
              }),
            );
          }
          return Promise.resolve(
            new Response(JSON.stringify({ stems: [] }), { status: 200 }),
          );
        }
        throw new Error(`unexpected url ${url} ${init.method}`);
      });
    const result = await runImporter({
      config: cfg,
      token: 'tok',
      fetchImpl: fetchMock,
      encodeFn: async ({ outputPath }) => {
        writeFileSync(outputPath, Buffer.from('fake mp3 bytes'));
      },
    });
    expect(result.status).toBe('ok');
    const dir = join(card, 'MTR', '260512_0001');
    expect(existsSync(join(dir, markerImportedFilename))).toBe(true);
    const marker = JSON.parse(
      readFileSync(join(dir, markerImportedFilename), 'utf8'),
    );
    expect(marker.segments[0].project_id).toBe('pr_new');
    expect(marker.segments[0].uploaded_at).toBeTruthy();
  });

  it('skips a folder whose marker is already imported', async () => {
    const card = tempCard();
    const dir = placeOneStemFolder(
      card,
      '260512_0002',
      new Date(Date.now() - 60 * 60 * 1000),
    );
    writeFileSync(
      join(dir, markerImportedFilename),
      JSON.stringify({
        song_folder: '260512_0002',
        host: 'h',
        paperstem_url: 'u',
        segments: [
          {
            index: 1,
            of: 1,
            start_sample: 0,
            end_sample: 0,
            name: 'x',
            project_id: 'pr_done',
            uploaded_at: '2026-05-12T00:00:00Z',
          },
        ],
      }),
    );
    const cfg = {
      device: 'model12',
      sd_card_path: card,
      paperstem_url: 'https://paperstem.test',
      band_id: 'b1',
    };
    const fetchMock = vi.fn();
    const result = await runImporter({
      config: cfg,
      token: 'tok',
      fetchImpl: fetchMock,
    });
    expect(result.status).toBe('ok');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips a folder whose mtime is within the still-recording threshold', async () => {
    const card = tempCard();
    placeOneStemFolder(card, '260512_0003', new Date());
    const cfg = {
      device: 'model12',
      sd_card_path: card,
      paperstem_url: 'https://paperstem.test',
      band_id: 'b1',
      still_recording_threshold_minutes: 5,
    };
    const fetchMock = vi.fn();
    const result = await runImporter({
      config: cfg,
      token: 'tok',
      fetchImpl: fetchMock,
    });
    expect(result.status).toBe('ok');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
