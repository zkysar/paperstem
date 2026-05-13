import { useEffect } from 'react';
import { isMac, keyGlyph } from '../lib/platform';

type Shortcut = { keys: React.ReactNode; label: string; note?: string };
type Section = { title: string; items: Shortcut[] };

type Props = {
  open: boolean;
  onClose(): void;
  /** Override platform detection in tests. */
  forceMac?: boolean;
};

export function ShortcutsOverlay({ open, onClose, forceMac }: Props) {
  const mac = forceMac ?? isMac();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const m = keyGlyph('mod', mac);
  const a = keyGlyph('alt', mac);
  const s = keyGlyph('shift', mac);
  const plus = mac ? '' : '+';
  const k = (parts: string[]) => parts.map((p, i) => (
    <kbd key={i}>{p}</kbd>
  ));

  const sections: Section[] = [
    {
      title: 'Playback',
      items: [
        { keys: k(['Space']), label: 'Play / pause' },
        { keys: k(['L']), label: 'Toggle loop on/off (when loop is set)' },
        { keys: k(['Esc']), label: 'Clear loop / dismiss overlays' },
      ],
    },
    {
      title: 'Focused track',
      items: [
        { keys: k(['M']), label: 'Mute / unmute', note: 'click a track to focus it' },
        { keys: k(['O']), label: 'Solo / unsolo', note: 'click a track to focus it' },
      ],
    },
    {
      title: 'Zoom & navigation',
      items: [
        {
          keys: <>
            <kbd>W</kbd> / <kbd>S</kbd>
            {' · '}
            <kbd>{m}{plus}=</kbd> / <kbd>{m}{plus}-</kbd>
            {' · '}
            <kbd>{a}{plus}scroll</kbd>
          </>,
          label: 'Horizontal zoom in / out',
          note: 'scroll is mouse-anchored; keys are playhead-anchored',
        },
        {
          keys: <>
            <kbd>{s}{plus}W</kbd> / <kbd>{s}{plus}S</kbd>
            {' · '}
            <kbd>{s}{plus}{m}{plus}=</kbd> / <kbd>{s}{plus}{m}{plus}-</kbd>
            {' · '}
            <kbd>{a}{plus}{s}{plus}scroll</kbd>
          </>,
          label: 'Vertical zoom in / out (track height)',
        },
        {
          keys: <>
            <kbd>A</kbd> / <kbd>D</kbd>
            {' · '}
            <kbd>{s}{plus}scroll</kbd>
          </>,
          label: 'Pan left / right (when zoomed)',
        },
        { keys: <><kbd>{m}{plus}0</kbd></>, label: 'Fit to window (reset zoom)' },
      ],
    },
    {
      title: 'General',
      items: [
        { keys: <><kbd>{m}{plus}K</kbd></>, label: 'Open file picker' },
        { keys: k(['?']), label: 'This help' },
      ],
    },
  ];

  return (
    <div
      className="shortcuts-scrim"
      role="presentation"
      data-testid="shortcuts-scrim"
      onClick={onClose}
    >
      <div
        className="shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shortcuts-header">
          <h2>Keyboard shortcuts</h2>
          <button
            type="button"
            className="shortcuts-close"
            onClick={onClose}
            aria-label="Close shortcuts"
          >
            ×
          </button>
        </header>
        <div className="shortcuts-body">
          {sections.map((sec) => (
            <section key={sec.title} className="shortcuts-section">
              <h3>{sec.title}</h3>
              <dl>
                {sec.items.map((it, i) => (
                  <div className="shortcuts-row" key={i}>
                    <dt>{it.keys}</dt>
                    <dd>
                      {it.label}
                      {it.note && <span className="shortcuts-note"> — {it.note}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
