/**
 * Thin Node-side wrapper around the Python classification sidecar.
 *
 * The sidecar lives in `bin/auto-classify/` and is invoked via `execFileSync`
 * with one argv: the audio file path. It writes a single JSON object to
 * stdout matching the wire format documented in `bin/auto-classify/README.md`
 * and `src/shared/types.ts` (`ClassifiedSegment[]`).
 *
 * Two consumers are anticipated:
 *   1. The CLI import path (`bin/import-from-device.ts`, Phase 6) — runs the
 *      sidecar after each project's audio is uploaded and POSTs the JSON to
 *      `/api/projects/:id/classify`.
 *   2. The Phase 4 backfill script (future) — same invocation, different
 *      downstream wiring.
 *
 * Failure modes are explicit (`venv-missing`, `sidecar-error`) so callers can
 * surface friendly hints rather than crash.
 */
import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ClassifiedSegment } from '../src/shared/types.js';

export type SidecarResult = {
  segments: ClassifiedSegment[];
  audio_hash: string;
  duration_ms: number;
};

export type SidecarFailure =
  | { kind: 'venv-missing'; pythonBin: string }
  | { kind: 'sidecar-error'; message: string };

export type SidecarOutcome =
  | { ok: true; result: SidecarResult }
  | { ok: false; failure: SidecarFailure };

/** Sane buffer ceiling — a 90-minute practice's JSON is comfortably under 50 MB. */
const MAX_STDOUT_BYTES = 50 * 1024 * 1024;

export type RunnerPaths = {
  /** Repo-root-relative directory containing the sidecar. */
  sidecarDir: string;
};

/**
 * Resolve the absolute path to the Python interpreter inside the sidecar venv.
 * Exported for the startup check in `import-from-device.ts`.
 */
export function pythonBinPath(paths: RunnerPaths): string {
  return join(paths.sidecarDir, '.venv', 'bin', 'python');
}

export function classifyScriptPath(paths: RunnerPaths): string {
  return join(paths.sidecarDir, 'classify.py');
}

export function sidecarVenvExists(paths: RunnerPaths): boolean {
  return existsSync(pythonBinPath(paths));
}

export type ExecFileSyncFn = (
  file: string,
  args: readonly string[],
  options: ExecFileSyncOptions,
) => Buffer;

/**
 * Invoke the sidecar synchronously and parse its stdout as `SidecarResult`.
 *
 * Returns a discriminated outcome instead of throwing: callers (the CLI) want
 * to log a hint and continue, not abort the import.
 */
export function runSidecar(
  audioPath: string,
  paths: RunnerPaths,
  execFileSyncFn: ExecFileSyncFn = execFileSync,
): SidecarOutcome {
  const pythonBin = pythonBinPath(paths);
  if (!existsSync(pythonBin)) {
    return { ok: false, failure: { kind: 'venv-missing', pythonBin } };
  }
  const script = classifyScriptPath(paths);
  let stdout: Buffer;
  try {
    stdout = execFileSyncFn(pythonBin, [script, audioPath], {
      maxBuffer: MAX_STDOUT_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, failure: { kind: 'sidecar-error', message } };
  }
  let parsed: SidecarResult;
  try {
    parsed = JSON.parse(stdout.toString('utf8')) as SidecarResult;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      failure: { kind: 'sidecar-error', message: `invalid JSON: ${message}` },
    };
  }
  return { ok: true, result: parsed };
}

export const sidecarSetupHint =
  'auto-classify: bin/auto-classify/.venv not found. ' +
  'Run `bash bin/auto-classify/setup.sh` to install the sidecar, ' +
  'or pass --no-auto-classify to skip classification.';
