import { useEffect, useMemo, useState } from 'react';
import type { Annotation } from '../../shared/types';
import {
  buildPublicShareUrl,
  buildShareUrl,
  type ShareState,
} from '../lib/share-url';
import { fmt } from '../lib/format';
import { PublicLinkSection } from './PublicLinkSection';

/**
 * Modal for previewing and copying a share URL. Modelled on YouTube's
 * share dialog: the user sees exactly what's bundled into the link and
 * can toggle each piece on/off before copying. The "Linked to …" subhead
 * reframes the URL based on what's checked — comment focus, loop range,
 * or just a playhead time — so loop-only shares feel as intentional as
 * comment-anchored ones (no comment needed).
 *
 * Master volume is bundled with the "Stem mix" toggle: they're both audio
 * settings and a single row keeps the UI scannable.
 */

type Props = {
  open: boolean;
  /** Snapshot of state to share. Toggles peel pieces back off this. */
  state: ShareState;
  /**
   * Annotation that the dialog was opened from (comment copy-link flow),
   * used to label the "Linked to …" subhead and the comment toggle row.
   * Null when opened from the toolbar Share button.
   */
  focusedAnnotation: Annotation | null;
  /**
   * When set, the dialog is shown to a public (`/p/<token>`) viewer: the URL
   * becomes a token link carrying the state in its hash, and the owner-only
   * link-management section is hidden (the viewer isn't authenticated).
   */
  publicToken?: string;
  onClose(): void;
};

type Toggleable = 'time' | 'loop' | 'mix' | 'view' | 'comment';

export function ShareDialog({ open, state, focusedAnnotation, publicToken, onClose }: Props) {
  const available = useMemo(() => availability(state, focusedAnnotation), [state, focusedAnnotation]);

  const [include, setInclude] = useState<Record<Toggleable, boolean>>(available);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed toggles each time the dialog opens with new state.
  useEffect(() => {
    if (!open) return;
    setInclude(available);
    setCopied(false);
    setError(null);
  }, [open, available]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const effective: ShareState = useMemo(() => ({
    projectId: state.projectId,
    time: include.time ? state.time : undefined,
    loop: include.loop ? state.loop : undefined,
    mix: include.mix ? state.mix : undefined,
    masterVolume: include.mix ? state.masterVolume : undefined,
    view: include.view ? state.view : undefined,
    trackHeight: include.view ? state.trackHeight : undefined,
    focusedCommentId: include.comment ? state.focusedCommentId : undefined,
  }), [state, include]);

  const url = useMemo(() => {
    const origin =
      typeof window === 'undefined' ? 'https://paperstem.app' : window.location.origin;
    return publicToken
      ? buildPublicShareUrl(publicToken, effective, origin)
      : buildShareUrl(
          effective,
          typeof window === 'undefined' ? 'https://paperstem.app/' : window.location.href,
        );
  }, [effective, publicToken]);

  if (!open) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setError(null);
    } catch {
      setError("Couldn't copy automatically. Select the URL and press ⌘C / Ctrl+C.");
    }
  }

  function toggle(key: Toggleable) {
    setInclude((cur) => ({ ...cur, [key]: !cur[key] }));
    setCopied(false);
  }

  const rows = buildRows(state, focusedAnnotation);
  const linkedTo = describeLinkedTo(effective, focusedAnnotation);

  return (
    <div className="share-dialog-scrim" role="presentation" onClick={onClose}>
      <div
        className="share-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Share link"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="share-dialog-header">
          <h2>Share link</h2>
          <button
            type="button"
            className="share-dialog-close"
            aria-label="Close share dialog"
            onClick={onClose}
          >×</button>
        </header>
        <div className="share-dialog-body">
          <p className="share-dialog-target" data-testid="share-dialog-target">{linkedTo}</p>

          {rows.length > 0 ? (
            <>
              <h3 className="share-dialog-section-title">What's in the link</h3>
              <ul className="share-dialog-toggles">
                {rows.map((r) => (
                  <li key={r.key} className="share-dialog-toggle-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={include[r.key]}
                        onChange={() => toggle(r.key)}
                      />
                      <span className="share-dialog-toggle-label">{r.label}</span>
                      <span className="share-dialog-toggle-detail">{r.detail}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="share-dialog-empty">Only the project itself — no extra state.</p>
          )}

          <div className="share-dialog-url-row">
            <input
              type="text"
              className="share-dialog-url"
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Share URL"
            />
            <button
              type="button"
              className={'share-dialog-copy' + (copied ? ' copied' : '')}
              onClick={() => void copy()}
            >
              {copied ? 'Copied ✓' : 'Copy link'}
            </button>
          </div>
          {error && (
            <p className="share-dialog-error" role="alert">{error}</p>
          )}

          {!publicToken && state.projectId && (
            <PublicLinkSection projectId={state.projectId} state={effective} />
          )}
        </div>
      </div>
    </div>
  );
}

function availability(state: ShareState, annotation: Annotation | null): Record<Toggleable, boolean> {
  const hasMix = (state.mix != null && state.mix.length > 0)
    || (state.masterVolume != null && state.masterVolume !== 100);
  return {
    time: state.time != null && state.time > 0,
    loop: state.loop != null,
    mix: hasMix,
    view: state.view != null || state.trackHeight != null,
    comment: state.focusedCommentId != null && annotation != null,
  };
}

type Row = { key: Toggleable; label: string; detail: string };

function buildRows(state: ShareState, annotation: Annotation | null): Row[] {
  const rows: Row[] = [];
  if (state.time != null && state.time > 0) {
    rows.push({ key: 'time', label: 'Start time', detail: fmt(state.time) });
  }
  if (state.loop) {
    const enabled = state.loop.enabled ? '' : ' (off)';
    rows.push({
      key: 'loop',
      label: 'Loop region',
      detail: `${fmt(state.loop.start)} – ${fmt(state.loop.end)}${enabled}`,
    });
  }
  const mixDetail = describeMix(state);
  if (mixDetail) {
    rows.push({ key: 'mix', label: 'Stem mix', detail: mixDetail });
  }
  if (state.view || state.trackHeight != null) {
    rows.push({ key: 'view', label: 'Zoom & scroll', detail: describeView(state) });
  }
  if (state.focusedCommentId && annotation) {
    const who = annotation.user_display_name ?? annotation.user_email;
    rows.push({
      key: 'comment',
      label: 'Focused comment',
      detail: `${who} · ${fmt(annotation.start_ms / 1000)}`,
    });
  }
  return rows;
}

function describeLinkedTo(state: ShareState, annotation: Annotation | null): string {
  if (state.focusedCommentId && annotation) {
    const who = annotation.user_display_name ?? annotation.user_email;
    return `Linked to ${who}'s comment at ${fmt(annotation.start_ms / 1000)}`;
  }
  if (state.loop) {
    return `Linked to loop ${fmt(state.loop.start)} – ${fmt(state.loop.end)}`;
  }
  if (state.time != null && state.time > 0) {
    return `Linked at ${fmt(state.time)}`;
  }
  return 'Project link';
}

function describeMix(state: ShareState): string {
  const bits: string[] = [];
  if (state.masterVolume != null && state.masterVolume !== 100) {
    bits.push(`master ${state.masterVolume}`);
  }
  const muted = state.mix?.filter((m) => m.muted).length ?? 0;
  const solo = state.mix?.filter((m) => m.soloed).length ?? 0;
  const vol = state.mix?.filter((m) => m.volume != null).length ?? 0;
  if (muted) bits.push(`${muted} muted`);
  if (solo) bits.push(`${solo} solo`);
  if (vol) bits.push(`${vol} per-stem volume`);
  return bits.join(', ');
}

function describeView(state: ShareState): string {
  const bits: string[] = [];
  if (state.view) bits.push(`${fmt(state.view.timeLeft)} – ${fmt(state.view.timeRight)}`);
  if (state.trackHeight != null) bits.push(`tracks ${state.trackHeight}px`);
  return bits.join(', ');
}
