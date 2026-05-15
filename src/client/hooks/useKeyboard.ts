import { useEffect } from 'react';
import type { PlayerControls } from './usePlayer';
import type { ViewportControls } from './useViewport';

/**
 * Anchor for keyboard zoom: the playhead's pixel position inside the stage
 * when it lies within the visible viewport, otherwise the stage center.
 * Cursor-driven zoom (Alt+scroll, pinch) anchors at the actual pointer;
 * keyboard zoom has no pointer, so the playhead — the place the user is
 * already listening to — is the next-most-specific signal.
 */
function playheadAnchorX(
  stageWidth: number,
  player: PlayerControls,
  viewport: ViewportControls,
): number {
  const duration = player.state.duration;
  const hZoom = viewport.state.hZoom;
  if (!duration || stageWidth <= 0 || hZoom <= 0) return stageWidth / 2;
  const innerWidth = stageWidth * hZoom;
  const playheadInnerX = (player.currentTime / duration) * innerWidth;
  const playheadStageX = playheadInnerX - viewport.state.scrollLeft;
  if (!Number.isFinite(playheadStageX)) return stageWidth / 2;
  if (playheadStageX < 0 || playheadStageX > stageWidth) {
    return stageWidth / 2;
  }
  return playheadStageX;
}

export type KeyboardOpts = {
  player: PlayerControls;
  pickerOpen: boolean;
  drawerOpen: boolean;
  popoverOpen: boolean;
  annotationCreateMode: boolean;
  sectionCreateMode: boolean;
  viewport: ViewportControls;
  onTogglePicker(): void;
  onClosePicker(): void;
  onCloseDrawer(): void;
  onClosePopover(): void;
  onCancelCreate(): void;
  onToggleShortcuts(): void;
  onAddCommentAtPlayhead(): void;
  onAddSectionAtPlayhead(): void;
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
    sectionCreateMode,
    onTogglePicker,
    onClosePicker,
    onCloseDrawer,
    onClosePopover,
    onCancelCreate,
    onAddCommentAtPlayhead,
    onAddSectionAtPlayhead,
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
          const anchorX = playheadAnchorX(sw, player, opts.viewport);
          opts.viewport.zoomH('in', { stageWidth: sw, anchorX });
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
          const anchorX = playheadAnchorX(sw, player, opts.viewport);
          opts.viewport.zoomH('out', { stageWidth: sw, anchorX });
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
        if (annotationCreateMode || sectionCreateMode) {
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
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        onAddCommentAtPlayhead();
      } else if (e.key === 'm' || e.key === 'M') {
        // M drops a section at the playhead, mirroring C for comments.
        // Chosen because S/W/A/D are taken by stem solo + WASD pan/zoom.
        e.preventDefault();
        onAddSectionAtPlayhead();
      } else if (
        e.key === 'w' || e.key === 'W' ||
        e.key === 'a' || e.key === 'A' ||
        e.key === 's' || e.key === 'S' ||
        e.key === 'd' || e.key === 'D'
      ) {
        // WASD: W/S = horizontal zoom in/out (like a map), A/D = horizontal
        // pan. Shift modifies W/S to vertical zoom (track height) — pairs
        // with the ⌘= vs ⇧⌘= chord convention. Holding the key triggers OS
        // key-repeat for continuous zoom/pan. Pan step = ~1/6 of the viewport
        // so a few keystrokes traverse the visible window.
        const viewportEl = document.querySelector('.viewport') as HTMLDivElement | null;
        const stage = document.querySelector('.stage') as HTMLDivElement | null;
        if (!viewportEl || !stage) return;
        e.preventDefault();
        const sw = stage.getBoundingClientRect().width || 800;
        const step = Math.round(viewportEl.clientWidth / 6);
        switch (e.key.toLowerCase()) {
          case 'w':
            if (e.shiftKey) {
              opts.viewport.zoomV('in');
            } else {
              const anchorX = playheadAnchorX(sw, player, opts.viewport);
              opts.viewport.zoomH('in', { stageWidth: sw, anchorX });
              if (opts.viewport.state.followActive) opts.viewport.setFollowActive(false);
            }
            break;
          case 's':
            if (e.shiftKey) {
              opts.viewport.zoomV('out');
            } else {
              const anchorX = playheadAnchorX(sw, player, opts.viewport);
              opts.viewport.zoomH('out', { stageWidth: sw, anchorX });
              if (opts.viewport.state.followActive) opts.viewport.setFollowActive(false);
            }
            break;
          case 'a':
            opts.viewport.setScrollLeft(
              viewportEl.scrollLeft - step,
              viewportEl.scrollWidth - viewportEl.clientWidth,
            );
            if (opts.viewport.state.followActive) opts.viewport.setFollowActive(false);
            break;
          case 'd':
            opts.viewport.setScrollLeft(
              viewportEl.scrollLeft + step,
              viewportEl.scrollWidth - viewportEl.clientWidth,
            );
            if (opts.viewport.state.followActive) opts.viewport.setFollowActive(false);
            break;
        }
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
    sectionCreateMode,
    onTogglePicker,
    onClosePicker,
    onCloseDrawer,
    onClosePopover,
    onCancelCreate,
    onAddCommentAtPlayhead,
    onAddSectionAtPlayhead,
  ]);
}
