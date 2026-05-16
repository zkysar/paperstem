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

function Keycap({
  letter,
  glyph,
  modifier,
  size = 'md',
  muted = false,
}: {
  letter: string;
  glyph?: React.ReactNode;
  modifier?: string;
  size?: 'sm' | 'md';
  muted?: boolean;
}) {
  return (
    <span
      className={[
        'keycap',
        `keycap--${size}`,
        muted ? 'keycap--muted' : '',
      ].filter(Boolean).join(' ')}
    >
      {modifier && <span className="keycap__mod">{modifier}</span>}
      <span className="keycap__letter">{letter}</span>
      {glyph && <span className="keycap__glyph">{glyph}</span>}
    </span>
  );
}

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
        { keys: k(['←', '→']), label: 'Nudge playhead 0.1s' },
        { keys: <><kbd>{a}{plus}←</kbd><kbd>{a}{plus}→</kbd></>, label: 'Shift playhead 1s' },
        { keys: <><kbd>{s}{plus}←</kbd><kbd>{s}{plus}→</kbd></>, label: 'Jump playhead 5s' },
        { keys: k(['L']), label: 'Toggle loop on/off (when loop is set)' },
        { keys: k(['Esc']), label: 'Clear loop / dismiss overlays' },
      ],
    },
    {
      title: 'General',
      items: [
        { keys: <><kbd>{m}{plus}K</kbd></>, label: 'Open project picker' },
        { keys: k(['C']), label: 'Add comment at playhead' },
        { keys: k(['M']), label: 'Add section (song marker) at playhead' },
        {
          keys: <><kbd>{s}{plus}M</kbd></>,
          label: 'Mark section end at playhead (no next song)',
        },
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
          <section className="shortcuts-section shortcuts-wasd">
            <h3>Zoom &amp; navigation</h3>
            <div className="wasd-clusters" aria-hidden="true">
              <figure className="wasd-mode">
                <div className="wasd-cluster">
                  <div className="wasd-row">
                    <Keycap letter="W" glyph="+" />
                  </div>
                  <div className="wasd-row">
                    <Keycap letter="A" glyph="←" />
                    <Keycap letter="S" glyph="−" />
                    <Keycap letter="D" glyph="→" />
                  </div>
                </div>
                <figcaption>Zoom horizontal · pan</figcaption>
              </figure>
              <div className="wasd-divider">
                <span>+</span>
                <kbd>{s}</kbd>
              </div>
              <figure className="wasd-mode">
                <div className="wasd-cluster">
                  <div className="wasd-row">
                    <Keycap letter="W" modifier={s} glyph="+" />
                  </div>
                  <div className="wasd-row">
                    <Keycap letter="A" muted />
                    <Keycap letter="S" modifier={s} glyph="−" />
                    <Keycap letter="D" muted />
                  </div>
                </div>
                <figcaption>Zoom vertical (track height)</figcaption>
              </figure>
            </div>
            <ul className="visually-hidden">
              <li>Press W or S to zoom horizontally; the playhead stays anchored.</li>
              <li>Press A or D to pan left or right when zoomed in.</li>
              <li>Hold Shift with W or S to zoom vertically (track height).</li>
            </ul>
            <p className="wasd-fit">
              <kbd>{m}{plus}0</kbd> Fit to window (reset zoom)
            </p>
            <p className="shortcuts-also">
              Also: <kbd>{m}{plus}=</kbd> / <kbd>{m}{plus}−</kbd> zoom ·{' '}
              <kbd>{a}{plus}scroll</kbd> zoom from cursor ·{' '}
              <kbd>{s}{plus}scroll</kbd> pan
            </p>
          </section>
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
