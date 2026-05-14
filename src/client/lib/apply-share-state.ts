import type { PlayerControls } from '../hooks/usePlayer';
import type { ShareState } from './share-url';

export type ApplyResult = {
  appliedCategories: Array<'loop' | 'mix' | 'comment'>;
  time: number | null;
};

export type ApplyContext = {
  player: PlayerControls;
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
  const { player } = ctx;
  const cats: Array<'loop' | 'mix' | 'comment'> = [];

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

  let appliedTime: number | null = null;
  if (state.time != null) {
    const duration = player.state.duration;
    const clamped = duration > 0 ? Math.max(0, Math.min(duration, state.time)) : Math.max(0, state.time);
    player.seek(clamped);
    appliedTime = clamped;
  }

  return { appliedCategories: cats, time: appliedTime };
}
