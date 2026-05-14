import type { PlayerControls } from '../hooks/usePlayer';
import type { ViewportControls } from '../hooks/useViewport';
import type { ShareState } from './share-url';

export type ApplyResult = {
  appliedCategories: Array<'loop' | 'mix' | 'comment' | 'view'>;
  time: number | null;
};

export type ApplyContext = {
  player: PlayerControls;
  viewport: ViewportControls;
  onFocusComment: (id: string) => void;
  onOpenDrawer: () => void;
};

/**
 * Apply a parsed ShareState to the live player. Returns a summary used by the
 * arrival banner. Pure with respect to its inputs — all side effects happen
 * via the supplied controls/callbacks.
 *
 * Order matters: loop → mix → master volume → focused comment → seek. Seek
 * lands last so the player has a fully-realized state when the playhead moves;
 * the recipient is responsible for starting playback.
 */
export function applyShareState(state: ShareState, ctx: ApplyContext): ApplyResult {
  const { player, viewport } = ctx;
  const cats: Array<'loop' | 'mix' | 'comment' | 'view'> = [];

  if (state.loop) {
    player.setLoop(state.loop.start, state.loop.end);
    player.setLoopEnabled(state.loop.enabled);
    cats.push('loop');
  }

  if (state.mix && state.mix.length) {
    let mixApplied = false;
    for (const entry of state.mix) {
      const idx = player.state.stems.findIndex((s) => s.serverId === entry.stemId);
      if (idx < 0) continue;
      const stem = player.state.stems[idx];
      if (entry.muted && !stem.userMuted) player.toggleMute(idx);
      if (entry.soloed && !stem.soloed) player.toggleSolo(idx);
      if (entry.volume != null && entry.volume !== stem.userVolume) {
        player.setVolume(idx, entry.volume);
      }
      mixApplied = true;
    }
    if (mixApplied) cats.push('mix');
  }

  if (state.masterVolume != null) {
    player.setMasterVolume(state.masterVolume);
  }

  if (state.focusedCommentId) {
    ctx.onFocusComment(state.focusedCommentId);
    ctx.onOpenDrawer();
    cats.push('comment');
  }

  // View (zoom + scroll) applied before seek so the smooth-follow loop, when
  // playback starts, animates from the shared view rather than a fit-to-window
  // state. The visible time window is reconstructed using the recipient's
  // own stage/rail measurements so the same time range is visible regardless
  // of screen size.
  let viewApplied = false;
  const setView: { hZoom?: number; trackHeight?: number; scrollLeft?: number } = {};
  if (state.view) {
    const { stageWidth, railWidth } = viewport.state;
    const duration = player.state.duration;
    const span = state.view.timeRight - state.view.timeLeft;
    if (stageWidth > 0 && duration > 0 && span > 0) {
      const waveVisible = Math.max(1, stageWidth - railWidth);
      // wave = waveVisible × duration / span — the wave-area width that maps
      // the requested time span onto the visible wave column.
      const wave = (waveVisible * duration) / span;
      const innerWidth = wave + railWidth;
      const hZoom = innerWidth / stageWidth;
      const scrollLeft = (state.view.timeLeft / duration) * wave;
      setView.hZoom = hZoom;
      setView.scrollLeft = scrollLeft;
      viewApplied = true;
    }
  }
  if (state.trackHeight != null) {
    setView.trackHeight = state.trackHeight;
    viewApplied = true;
  }
  if (viewApplied) {
    viewport.setView(setView);
    cats.push('view');
  }

  let appliedTime: number | null = null;
  if (state.time != null) {
    const duration = player.state.duration;
    const clamped = duration > 0 ? Math.max(0, Math.min(duration, state.time)) : Math.max(0, state.time);
    player.seek(clamped);
    appliedTime = clamped;
  }

  return { appliedCategories: cats, time: appliedTime };
}
