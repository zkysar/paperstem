import { useEffect } from 'react';
import type { PlayerControls } from './usePlayer';

export function useKeyboard(player: PlayerControls): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      const { state } = player;
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
      } else if (e.key === 'Escape') {
        if (state.loop) {
          e.preventDefault();
          player.clearLoop();
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
  }, [player]);
}
