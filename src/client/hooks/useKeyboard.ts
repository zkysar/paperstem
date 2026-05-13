import { useEffect } from 'react';
import type { PlayerControls } from './usePlayer';
import type { ViewportControls } from './useViewport';

export type KeyboardOpts = {
  player: PlayerControls;
  pickerOpen: boolean;
  drawerOpen: boolean;
  popoverOpen: boolean;
  annotationCreateMode: boolean;
  viewport: ViewportControls;
  onTogglePicker(): void;
  onClosePicker(): void;
  onCloseDrawer(): void;
  onClosePopover(): void;
  onCancelCreate(): void;
  onToggleShortcuts(): void;
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
    drawerOpen,
    popoverOpen,
    annotationCreateMode,
    onTogglePicker,
    onClosePicker,
    onCloseDrawer,
    onClosePopover,
    onCancelCreate,
  } = opts;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isTextField =
        !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onTogglePicker();
        return;
      }

      // Zoom chords: ⌘= / ⌘- (horizontal), ⇧⌘= / ⇧⌘- (vertical), ⌘0 (fit).
      // Run before the isTextField guard so users zoom while focused in a
      // rename field; these aren't characters anyone would type in text.
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        const stage = document.querySelector('.stage') as HTMLDivElement | null;
        const rect = stage?.getBoundingClientRect();
        const sw = rect?.width ?? 800;
        if (e.shiftKey) {
          opts.viewport.zoomV('in');
        } else {
          opts.viewport.zoomH('in', { stageWidth: sw, anchorX: sw / 2 });
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '-') {
        e.preventDefault();
        const stage = document.querySelector('.stage') as HTMLDivElement | null;
        const rect = stage?.getBoundingClientRect();
        const sw = rect?.width ?? 800;
        if (e.shiftKey) {
          opts.viewport.zoomV('out');
        } else {
          opts.viewport.zoomH('out', { stageWidth: sw, anchorX: sw / 2 });
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        e.preventDefault();
        opts.viewport.fitToWindow();
        return;
      }

      if (isTextField) return;

      // ? opens the shortcuts overlay (not inside text inputs).
      if (e.key === '?') {
        e.preventDefault();
        opts.onToggleShortcuts();
        return;
      }

      const { state } = player;

      if (e.key === 'Escape') {
        if (pickerOpen) {
          e.preventDefault();
          onClosePicker();
          return;
        }
        if (popoverOpen) {
          e.preventDefault();
          onClosePopover();
          return;
        }
        if (drawerOpen) {
          e.preventDefault();
          onCloseDrawer();
          return;
        }
        if (annotationCreateMode) {
          e.preventDefault();
          onCancelCreate();
          return;
        }
        if (state.loop) {
          e.preventDefault();
          player.clearLoop();
        }
        return;
      }

      if (e.code === 'Space') {
        if (state.stems.length) {
          e.preventDefault();
          opts.viewport.setFollowActive(true);
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
    drawerOpen,
    popoverOpen,
    annotationCreateMode,
    onTogglePicker,
    onClosePicker,
    onCloseDrawer,
    onClosePopover,
    onCancelCreate,
  ]);
}
