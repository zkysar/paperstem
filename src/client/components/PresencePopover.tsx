import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { formatPresenceState, positionPopover, resolveDisplayName, presenceColorFor, presenceInitial } from '../lib/presence-format';
import type { PresenceRowDto } from '../lib/presence-client';

type Props = {
  mode: 'single' | 'list';
  rows: PresenceRowDto[];
  triggerRect: DOMRect;
  onClose: () => void;
};

const POPOVER_WIDTH = 220;

function estimateHeight(mode: 'single' | 'list', rowCount: number): number {
  if (mode === 'single') return 96;
  return Math.min(40 + Math.min(rowCount, 6) * 44, 320);
}

export function PresencePopover({ mode, rows, triggerRect, onClose }: Props) {
  if (rows.length === 0) return null;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const now = Date.now();

  const viewport = {
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768,
  };
  const pos = positionPopover(triggerRect, { width: POPOVER_WIDTH, height: estimateHeight(mode, rows.length) }, viewport);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (wrapperRef.current.contains(e.target as Node)) return;
      onClose();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    wrapperRef.current?.focus();
    return () => { previouslyFocused?.focus?.(); };
  }, []);

  const label = mode === 'single' ? `${resolveDisplayName(rows[0]!)} presence details` : 'More viewers';

  const body = mode === 'single'
    ? <SinglePopoverBody row={rows[0]!} now={now} />
    : <ListPopoverBody rows={rows} now={now} />;

  return createPortal(
    <div
      ref={wrapperRef}
      className="presence-popover"
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
    >
      {body}
    </div>,
    document.body,
  );
}

function SinglePopoverBody({ row, now }: { row: PresenceRowDto; now: number }) {
  const bg = presenceColorFor(row.userId);
  const name = resolveDisplayName(row);
  return (
    <div className="presence-popover-body presence-popover-single">
      <div
        className="presence-popover-avatar"
        style={{ background: bg }}
        aria-hidden="true"
      >
        {presenceInitial(name)}
      </div>
      <div className="presence-popover-name">{name}</div>
      <div className="presence-popover-state">{formatPresenceState(row, now)}</div>
    </div>
  );
}

function ListPopoverBody({ rows, now }: { rows: PresenceRowDto[]; now: number }) {
  return (
    <ul className="presence-popover-body presence-popover-list">
      {rows.map((row) => {
        const bg = presenceColorFor(row.userId);
        const name = resolveDisplayName(row);
        return (
          <li key={row.userId ?? row.lastBeatAt} className="presence-popover-list-row">
            <span className="presence-popover-list-avatar" style={{ background: bg }} aria-hidden="true">
              {presenceInitial(name)}
            </span>
            <span className="presence-popover-list-name">{name}</span>
            <span className="presence-popover-list-state">{formatPresenceState(row, now)}</span>
          </li>
        );
      })}
    </ul>
  );
}
