import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { AUDIO_EXT } from '../lib/audio';
import { compressToMp3 } from '../lib/audio-compress';
import { computePeaks, encodePeaks, PLAYER_PEAK_BINS } from '../lib/peaks';

const MAX_NAME_LENGTH = 200;
const MAX_STEM_BYTES = 100 * 1024 * 1024;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type UploadStatus = 'pending' | 'compressing' | 'uploading' | 'done' | 'failed';

type FileEntry = {
  file: File;
  status: UploadStatus;
  progress: number;
  error: string | null;
};

type Props = {
  bandId: string;
  open: boolean;
  // Optional: pre-populate the file list and name field. Used by the
  // "Save to band" flow that promotes a local-folder draft — the user
  // already picked the folder upstream, so the drawer skips its own
  // folder-picker UI and shows the files immediately.
  prefilledFiles?: File[];
  prefilledName?: string | null;
  onClose(): void;
  onUploaded(projectId: string): void;
};

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function defaultProjectName(): string {
  return `project-${todayIso()}`;
}

async function computeStemPeaks(file: File): Promise<string | null> {
  const Ctor: typeof AudioContext | undefined =
    typeof window === 'undefined'
      ? undefined
      : window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
  if (!Ctor) return null;
  let ctx: AudioContext | null = null;
  try {
    const buf = await file.arrayBuffer();
    ctx = new Ctor();
    const audio = await ctx.decodeAudioData(buf);
    const peaks = computePeaks(audio, PLAYER_PEAK_BINS, { normalize: false });
    return encodePeaks(peaks);
  } catch {
    return null;
  } finally {
    if (ctx) void ctx.close();
  }
}

function uploadStem(
  projectId: string,
  file: File,
  position: number,
  peaks: string | null,
  onProgress: (frac: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('position', String(position));
    if (peaks) fd.append('peaks', peaks);
    fd.append('file', file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/projects/${encodeURIComponent(projectId)}/stems`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
      } else {
        let msg = `HTTP ${xhr.status}`;
        try {
          const data = JSON.parse(xhr.responseText) as { error?: string };
          if (data.error) msg = data.error;
        } catch {
          /* ignore */
        }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('network_error'));
    xhr.onabort = () => reject(new Error('aborted'));
    xhr.send(fd);
  });
}

export function UploadDrawer({
  bandId,
  open,
  prefilledFiles,
  prefilledName,
  onClose,
  onUploaded,
}: Props) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(prefilledName?.trim() || defaultProjectName());
  const [recordedOn, setRecordedOn] = useState(todayIso());
  const [files, setFiles] = useState<FileEntry[]>(() =>
    (prefilledFiles ?? []).map((file) => ({
      file,
      status: 'pending' as UploadStatus,
      progress: 0,
      error: null,
    })),
  );
  const [submitting, setSubmitting] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  const hasPrefilledFiles = (prefilledFiles?.length ?? 0) > 0;

  // Reset on open: pick up fresh prefill values, or clear back to defaults.
  // Done in an effect rather than in initial state so re-opening with new
  // prefill values takes effect.
  useEffect(() => {
    if (!open) {
      setName(defaultProjectName());
      setRecordedOn(todayIso());
      setFiles([]);
      setSubmitting(false);
      setTopError(null);
      if (folderInputRef.current) folderInputRef.current.value = '';
      return;
    }
    if (prefilledName) setName(prefilledName.trim());
    if (prefilledFiles && prefilledFiles.length > 0) {
      setFiles(
        prefilledFiles.map((file) => ({
          file,
          status: 'pending' as UploadStatus,
          progress: 0,
          error: null,
        })),
      );
    }
  }, [open, prefilledFiles, prefilledName]);

  const trimmedName = name.trim();
  const nameValid = trimmedName.length > 0 && trimmedName.length <= MAX_NAME_LENGTH;
  const dateValid = recordedOn === '' || ISO_DATE_RE.test(recordedOn);

  const validation = useMemo(() => {
    if (!nameValid) return 'Project name is required (≤ 200 chars).';
    if (!dateValid) return 'Date must be YYYY-MM-DD.';
    if (files.length === 0) return 'Pick a folder of audio files.';
    return null;
  }, [nameValid, dateValid, files.length]);

  const canSubmit = !submitting && validation === null;
  const allDone =
    files.length > 0 && files.every((f) => f.status === 'done');

  function handleFolderPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const all = Array.from(e.target.files ?? []);
    const audio = all.filter((f) => AUDIO_EXT.test(f.name));
    audio.sort((a, b) => a.name.localeCompare(b.name));
    setTopError(null);
    setFiles(
      audio.map((file) => ({
        file,
        status: 'pending' as UploadStatus,
        progress: 0,
        error: null,
      })),
    );
  }

  function updateFile(index: number, patch: Partial<FileEntry>) {
    setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setTopError(null);

    const projectBody: Record<string, unknown> = {
      band_id: bandId,
      name: trimmedName,
    };
    if (recordedOn) projectBody.recorded_on = recordedOn;

    let projectId: string;
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(projectBody),
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = `HTTP ${res.status}`;
        try {
          const data = JSON.parse(text) as { error?: string };
          if (data.error) msg = data.error;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const data = (await res.json()) as { project: { id: string } };
      projectId = data.project.id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTopError(`Could not create project: ${msg}`);
      setSubmitting(false);
      return;
    }

    // Track success inline rather than via the closure-captured `files` —
    // updateFile() schedules setFiles() but does NOT update this closure's
    // `files` reference, so a post-loop `files.some(f => f.status !== 'done')`
    // would always read stale 'pending' entries and skip onUploaded(). With
    // onUploaded() never firing the drawer stayed open after a successful
    // upload, and a re-click of the still-enabled Upload button would POST
    // /api/projects again, skip every (already-'done') stem in the loop, and
    // produce a phantom empty project alongside the real one.
    let allOk = true;
    for (let i = 0; i < files.length; i++) {
      const entry = files[i];
      if (entry.status === 'done') continue;

      let toUpload = entry.file;
      if (toUpload.size > MAX_STEM_BYTES) {
        updateFile(i, { status: 'compressing', progress: 0, error: null });
        try {
          toUpload = await compressToMp3(toUpload, (frac) => {
            updateFile(i, { progress: frac });
          });
          updateFile(i, { file: toUpload, progress: 1 });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          updateFile(i, { status: 'failed', error: `compression_failed: ${msg}` });
          allOk = false;
          continue;
        }
        if (toUpload.size > MAX_STEM_BYTES) {
          updateFile(i, {
            status: 'failed',
            error: 'still_over_100mb_after_compression',
          });
          allOk = false;
          continue;
        }
      }

      // Decode the file in the browser to pre-compute the player waveform
      // peaks. Sent alongside the file so the server stores them on the row
      // — every subsequent player load skips the decode and renders instantly.
      // If decoding fails (unsupported codec, OOM), we fall back to the
      // original behavior where the player decodes on its own.
      const peaks = await computeStemPeaks(toUpload);

      updateFile(i, { status: 'uploading', progress: 0, error: null });
      try {
        await uploadStem(projectId, toUpload, i + 1, peaks, (frac) => {
          updateFile(i, { progress: frac });
        });
        updateFile(i, { status: 'done', progress: 1, error: null });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        updateFile(i, { status: 'failed', error: msg });
        allOk = false;
      }
    }

    setSubmitting(false);
    if (allOk) {
      onUploaded(projectId);
    }
  }

  function handleRetry(index: number) {
    if (submitting) return;
    updateFile(index, { status: 'pending', progress: 0, error: null });
  }

  if (!open) return null;

  return (
    <div
      className="upload-modal-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-modal-title"
      onClick={onClose}
    >
      <div className="upload-modal" onClick={(e) => e.stopPropagation()}>
        <div className="upload-modal-header">
          <h2 id="upload-modal-title">
            {hasPrefilledFiles ? 'Save to your band' : 'Upload project'}
          </h2>
          <button
            type="button"
            className="upload-modal-close"
            aria-label="Close upload"
            onClick={onClose}
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <div className="upload-modal-body">
          {topError && <div className="upload-error">{topError}</div>}

          <label className="upload-field">
            <span>Project name</span>
            <input
              type="text"
              value={name}
              maxLength={MAX_NAME_LENGTH}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
            />
          </label>

          <label className="upload-field">
            <span>Recorded on</span>
            <input
              type="date"
              value={recordedOn}
              onChange={(e) => setRecordedOn(e.target.value)}
              disabled={submitting}
            />
          </label>

          {hasPrefilledFiles ? (
            <p className="upload-hint">
              Stems are re-encoded to MP3 128 kbps in your browser before upload.
              This is lossy compression — keep your original masters elsewhere.
            </p>
          ) : (
            <label className="upload-field">
              <span>Folder of stems</span>
              <input
                ref={folderInputRef}
                type="file"
                {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                multiple
                onChange={handleFolderPicked}
                disabled={submitting}
              />
              <span className="upload-hint">
                Stems are re-encoded to MP3 128 kbps in your browser before upload.
                This is lossy compression — keep your original masters elsewhere.
              </span>
            </label>
          )}

          {files.length > 0 && (
            <ul className="upload-file-list">
              {files.map((f, i) => (
                <li key={f.file.name} className={`upload-file upload-file-${f.status}`}>
                  <span className="upload-file-name">{f.file.name}</span>
                  <progress value={f.progress} max={1} />
                  <span className="upload-file-status">
                    {f.status === 'pending' && 'pending'}
                    {f.status === 'compressing' &&
                      `compressing ${Math.round(f.progress * 100)}%`}
                    {f.status === 'uploading' &&
                      `uploading ${Math.round(f.progress * 100)}%`}
                    {f.status === 'done' && 'done'}
                    {f.status === 'failed' && (
                      <>
                        failed ({f.error ?? 'unknown'})
                        <button
                          type="button"
                          onClick={() => handleRetry(i)}
                          disabled={submitting}
                        >
                          retry
                        </button>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {validation && !submitting && (
            <div className="upload-hint">{validation}</div>
          )}
        </div>

        <div className="upload-modal-footer">
          <button type="button" onClick={onClose} disabled={submitting && !allDone}>
            {allDone ? 'Close' : 'Cancel'}
          </button>
          {/* Hide the submit button once every stem is uploaded — defense
              in depth: a stray re-click after a successful run would POST
              /api/projects again and create an empty duplicate project,
              because every file would be skipped by the for-loop's
              `status === 'done'` short-circuit. */}
          {!allDone && (
            <button
              type="button"
              className="upload-submit"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
            >
              {submitting ? 'Uploading…' : 'Upload'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
