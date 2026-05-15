import { describe, it, expect, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
// mkdirSync is used both by placeOneStemFolder and by the fake-sidecar setup
// in the auto-classify test below.
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

  it('runs the auto-classify sidecar and POSTs the result when enabled', async () => {
    const card = tempCard();
    placeOneStemFolder(
      card,
      '260512_0004',
      new Date(Date.now() - 60 * 60 * 1000),
    );
    const cfg = {
      device: 'model12',
      sd_card_path: card,
      paperstem_url: 'https://paperstem.test',
      band_id: 'b1',
    };

    const seenCalls: Array<{ url: string; method?: string; body?: string }> = [];
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string, init: RequestInit) => {
        seenCalls.push({
          url,
          method: init.method,
          body: typeof init.body === 'string' ? init.body : undefined,
        });
        if (
          url === 'https://paperstem.test/api/projects' &&
          init.method === 'POST'
        ) {
          return Promise.resolve(
            new Response(JSON.stringify({ project: { id: 'pr_ac' } }), {
              status: 201,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        if (url.startsWith('https://paperstem.test/api/projects/pr_ac/stems')) {
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
        if (
          url === 'https://paperstem.test/api/projects/pr_ac/classify' &&
          init.method === 'POST'
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                run_id: 'run_1',
                reused: false,
                sections: [
                  {
                    id: 'sec_a',
                    start_ms: 0,
                    end_ms: 30000,
                    song_id: 'song_1',
                    song_name: 'Wagon Wheel',
                    label: null,
                    segment_type: 'music',
                    confidence: 0.9,
                    tentative: false,
                  },
                  {
                    id: 'sec_b',
                    start_ms: 30000,
                    end_ms: 35000,
                    song_id: null,
                    song_name: null,
                    label: 'Chatter',
                    segment_type: 'chatter',
                    confidence: 0,
                    tentative: false,
                  },
                  {
                    id: 'sec_c',
                    start_ms: 35000,
                    end_ms: 40000,
                    song_id: null,
                    song_name: null,
                    label: null,
                    segment_type: 'unknown',
                    confidence: 0,
                    tentative: false,
                  },
                ],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        throw new Error(`unexpected url ${url} ${init.method}`);
      });

    // Stub the Python sidecar — emits the JSON wire format that classify.py
    // would. Existence check happens inside runSidecar against runnerPaths,
    // so point it at the real sidecar dir (which has a real Python script
    // and yamnet.tflite checked into the repo, but no .venv on test
    // machines). We bypass the venv check by passing runnerPaths that point
    // at a tmp dir with a fake python binary.
    const fakeSidecarDir = mkdtempSync(join(tmpdir(), 'paperstem-fake-sidecar-'));
    const fakeVenvBin = join(fakeSidecarDir, '.venv', 'bin');
    mkdirSync(fakeVenvBin, { recursive: true });
    // Write a placeholder; existence is all we check.
    writeFileSync(join(fakeVenvBin, 'python'), '#!/bin/sh\nexit 0\n');

    const execFileSyncFn = vi
      .fn()
      .mockImplementation((file: string, args: readonly string[]) => {
        expect(file).toBe(join(fakeSidecarDir, '.venv', 'bin', 'python'));
        expect(args[0]).toBe(join(fakeSidecarDir, 'classify.py'));
        // args[1] is the audio path — should be one of the encoded mp3s.
        expect(args[1]).toMatch(/\.mp3$/);
        return Buffer.from(
          JSON.stringify({
            segments: [
              {
                start_ms: 0,
                end_ms: 30000,
                segment_type: 'music',
                top_classes: [{ name: 'Music', score: 0.8 }],
                chroma: [
                  [
                    0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.0, 0.0,
                  ],
                ],
              },
              {
                start_ms: 30000,
                end_ms: 35000,
                segment_type: 'chatter',
                top_classes: [{ name: 'Speech', score: 0.7 }],
              },
            ],
            audio_hash: 'abc123',
            duration_ms: 35000,
          }),
          'utf8',
        );
      });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const result = await runImporter({
        config: cfg,
        token: 'tok',
        fetchImpl: fetchMock,
        encodeFn: async ({ outputPath }) => {
          writeFileSync(outputPath, Buffer.from('fake mp3 bytes'));
        },
        autoClassify: true,
        execFileSyncFn,
        runnerPaths: { sidecarDir: fakeSidecarDir },
      });
      expect(result.status).toBe('ok');
      expect(execFileSyncFn).toHaveBeenCalledTimes(1);

      const classifyCall = seenCalls.find(
        (c) =>
          c.url === 'https://paperstem.test/api/projects/pr_ac/classify' &&
          c.method === 'POST',
      );
      expect(classifyCall).toBeDefined();
      const parsed = JSON.parse(classifyCall!.body!);
      expect(parsed.audio_hash).toBe('abc123');
      expect(parsed.duration_ms).toBe(35000);
      expect(parsed.classifier_version).toBe('yamnet-v1');
      expect(parsed.fingerprint_version).toBe(1);
      expect(parsed.source_surface).toBe('cli');
      expect(parsed.segments).toHaveLength(2);

      // Summary line: 2 named (song_id on the music section, label on the
      // chatter section), 1 unnamed (the unknown section).
      const summaryLine = logSpy.mock.calls
        .map((c) => c.join(' '))
        .find((s) => s.startsWith('Classified '));
      expect(summaryLine).toBeDefined();
      expect(summaryLine).toMatch(/3 sections proposed \(2 named\)/);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('skips classification gracefully when the sidecar .venv is missing', async () => {
    const card = tempCard();
    placeOneStemFolder(
      card,
      '260512_0005',
      new Date(Date.now() - 60 * 60 * 1000),
    );
    const cfg = {
      device: 'model12',
      sd_card_path: card,
      paperstem_url: 'https://paperstem.test',
      band_id: 'b1',
    };
    const seenCalls: string[] = [];
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string, init: RequestInit) => {
        seenCalls.push(`${init.method} ${url}`);
        if (
          url === 'https://paperstem.test/api/projects' &&
          init.method === 'POST'
        ) {
          return Promise.resolve(
            new Response(JSON.stringify({ project: { id: 'pr_skip' } }), {
              status: 201,
            }),
          );
        }
        if (
          url.startsWith('https://paperstem.test/api/projects/pr_skip/stems')
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
    const execFileSyncFn = vi.fn();

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await runImporter({
        config: cfg,
        token: 'tok',
        fetchImpl: fetchMock,
        encodeFn: async ({ outputPath }) => {
          writeFileSync(outputPath, Buffer.from('fake mp3 bytes'));
        },
        autoClassify: true,
        execFileSyncFn,
        runnerPaths: { sidecarDir: join(tmpdir(), 'paperstem-nonexistent-sidecar-xyz') },
      });
      expect(result.status).toBe('ok');
      // Sidecar was never invoked.
      expect(execFileSyncFn).not.toHaveBeenCalled();
      // No classify POST.
      expect(seenCalls).not.toContain('POST https://paperstem.test/api/projects/pr_skip/classify');
      // Hint was printed.
      const warnLines = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(warnLines).toMatch(/setup\.sh/);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not invoke the sidecar when autoClassify is false', async () => {
    const card = tempCard();
    placeOneStemFolder(
      card,
      '260512_0006',
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
            new Response(JSON.stringify({ project: { id: 'pr_off' } }), {
              status: 201,
            }),
          );
        }
        if (url.startsWith('https://paperstem.test/api/projects/pr_off/stems')) {
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
    const execFileSyncFn = vi.fn();
    const result = await runImporter({
      config: cfg,
      token: 'tok',
      fetchImpl: fetchMock,
      encodeFn: async ({ outputPath }) => {
        writeFileSync(outputPath, Buffer.from('fake mp3 bytes'));
      },
      autoClassify: false,
      execFileSyncFn,
    });
    expect(result.status).toBe('ok');
    expect(execFileSyncFn).not.toHaveBeenCalled();
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
