import { useEffect, useRef, useState } from 'react';
import { Camera, ChevronLeft, X } from 'lucide-react';
import { captureCurrentTab, type Screenshot } from '../lib/captureScreenshot';
import {
  getRecentClientErrors,
  type ClientErrorEntry,
} from '../lib/clientErrorBuffer';
import { ScreenshotCropper } from './ScreenshotCropper';

export type BugReportPrefill = {
  description?: string;
  errors?: ClientErrorEntry[];
};

export type BugReportPageContext = Record<string, unknown>;

type Props = {
  open: boolean;
  isNarrow: boolean;
  reporterEmail: string;
  appVersion: string | null;
  prefill: BugReportPrefill | null;
  pageContext: BugReportPageContext;
  onClose(): void;
};

type ShotState =
  | { kind: 'none' }
  | { kind: 'capturing' }
  | { kind: 'cropping'; source: Screenshot }
  | { kind: 'attached'; shot: Screenshot };

const PLACEHOLDER = [
  'What were you trying to do?',
  'What happened instead?',
  'Anything else?',
].join('\n');

export function BugReportDrawer({
  open,
  isNarrow,
  reporterEmail,
  appVersion,
  prefill,
  pageContext,
  onClose,
}: Props) {
  const [description, setDescription] = useState('');
  const [extraErrors, setExtraErrors] = useState<ClientErrorEntry[]>([]);
  const [shotState, setShotState] = useState<ShotState>({ kind: 'none' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sentMessage, setSentMessage] = useState<string | null>(null);

  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    setDescription(prefill?.description ?? '');
    setExtraErrors(prefill?.errors ?? []);
    setShotState({ kind: 'none' });
    setSubmitting(false);
    setSubmitError(null);
    setSentMessage(null);
  }, [open, prefill]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  if (!open) return null;

  const drawerHidden =
    shotState.kind === 'capturing' || shotState.kind === 'cropping';

  async function handleAddScreenshot(): Promise<void> {
    setSubmitError(null);
    setShotState({ kind: 'capturing' });
    // Give the drawer a frame to slide out so it doesn't appear in the capture.
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    const shot = await captureCurrentTab();
    if (!shot) {
      setShotState({ kind: 'none' });
      setSubmitError("Couldn't capture the screen. You can still send the report.");
      return;
    }
    setShotState({ kind: 'cropping', source: shot });
  }

  function handleRemoveScreenshot(): void {
    setShotState({ kind: 'none' });
  }

  async function handleSubmit(): Promise<void> {
    if (description.trim().length === 0) return;
    setSubmitting(true);
    setSubmitError(null);

    const errors = [...getRecentClientErrors(), ...extraErrors].slice(-10);
    const screenshotBase64 =
      shotState.kind === 'attached' ? shotState.shot.base64 : undefined;

    const payload = {
      description,
      url: window.location.href,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      userAgent: navigator.userAgent,
      pageContext,
      recentErrors: errors,
      appVersion: appVersion ?? 'unknown',
      ...(screenshotBase64 ? { screenshotBase64 } : {}),
    };

    let res: Response;
    try {
      res = await fetch('/api/bug-report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
    } catch (err) {
      setSubmitting(false);
      setSubmitError(err instanceof Error ? err.message : 'Network error');
      return;
    }

    if (res.status === 429) {
      setSubmitting(false);
      setSubmitError('Please wait a few minutes before sending another report.');
      return;
    }
    if (!res.ok) {
      setSubmitting(false);
      setSubmitError("Couldn't send. Please try again.");
      return;
    }

    setSubmitting(false);
    setSentMessage('Sent. Thanks.');
    if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, 1800);
  }

  return (
    <>
      {!isNarrow && (
        <div
          data-testid="bug-drawer-backdrop"
          className="comments-drawer-backdrop"
          onPointerDown={(e) => {
            e.stopPropagation();
            if (!submitting) onClose();
          }}
          aria-hidden="true"
        />
      )}
      <aside
        className={
          'bug-drawer' +
          (isNarrow ? ' narrow' : '') +
          (drawerHidden ? ' hidden-for-capture' : '')
        }
        role="dialog"
        aria-label="Report a bug"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="bd-head">
          {isNarrow && (
            <button
              type="button"
              className="bd-back"
              aria-label="Back"
              onClick={onClose}
              disabled={submitting}
            >
              <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
          <h2 className="bd-title">Report a bug</h2>
          {!isNarrow && (
            <button
              type="button"
              className="bd-close"
              aria-label="Close"
              onClick={onClose}
              disabled={submitting}
            >
              <X size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </header>

        <div className="bd-body">
          {sentMessage ? (
            <div className="bd-sent">{sentMessage}</div>
          ) : (
            <>
              <textarea
                className="bd-textarea"
                autoFocus
                rows={6}
                value={description}
                placeholder={PLACEHOLDER}
                onChange={(e) => setDescription(e.target.value)}
                disabled={submitting}
                aria-label="Describe the bug"
                maxLength={5000}
              />

              <div className="bd-screenshot">
                {shotState.kind === 'attached' ? (
                  <div className="bd-shot-captured">
                    <img
                      src={shotState.shot.dataUrl}
                      alt="Captured screenshot"
                      className="bd-shot-thumb"
                    />
                    <div className="bd-shot-verify">
                      <div className="bd-shot-verify-text">Does this look right?</div>
                      <div className="bd-shot-actions">
                        <button
                          type="button"
                          onClick={() => void handleAddScreenshot()}
                          disabled={submitting}
                        >
                          Retake
                        </button>
                        <button
                          type="button"
                          onClick={handleRemoveScreenshot}
                          disabled={submitting}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="bd-shot-btn"
                    onClick={() => void handleAddScreenshot()}
                    disabled={submitting || shotState.kind === 'capturing'}
                  >
                    <Camera size={14} strokeWidth={2} aria-hidden="true" />
                    {shotState.kind === 'capturing'
                      ? 'Capturing…'
                      : 'Add screenshot'}
                  </button>
                )}
              </div>

              <div className="bd-disclosure">
                Goes to Zach. We'll reply to <code>{reporterEmail}</code> if
                there are questions. Includes current page state.
              </div>

              {submitError && (
                <div className="bd-error" role="alert">
                  {submitError}
                </div>
              )}

              <div className="bd-actions">
                <button
                  type="button"
                  className="bd-send"
                  onClick={() => void handleSubmit()}
                  disabled={submitting || description.trim().length === 0}
                >
                  {submitting ? 'Sending…' : 'Send'}
                </button>
              </div>
            </>
          )}
        </div>
      </aside>

      {shotState.kind === 'cropping' && (
        <ScreenshotCropper
          source={shotState.source}
          onUse={(shot) => setShotState({ kind: 'attached', shot })}
          onCancel={() => setShotState({ kind: 'none' })}
        />
      )}
    </>
  );
}
