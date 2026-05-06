import { useEffect, useMemo, useRef, useState } from 'react';
import { AUDIO_EXT } from '../lib/audio';
import { compressToMp3 } from '../lib/audio-compress';

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
  onClose(): void;
  onUploaded(practiceId: string): void;
};

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function defaultPracticeName(): string {
  return `practice-${todayIso()}`;
}

function uploadStem(
  practiceId: string,
  file: File,
  position: number,
  onProgress: (frac: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('position', String(position));
    fd.append('file', file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/practices/${encodeURIComponent(practiceId)}/stems`);
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

export function UploadDrawer({ bandId, open, onClose, onUploaded }: Props) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(defaultPracticeName());
  const [recordedOn, setRecordedOn] = useState(todayIso());
  const [referenceStem, setReferenceStem] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName(defaultPracticeName());
      setRecordedOn(todayIso());
      setReferenceStem('');
      setFiles([]);
      setSubmitting(false);
      setTopError(null);
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  }, [open]);

  const trimmedName = name.trim();
  const nameValid = trimmedName.length > 0 && trimmedName.length <= MAX_NAME_LENGTH;
  const dateValid = recordedOn === '' || ISO_DATE_RE.test(recordedOn);

  const validation = useMemo(() => {
    if (!nameValid) return 'Practice name is required (≤ 200 chars).';
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
    if (referenceStem === '' && audio.length > 0) {
      const first = audio[0].name.replace(/\.[^.]+$/, '');
      setReferenceStem(first);
    }
  }

  function updateFile(index: number, patch: Partial<FileEntry>) {
    setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setTopError(null);

    const practiceBody: Record<string, unknown> = {
      band_id: bandId,
      name: trimmedName,
    };
    if (recordedOn) practiceBody.recorded_on = recordedOn;
    if (referenceStem) practiceBody.reference_stem = referenceStem;

    let practiceId: string;
    try {
      const res = await fetch('/api/practices', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(practiceBody),
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
      const data = (await res.json()) as { practice: { id: string } };
      practiceId = data.practice.id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTopError(`Could not create practice: ${msg}`);
      setSubmitting(false);
      return;
    }

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
          continue;
        }
        if (toUpload.size > MAX_STEM_BYTES) {
          updateFile(i, {
            status: 'failed',
            error: 'still_over_100mb_after_compression',
          });
          continue;
        }
      }

      updateFile(i, { status: 'uploading', progress: 0, error: null });
      try {
        await uploadStem(practiceId, toUpload, i + 1, (frac) => {
          updateFile(i, { progress: frac });
        });
        updateFile(i, { status: 'done', progress: 1, error: null });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        updateFile(i, { status: 'failed', error: msg });
      }
    }

    setSubmitting(false);
    const stillPending = files.some(
      (f, i) => f.status !== 'done' && i < files.length,
    );
    if (!stillPending) {
      onUploaded(practiceId);
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
          <h2 id="upload-modal-title">Upload practice</h2>
          <button
            type="button"
            className="upload-modal-close"
            aria-label="Close upload"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="upload-modal-body">
          {topError && <div className="upload-error">{topError}</div>}

          <label className="upload-field">
            <span>Practice name</span>
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
          </label>

          {files.length > 0 && (
            <label className="upload-field">
              <span>Reference stem (optional)</span>
              <select
                value={referenceStem}
                onChange={(e) => setReferenceStem(e.target.value)}
                disabled={submitting}
              >
                <option value="">(none)</option>
                {files.map((f) => {
                  const stemName = f.file.name.replace(/\.[^.]+$/, '');
                  return (
                    <option key={f.file.name} value={stemName}>
                      {stemName}
                    </option>
                  );
                })}
              </select>
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
          <button
            type="button"
            className="upload-submit"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
          >
            {submitting ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
