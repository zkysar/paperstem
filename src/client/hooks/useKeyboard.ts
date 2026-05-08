import { useEffect } from 'react';
import type { PlayerControls } from './usePlayer';

export type KeyboardOpts = {
  player: PlayerControls;
  pickerOpen: boolean;
  annotationsOpen: boolean;
  annotationCreateMode: boolean;
  onTogglePicker(): void;
  onClosePicker(): void;
  onCloseRail(): void;
  onCancelCreate(): void;
};

/**
 * Global keyboard shortcuts hook.
 *
 * Note on focus return: this hook does NOT manage focus return when overlays
 * close. Callers (App.tsx) should snapshot `document.activeElement` when an
 * overlay opens and call `.focus()` on that element when it closes.
 */
export function useKeyboard(opts: KeyboardOpts): void {
  const {
    player,
    pickerOpen,
    annotationsOpen,
    annotationCreateMode,
    onTogglePicker,
    onClosePicker,
    onCloseRail,
    onCancelCreate,
  } = opts;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isTextField =
        !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

      // Cmd/Ctrl+K toggles picker. Allowed even from text fields so the
      // shortcut is reachable from any focus.
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onTogglePicker();
        return;
      }

      if (isTextField) return;

      const { state } = player;

      // Esc precedence resolver: picker > rail-with-focus > create-mode > clear-loop.
      if (e.key === 'Escape') {
        if (pickerOpen) {
          e.preventDefault();
          onClosePicker();
          return;
        }
        if (annotationsOpen) {
          const active = document.activeElement;
          const railEl = document.querySelector('.annotations-rail');
          if (railEl && active && railEl.contains(active)) {
            e.preventDefault();
            onCloseRail();
            return;
          }
        }
        if (annotationCreateMode) {
          e.preventDefault();
          onCancelCreate();
          return;
        }
        // Existing fallback: clear loop.
        if (state.loop) {
          e.preventDefault();
          player.clearLoop();
        }
        return;
      }

      if (e.code === 'Space') {
        if (state.stems.length) {
          e.preventDefault();
          void player.togglePlay();
        }
      } else if (e.key === 'l' || e.key === 'L') {
        if (state.loop) {
          e.preventDefault();
          player.toggleLoopEnabled();
        }
      } else if ((e.key === 'm' || e.key === 'M') && state.focusedIdx >= 0) {
        e.preventDefault();
        player.toggleMute(state.focusedIdx);
      } else if ((e.key === 's' || e.key === 'S') && state.focusedIdx >= 0) {
        e.preventDefault();
        player.toggleSolo(state.focusedIdx);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [
    player,
    pickerOpen,
    annotationsOpen,
    annotationCreateMode,
    onTogglePicker,
    onClosePicker,
    onCloseRail,
    onCancelCreate,
  ]);
}
