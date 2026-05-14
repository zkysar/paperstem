import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  resolveImporter,
  availableImporterIds,
} from '../src/server/import/index.js';
import {
  readMarker,
  writeMarker,
  promoteToImported,
  markerImportedFilename,
  type Marker,
  type MarkerSegment,
} from '../src/server/import/marker.js';
import {
  compressToMp3,
  ffmpegAvailable,
} from '../src/server/import/audio-compress-local.js';
import type { DeviceImporter, ImportTask } from '../src/server/import/types.js';

export type Config = {
  device: string;
  sd_card_path: string;
  paperstem_url: string;
  band_id: string;
  session_token_env?: string;
  still_recording_threshold_minutes?: number;
  ffmpeg_parallelism?: number;
  max_tick_minutes?: number;
  delete_after_import?: false | true | number;
};

export type EncodeFn = (args: {
  inputPath: string;
  outputPath: string;
  slice: { startSec: number; durationSec: number } | null;
}) => Promise<void>;

export type RunOpts = {
  config: Config;
  token: string;
  fetchImpl?: typeof fetch;
  encodeFn?: EncodeFn;
  now?: () => number;
  /** Defaults to ~/.cache/paperstem-import/lock; pass false to skip locking (tests). */
  lockPath?: string | false;
};

export type RunResult =
  | { status: 'no-card' }
  | { status: 'ok' }
  | { status: 'locked' }
  | { status: 'error'; message: string };

const DEFAULT_THRESHOLD_MIN = 5;
const DEFAULT_BITRATE = 64;
const TICK_BUDGET_DEFAULT_MIN = 30;

function nowIso(now: () => number): string {
  return new Date(now()).toISOString();
}

function defaultEncode(): EncodeFn {
  return async ({ inputPath, outputPath, slice }) => {
    await compressToMp3({
      inputPath,
      outputPath,
      bitrateKbps: DEFAULT_BITRATE,
      slice: slice ?? undefined,
    });
  };
}

type ResolvedDefaults = {
  session_token_env: string;
  still_recording_threshold_minutes: number;
  ffmpeg_parallelism: number;
  max_tick_minutes: number;
  delete_after_import: number | false;
};

function resolveDefaults(c: Config): ResolvedDefaults {
  return {
    session_token_env: c.session_token_env ?? 'PAPERSTEM_SESSION_TOKEN',
    still_recording_threshold_minutes:
      c.still_recording_threshold_minutes ?? DEFAULT_THRESHOLD_MIN,
    ffmpeg_parallelism: c.ffmpeg_parallelism ?? 2,
    max_tick_minutes: c.max_tick_minutes ?? TICK_BUDGET_DEFAULT_MIN,
    delete_after_import:
      c.delete_after_import === false || c.delete_after_import === undefined
        ? false
        : c.delete_after_import === true
          ? 30
          : c.delete_after_import,
  };
}

function cookieNameFor(baseUrl: string): string {
  return baseUrl.startsWith('https://')
    ? '__Host-paperstem_session'
    : 'paperstem_session_dev';
}

function defaultLockPath(): string {
  const cacheRoot =
    process.env.XDG_CACHE_HOME ??
    join(process.env.HOME ?? tmpdir(), '.cache');
  return join(cacheRoot, 'paperstem-import', 'lock');
}

/** Acquire an exclusive lockfile. Returns the fd, or null if already held. */
function tryAcquireLock(path: string): number | null {
  mkdirSync(dirname(path), { recursive: true });
  try {
    return openSync(path, 'wx');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return null;
    throw err;
  }
}

function releaseLock(fd: number, path: string): void {
  try {
    closeSync(fd);
  } finally {
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  }
}

function ensureMarker(
  task: ImportTask,
  host: string,
  paperstemUrl: string,
): Marker {
  const existing = readMarker(task.folderPath);
  if (existing) return existing;
  const songFolder = basename(task.folderPath);
  if (!task.segment) {
    return {
      song_folder: songFolder,
      host,
      paperstem_url: paperstemUrl,
      segments: [
        {
          index: 1,
          of: 1,
          start_sample: 0,
          end_sample: task.totalSamples,
          name: task.defaultProjectName,
          project_id: null,
          uploaded_at: null,
        },
      ],
    };
  }
  return {
    song_folder: songFolder,
    host,
    paperstem_url: paperstemUrl,
    segments: Array.from({ length: task.segment.totalInFolder }, (_, i) => ({
      index: i + 1,
      of: task.segment!.totalInFolder,
      start_sample: 0,
      end_sample: 0,
      name: '',
      project_id: null,
      uploaded_at: null,
    })),
  };
}

function syncMarkerSegment(marker: Marker, task: ImportTask): MarkerSegment {
  const segIdx = task.segment?.index ?? 1;
  const slot = marker.segments.find((s) => s.index === segIdx)!;
  if (task.segment) {
    slot.start_sample = task.segment.startSample;
    slot.end_sample = task.segment.endSample;
    slot.of = task.segment.totalInFolder;
  } else {
    slot.start_sample = 0;
    slot.end_sample = task.totalSamples;
  }
  if (!slot.name) slot.name = task.defaultProjectName;
  return slot;
}

async function createProject(args: {
  baseUrl: string;
  bandId: string;
  name: string;
  recordedOn: string | null;
  token: string;
  fetchImpl: typeof fetch;
}): Promise<string> {
  const url = `${args.baseUrl}/api/projects`;
  const body: Record<string, unknown> = {
    band_id: args.bandId,
    name: args.name,
  };
  if (args.recordedOn) body.recorded_on = args.recordedOn;
  const res = await args.fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${cookieNameFor(args.baseUrl)}=${args.token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`create project failed: HTTP ${res.status}`);
  }
  const parsed = (await res.json()) as { project: { id: string } };
  return parsed.project.id;
}

async function uploadStem(args: {
  baseUrl: string;
  projectId: string;
  filePath: string;
  stemName: string;
  position: number;
  token: string;
  fetchImpl: typeof fetch;
}): Promise<void> {
  const form = new FormData();
  form.append('position', String(args.position));
  form.append('name', args.stemName);
  const fileBytes = readFileSync(args.filePath);
  form.append(
    'file',
    new Blob([new Uint8Array(fileBytes)]),
    `${args.stemName}.mp3`,
  );
  const url = `${args.baseUrl}/api/projects/${encodeURIComponent(args.projectId)}/stems`;
  const res = await args.fetchImpl(url, {
    method: 'POST',
    headers: { Cookie: `${cookieNameFor(args.baseUrl)}=${args.token}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`stem upload failed: HTTP ${res.status}`);
  }
}

async function getExistingStemPositions(args: {
  baseUrl: string;
  projectId: string;
  token: string;
  fetchImpl: typeof fetch;
}): Promise<Set<number>> {
  const url = `${args.baseUrl}/api/projects/${encodeURIComponent(args.projectId)}`;
  const res = await args.fetchImpl(url, {
    headers: { Cookie: `${cookieNameFor(args.baseUrl)}=${args.token}` },
  });
  if (!res.ok) return new Set();
  const body = (await res.json()) as { stems?: Array<{ position: number }> };
  return new Set((body.stems ?? []).map((s) => s.position));
}

export async function runImporter(opts: RunOpts): Promise<RunResult> {
  const cfg = opts.config;
  const defaults = resolveDefaults(cfg);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const encode = opts.encodeFn ?? defaultEncode();
  const now = opts.now ?? Date.now;

  if (!existsSync(cfg.sd_card_path)) return { status: 'no-card' };

  const importer = resolveImporter(cfg.device);
  if (!importer) {
    return {
      status: 'error',
      message: `unknown device "${cfg.device}". available: ${availableImporterIds().join(', ')}`,
    };
  }

  // Process lock — launchd may fire a second tick while the first is still
  // running on a multi-GB dump. Two concurrent ticks on the same SD card
  // would race on the marker file.
  const lockPath = opts.lockPath === false ? null : (opts.lockPath ?? defaultLockPath());
  const lockFd = lockPath ? tryAcquireLock(lockPath) : null;
  if (lockPath && lockFd === null) return { status: 'locked' };

  try {
    return await runImporterInner({
      cfg,
      defaults,
      fetchImpl,
      encode,
      now,
      token: opts.token,
      importer,
    });
  } finally {
    if (lockPath && lockFd !== null) releaseLock(lockFd, lockPath);
  }
}

async function runImporterInner(args: {
  cfg: Config;
  defaults: ResolvedDefaults;
  fetchImpl: typeof fetch;
  encode: EncodeFn;
  now: () => number;
  token: string;
  importer: DeviceImporter;
}): Promise<RunResult> {
  const { cfg, defaults, fetchImpl, encode, now, token, importer } = args;

  const tasks = await importer.scan(cfg.sd_card_path, {
    stillRecordingThresholdMs:
      defaults.still_recording_threshold_minutes * 60 * 1000,
  });

  const tasksByFolder = new Map<string, ImportTask[]>();
  for (const t of tasks) {
    if (!tasksByFolder.has(t.folderPath))
      tasksByFolder.set(t.folderPath, []);
    tasksByFolder.get(t.folderPath)!.push(t);
  }

  const host = hostname();
  const tickStart = now();
  const tickBudgetMs = defaults.max_tick_minutes * 60 * 1000;

  for (const [folderPath, folderTasks] of tasksByFolder) {
    if (folderTasks[0]!.status.kind === 'still-recording') continue;
    if (folderTasks.every((t) => t.status.kind === 'done')) continue;

    const marker = ensureMarker(folderTasks[0]!, host, cfg.paperstem_url);
    folderTasks.forEach((t) => syncMarkerSegment(marker, t));

    for (const task of folderTasks) {
      if (now() - tickStart > tickBudgetMs) return { status: 'ok' };
      if (task.status.kind === 'done') continue;

      const segIdx = task.segment?.index ?? 1;
      const slot = marker.segments.find((s) => s.index === segIdx)!;
      let projectId = slot.project_id;
      if (!projectId) {
        projectId = await createProject({
          baseUrl: cfg.paperstem_url,
          bandId: cfg.band_id,
          name: task.defaultProjectName,
          recordedOn: task.recordedOn,
          token,
          fetchImpl,
        });
        slot.project_id = projectId;
        writeMarker(folderPath, marker);
      }

      const existingPositions =
        task.status.kind === 'in-progress'
          ? await getExistingStemPositions({
              baseUrl: cfg.paperstem_url,
              projectId,
              token,
              fetchImpl,
            })
          : new Set<number>();

      const tmp = mkdtempSync(join(tmpdir(), 'paperstem-encode-'));
      let segmentTimedOut = false;
      try {
        for (let i = 0; i < task.trackFiles.length; i++) {
          if (now() - tickStart > tickBudgetMs) {
            segmentTimedOut = true;
            break;
          }
          const inputPath = task.trackFiles[i]!;
          const position = task.trackPositions[i]!;
          if (existingPositions.has(position)) continue;
          const stemName = importer.stemNameFor(
            basename(inputPath),
            position,
          );
          const outputPath = join(tmp, `${stemName}.mp3`);
          const slice = task.segment
            ? {
                startSec: task.segment.startSample / task.segment.sampleRate,
                durationSec:
                  (task.segment.endSample - task.segment.startSample) /
                  task.segment.sampleRate,
              }
            : null;
          await encode({ inputPath, outputPath, slice });
          await uploadStem({
            baseUrl: cfg.paperstem_url,
            projectId,
            filePath: outputPath,
            stemName,
            position,
            token,
            fetchImpl,
          });
        }
        if (!segmentTimedOut) {
          slot.uploaded_at = nowIso(now);
          writeMarker(folderPath, marker);
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
      if (segmentTimedOut) return { status: 'ok' };
    }

    promoteToImported(folderPath);
  }

  if (defaults.delete_after_import !== false) {
    await reclaimPass({
      sdRoot: cfg.sd_card_path,
      graceDays: defaults.delete_after_import,
      now,
      paperstemUrl: cfg.paperstem_url,
      token,
      fetchImpl,
    });
  }

  return { status: 'ok' };
}

async function reclaimPass(args: {
  sdRoot: string;
  graceDays: number;
  now: () => number;
  paperstemUrl: string;
  token: string;
  fetchImpl: typeof fetch;
}): Promise<void> {
  const mtrRoot = join(args.sdRoot, 'MTR');
  if (!existsSync(mtrRoot)) return;
  const folders = readdirSync(mtrRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(mtrRoot, d.name));
  for (const folder of folders) {
    const marker = readMarker(folder);
    if (!marker) continue;
    if (marker.deleted_at) continue;
    if (!marker.segments.every((s) => s.uploaded_at)) continue;
    const oldest = marker.segments.reduce<string>(
      (acc, s) => (acc < s.uploaded_at! ? acc : s.uploaded_at!),
      marker.segments[0]!.uploaded_at!,
    );
    const oldestMs = new Date(oldest).getTime();
    if (args.now() - oldestMs < args.graceDays * 24 * 60 * 60 * 1000) continue;

    let allExist = true;
    for (const s of marker.segments) {
      if (!s.project_id) {
        allExist = false;
        break;
      }
      const url = `${args.paperstemUrl}/api/projects/${encodeURIComponent(s.project_id)}`;
      const res = await args.fetchImpl(url, {
        headers: {
          Cookie: `${cookieNameFor(args.paperstemUrl)}=${args.token}`,
        },
      });
      if (!res.ok) {
        allExist = false;
        break;
      }
    }
    if (!allExist) {
      // eslint-disable-next-line no-console
      console.warn(`[reclaim] project missing for ${folder}; skipping`);
      continue;
    }

    const deleted: string[] = [];
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (entry.name === markerImportedFilename) continue;
      try {
        unlinkSync(join(folder, entry.name));
        deleted.push(entry.name);
      } catch {
        /* file missing already */
      }
    }
    marker.deleted_at = nowIso(args.now);
    marker.deleted_files = deleted;
    writeMarker(folder, marker);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { config: { type: 'string' } },
  });
  const configPath =
    values.config ??
    join(process.env.HOME ?? '~', '.config/paperstem/import.json');
  if (!existsSync(configPath)) {
    console.error(`config file not found: ${configPath}`);
    process.exit(1);
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Config;
  const tokenEnv = config.session_token_env ?? 'PAPERSTEM_SESSION_TOKEN';
  const token = process.env[tokenEnv];
  if (!token) {
    console.error(
      `${tokenEnv} is not set. See README → Importing from a multitrack recorder.`,
    );
    process.exit(1);
  }
  if (!ffmpegAvailable()) {
    console.error('ffmpeg not found on PATH. brew install ffmpeg.');
    process.exit(1);
  }
  const result = await runImporter({ config, token });
  if (result.status === 'error') {
    console.error(result.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
