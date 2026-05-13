import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { readCuePoints } from './wav-cue.js';
import { readMarker } from './marker.js';
import type {
  DeviceImporter,
  ImportTask,
  ImportTaskStatus,
  Segment,
} from './types.js';

const TRACK_RE = /^01_\d{6}_\d{4}_TR(\d{2})\.wav$/i;
const SONG_FOLDER_RE = /^\d{6}_\d{4}$/;
const SAMPLE_RATE = 44100;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function safeRecordedOn(mtime: Date): string {
  const year = mtime.getUTCFullYear();
  const cur = new Date().getUTCFullYear();
  if (year >= 2020 && year <= cur + 1) {
    return mtime.toISOString().slice(0, 10);
  }
  return todayIso();
}

/** Read the WAV `data` chunk size and derive sample count, assuming 16-bit mono. */
function readWavSampleCount(path: string): number {
  const fd = openSync(path, 'r');
  try {
    const size = statSync(path).size;
    const hdr = Buffer.alloc(12);
    readSync(fd, hdr, 0, 12, 0);
    let pos = 12;
    while (pos + 8 <= size) {
      const ch = Buffer.alloc(8);
      readSync(fd, ch, 0, 8, pos);
      const id = ch.toString('ascii', 0, 4);
      const csize = ch.readUInt32LE(4);
      if (id === 'data') return Math.floor(csize / 2);
      pos += 8 + csize + (csize & 1);
    }
    return 0;
  } finally {
    closeSync(fd);
  }
}

export const model12: DeviceImporter = {
  id: 'model12',
  label: 'Tascam Model 12',

  async scan(sdRoot, { stillRecordingThresholdMs }) {
    const mtrRoot = join(sdRoot, 'MTR');
    if (!existsSync(mtrRoot)) return [];
    const tasks: ImportTask[] = [];
    const now = Date.now();
    const songFolders = readdirSync(mtrRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && SONG_FOLDER_RE.test(d.name))
      .map((d) => d.name)
      .sort();

    for (const songName of songFolders) {
      const folderPath = join(mtrRoot, songName);
      const trackPairs: { position: number; path: string; name: string }[] = [];
      for (const entry of readdirSync(folderPath, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const m = entry.name.match(TRACK_RE);
        if (!m) continue;
        trackPairs.push({
          position: parseInt(m[1]!, 10),
          path: join(folderPath, entry.name),
          name: entry.name,
        });
      }
      if (trackPairs.length === 0) continue;
      trackPairs.sort((a, b) => a.position - b.position);
      const trackFiles = trackPairs.map((t) => t.path);
      const trackPositions = trackPairs.map((t) => t.position);

      let lastModifiedMs = 0;
      for (const t of trackPairs) {
        const ms = statSync(t.path).mtimeMs;
        if (ms > lastModifiedMs) lastModifiedMs = ms;
      }
      const lastModified = new Date(lastModifiedMs);
      const recordedOn = safeRecordedOn(lastModified);

      let cues: number[];
      try {
        cues = readCuePoints(trackFiles[0]!);
        if (trackFiles.length > 1) {
          const cues2 = readCuePoints(trackFiles[1]!);
          if (
            cues.length !== cues2.length ||
            cues.some((v, i) => v !== cues2[i])
          ) {
            // eslint-disable-next-line no-console
            console.error(
              `[model12] cue chunks differ between ${trackPairs[0]!.name} and ${trackPairs[1]!.name} in ${folderPath}; skipping folder`,
            );
            continue;
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[model12] failed to read cues in ${folderPath}:`, err);
        continue;
      }

      const endSample = readWavSampleCount(trackFiles[0]!);
      const marker = readMarker(folderPath);
      const isStillRecording = now - lastModifiedMs < stillRecordingThresholdMs;

      const segments: Array<Segment | null> =
        cues.length === 0
          ? [null]
          : (() => {
              const boundaries = [0, ...cues, endSample];
              const out: Segment[] = [];
              for (let i = 0; i < boundaries.length - 1; i++) {
                out.push({
                  index: i + 1,
                  totalInFolder: boundaries.length - 1,
                  startSample: boundaries[i]!,
                  endSample: boundaries[i + 1]!,
                  sampleRate: SAMPLE_RATE,
                });
              }
              return out;
            })();

      segments.forEach((seg) => {
        const idx = seg?.index ?? 1;
        let defaultName =
          cues.length === 0
            ? `${recordedOn} ${songName}`
            : `${recordedOn} take ${idx}`;
        let status: ImportTaskStatus = { kind: 'new' };
        if (isStillRecording) {
          status = { kind: 'still-recording', lastModified };
        } else if (marker) {
          const seenSegment = marker.segments.find((s) => s.index === idx);
          if (seenSegment?.uploaded_at && seenSegment.practice_id) {
            status = { kind: 'done', practiceId: seenSegment.practice_id };
          } else if (seenSegment?.practice_id) {
            status = {
              kind: 'in-progress',
              practiceId: seenSegment.practice_id,
            };
          }
          if (seenSegment?.name) defaultName = seenSegment.name;
        }
        tasks.push({
          folderPath,
          trackFiles,
          trackPositions,
          segment: seg,
          lastModified,
          defaultPracticeName: defaultName,
          recordedOn,
          status,
        });
      });
    }

    return tasks;
  },

  stemNameFor(_filename, position) {
    return `TR${String(position).padStart(2, '0')}`;
  },
};
