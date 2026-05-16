import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Annotation, Section } from '../shared/types';
import { AppToolbar } from './components/AppToolbar';
import { Player } from './components/Player';
import {
  fetchPublicAnnotations,
  fetchPublicProject,
  fetchPublicReplies,
  fetchPublicSections,
  publicAudioUrl,
  type PublicAnnotation,
  type PublicProjectDetail,
  type PublicReply,
  type PublicSection,
} from './data/public-repo';
import { useAppVersion } from './hooks/useAppVersion';
import { usePlayer } from './hooks/usePlayer';
import { useViewport } from './hooks/useViewport';
import { buildUserColorMap } from './lib/colors';
import { decodePeaks } from './lib/peaks';
import { fmt } from './lib/format';
import type { StemSource } from './data/types';

// Public view is intentionally minimal. It never imports FilePicker,
// CommentsDrawer, UploadDrawer, ShareDialog, or anything that mutates
// project data. Loaders only call /api/public/* endpoints.

type FetchState =
  | { kind: 'loading' }
  | { kind: 'error'; status: number; message: string }
  | { kind: 'ready'; detail: PublicProjectDetail };

function readTokenFromPath(): string | null {
  if (typeof window === 'undefined') return null;
  const match = window.location.pathname.match(/^\/p\/([A-Za-z0-9_-]+)\/?$/);
  return match ? match[1] : null;
}

// The public payload omits user_id / user_email so Player props are
// satisfied. We synthesize a stable pseudo-id from the display name so
// the existing color-map gives same-author comments the same colour.
function pseudoUserId(name: string | null): string {
  const base = name ?? 'anonymous';
  let h = 0;
  for (let i = 0; i < base.length; i++) {
    h = (h * 31 + base.charCodeAt(i)) | 0;
  }
  return `public:${h}`;
}

function toAnnotationForPlayer(a: PublicAnnotation): Annotation {
  const userId = pseudoUserId(a.user_display_name);
  return {
    id: a.id,
    project_id: a.project_id,
    user_id: userId,
    user_email: '',
    user_display_name: a.user_display_name,
    start_ms: a.start_ms,
    end_ms: a.end_ms,
    body: a.body,
    starred: a.starred,
    created_at: a.created_at,
    updated_at: a.updated_at,
    reply_count: a.reply_count,
    reactions: a.reactions.map((r) => ({
      emoji: r.emoji,
      count: r.count,
      user_ids: [],
      reacted_by_self: false,
    })),
  };
}

function toSectionForPlayer(s: PublicSection): Section {
  return {
    id: s.id,
    project_id: s.project_id,
    start_ms: s.start_ms,
    // Public payloads don't expose song_id (cross-project identifier).
    // Player only uses song_id for the chain-glyph use_count lookup; with
    // an empty Map (no usage data on public view) that simply renders no
    // glyph, which is the right behaviour for an external viewer anyway.
    song_id: null,
    song_name: s.song_name,
    label: s.label,
    source: s.source,
    created_at: s.created_at,
    updated_at: s.updated_at,
  };
}

export function PublicProjectView({ token }: { token: string }) {
  const player = usePlayer();
  const viewport = useViewport();
  const appInfo = useAppVersion();

  const [state, setState] = useState<FetchState>({ kind: 'loading' });
  const [annotations, setAnnotations] = useState<PublicAnnotation[]>([]);
  const [sections, setSections] = useState<PublicSection[]>([]);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [repliesByAnnId, setRepliesByAnnId] = useState<
    Map<string, PublicReply[]>
  >(() => new Map());
  const [replyError, setReplyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    (async () => {
      try {
        const detail = await fetchPublicProject(token);
        if (cancelled) return;
        setState({ kind: 'ready', detail });
        const sources: StemSource[] = detail.stems.map((s) => ({
          name: s.name,
          src: publicAudioUrl(token, s.id),
          serverId: s.id,
          peaks: s.peaks ? decodePeaks(s.peaks) : null,
        }));
        void player.load({
          projectId: detail.project.id,
          title: detail.project.name,
          folderId: null,
          sources,
        });
        try {
          const [anns, secs] = await Promise.all([
            fetchPublicAnnotations(token),
            fetchPublicSections(token),
          ]);
          if (cancelled) return;
          setAnnotations(anns);
          setSections(secs);
        } catch (err) {
          if (!cancelled) {
            console.error('public secondary fetch failed', err);
          }
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        // The server returns 410 for revoked or deleted projects; surface
        // that distinctly so the viewer knows the link is dead rather than
        // typoed.
        const isGone = /HTTP 410|drive_missing/.test(msg);
        setState({
          kind: 'error',
          status: isGone ? 410 : 404,
          message: msg,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, player]);

  const annotationsForPlayer = useMemo(
    () => annotations.map(toAnnotationForPlayer),
    [annotations],
  );
  const sectionsForPlayer = useMemo(
    () => sections.map(toSectionForPlayer),
    [sections],
  );
  const userColorMap = useMemo(
    () => buildUserColorMap(annotationsForPlayer.map((a) => a.user_id), ''),
    [annotationsForPlayer],
  );

  const handleAnnotationSelected = useCallback(
    (a: Annotation) => {
      player.seek(a.start_ms / 1000);
      setOpenThreadId(a.id);
      if (a.reply_count > 0 && !repliesByAnnId.has(a.id)) {
        void (async () => {
          try {
            const replies = await fetchPublicReplies(token, a.id);
            setRepliesByAnnId((m) => {
              const next = new Map(m);
              next.set(a.id, replies);
              return next;
            });
            setReplyError(null);
          } catch (err) {
            setReplyError(err instanceof Error ? err.message : String(err));
          }
        })();
      }
    },
    [player, repliesByAnnId, token],
  );

  const handleLoopAnnotation = useCallback(
    (a: Annotation) => {
      if (a.end_ms === null) return;
      player.setLoop(a.start_ms / 1000, a.end_ms / 1000);
      player.setLoopEnabled(true);
      player.seek(a.start_ms / 1000);
    },
    [player],
  );

  if (state.kind === 'loading') {
    return (
      <div className="public-view-shell">
        <PublicHeader bandName={null} projectTitle={null} appEnv={appInfo?.env ?? null} />
        <main className="public-view-empty">Loading…</main>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="public-view-shell">
        <PublicHeader bandName={null} projectTitle={null} appEnv={appInfo?.env ?? null} />
        <main className="public-view-empty">
          <h2>Link unavailable</h2>
          <p>
            {state.status === 410
              ? 'This share link has been revoked or the project no longer exists.'
              : "This share link doesn't seem to point at anything. Double-check the URL."}
          </p>
          <p>
            <a href="/">Open Paperstem</a>
          </p>
        </main>
      </div>
    );
  }

  const detail = state.detail;

  return (
    <div className="public-view-shell">
      <PublicHeader
        bandName={detail.project.band_name}
        projectTitle={detail.project.name}
        appEnv={appInfo?.env ?? null}
      />
      <AppToolbar
        hasProject={player.state.stems.length > 0}
        isPlaying={player.state.isPlaying}
        loopEnabled={!!player.state.loop?.enabled || player.state.loopArmed}
        loopArmed={player.state.loopArmed}
        waveformNormalization={player.state.waveformNormalization}
        masterVolume={player.state.masterVolume}
        currentTime={player.currentTime}
        duration={player.state.duration}
        annotationCreateMode={false}
        canCreateAnnotations={false}
        sectionCreateMode={false}
        canCreateSections={false}
        markersVisible={true}
        railCollapsed={false}
        showRailToggle={false}
        isWide={true}
        onSeek={player.seek}
        onTogglePlay={() => void player.togglePlay()}
        onToggleLoopEnabled={player.toggleLoopEnabled}
        onToggleWaveformNormalization={player.toggleWaveformNormalization}
        onToggleAnnotationCreate={() => undefined}
        onToggleSectionCreate={() => undefined}
        onToggleMarkersVisible={() => undefined}
        onSetMasterVolume={player.setMasterVolume}
        onToggleRailCollapsed={() => undefined}
        viewport={viewport}
        onOpenShortcuts={() => undefined}
        onShare={undefined}
      />
      <div className="public-view-body">
        <div style={{ position: 'relative', minHeight: 0, minWidth: 0 }}>
          <Player
            player={player}
            annotations={annotationsForPlayer}
            userColorMap={userColorMap}
            markersVisible={true}
            annotationCreateMode={false}
            onToggleAnnotationCreate={() => undefined}
            onAnnotationCreated={() => undefined}
            onAnnotationSelected={handleAnnotationSelected}
            onLoopAnnotation={handleLoopAnnotation}
            pendingDraft={null}
            hoveredAnnotationId={null}
            onHoverAnnotation={() => undefined}
            sections={sectionsForPlayer}
            songUseCounts={new Map()}
            activeSectionId={null}
            sectionCreateMode={false}
            onSectionSelected={(s) => player.seek(s.start_ms / 1000)}
            onSectionCreated={() => undefined}
            onPatchSection={async () => undefined}
            onPatchAnnotation={async () => undefined}
            selfUserId=""
            onToggleSectionCreate={() => undefined}
            railCollapsed={false}
            canMutate={false}
            onOpenPicker={() => undefined}
            onRenameStem={() => undefined}
            onDeleteStem={() => undefined}
            viewport={viewport}
          />
        </div>
        <PublicCommentList
          annotations={annotations}
          activeId={openThreadId}
          replies={repliesByAnnId}
          replyError={replyError}
          onSelect={(a) => handleAnnotationSelected(toAnnotationForPlayer(a))}
          onLoop={(a) => handleLoopAnnotation(toAnnotationForPlayer(a))}
        />
      </div>
    </div>
  );
}

function PublicHeader({
  bandName,
  projectTitle,
  appEnv,
}: {
  bandName: string | null;
  projectTitle: string | null;
  appEnv: string | null;
}) {
  const envBadge = appEnv && appEnv !== 'prod' ? `[${appEnv.toUpperCase()}] ` : '';
  return (
    <header className="public-view-header">
      <a className="public-view-brand" href="/">
        {envBadge}Paperstem
      </a>
      <div className="public-view-titleblock">
        {projectTitle && <h1 className="public-view-title">{projectTitle}</h1>}
        {bandName && <span className="public-view-band">{bandName}</span>}
      </div>
      <span className="public-view-spacer" />
      <span className="public-view-readonly-pill" title="Read-only public link">
        Read-only
      </span>
      <a className="public-view-signin" href="/">
        Sign in
      </a>
    </header>
  );
}

function PublicCommentList({
  annotations,
  activeId,
  replies,
  replyError,
  onSelect,
  onLoop,
}: {
  annotations: PublicAnnotation[];
  activeId: string | null;
  replies: Map<string, PublicReply[]>;
  replyError: string | null;
  onSelect(a: PublicAnnotation): void;
  onLoop(a: PublicAnnotation): void;
}) {
  if (annotations.length === 0) {
    return (
      <aside className="public-view-comments">
        <header>Comments</header>
        <p className="public-view-comments-empty">No comments yet.</p>
      </aside>
    );
  }
  return (
    <aside className="public-view-comments">
      <header>Comments ({annotations.length})</header>
      <ul>
        {annotations.map((a) => {
          const isActive = a.id === activeId;
          const ts =
            a.end_ms === null
              ? fmt(a.start_ms / 1000)
              : `${fmt(a.start_ms / 1000)} – ${fmt(a.end_ms / 1000)}`;
          const author = a.user_display_name ?? 'Anonymous';
          const annReplies = replies.get(a.id) ?? [];
          return (
            <li
              key={a.id}
              className={
                'public-view-comment' + (isActive ? ' is-active' : '')
              }
            >
              <button
                type="button"
                className="public-view-comment-head"
                onClick={() => onSelect(a)}
              >
                <span className="public-view-comment-author">{author}</span>
                <span className="public-view-comment-time">{ts}</span>
              </button>
              <p className="public-view-comment-body">{a.body}</p>
              {a.end_ms !== null && (
                <button
                  type="button"
                  className="public-view-comment-loop"
                  onClick={() => onLoop(a)}
                >
                  ↻ Loop this region
                </button>
              )}
              {a.reactions.length > 0 && (
                <div className="public-view-comment-reactions">
                  {a.reactions.map((r) => (
                    <span key={r.emoji} className="public-view-reaction-chip">
                      {r.emoji} {r.count}
                    </span>
                  ))}
                </div>
              )}
              {a.reply_count > 0 && (
                <div className="public-view-comment-replies">
                  {annReplies.length === 0 && isActive && !replyError && (
                    <p className="public-view-comments-empty">Loading replies…</p>
                  )}
                  {replyError && isActive && (
                    <p className="public-view-comments-empty">
                      Couldn't load replies.
                    </p>
                  )}
                  {annReplies.map((r) => (
                    <div key={r.id} className="public-view-reply">
                      <span className="public-view-reply-author">
                        {r.user_display_name ?? 'Anonymous'}
                      </span>
                      <p className="public-view-reply-body">{r.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

export function PublicProjectRouteWrapper() {
  const token = readTokenFromPath();
  if (!token) return null;
  return <PublicProjectView token={token} />;
}
