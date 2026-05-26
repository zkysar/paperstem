import { render } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { PlayerControls } from '../hooks/usePlayer';
import type { ViewportControls, ViewportState } from '../hooks/useViewport';
import type { PlayerState } from '../data/types';

// Opening a project focused on a filtered song bumps revealLaneNonce; on
// mobile that should reveal the (collapsed) section lane so the focused
// song's label is legible. The lane's actual pill rendering depends on
// measured geometry (waveWidthPx), which happy-dom reports as 0, so we
// can't assert on the rendered lane. Instead we stub SectionLane and
// capture the `expanded` prop Player computes — that's the wiring under test.
const mobile = vi.hoisted(() => ({ value: false }));
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => mobile.value }));

const laneSpy = vi.hoisted(() => ({ expanded: undefined as boolean | undefined }));
vi.mock('./SectionLane', () => ({
  SectionLane: (props: { expanded: boolean }) => {
    laneSpy.expanded = props.expanded;
    return null;
  },
}));

// Imported after the mocks are registered.
const { Player } = await import('./Player');

function makePlayerState(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    projectId: 'p-1',
    title: 'Demo',
    folderId: null,
    stems: [],
    duration: 60,
    referenceIdx: 0,
    isPlaying: false,
    loop: null,
    status: '',
    loading: null,
    waveformNormalization: 'per-track',
    masterVolume: 100,
    ...overrides,
  };
}

function makePlayer(): PlayerControls {
  return {
    state: makePlayerState(),
    currentTime: 0,
    debugInfo: '',
    load: vi.fn(),
    togglePlay: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    setMasterVolume: vi.fn(),
    toggleMute: vi.fn(),
    toggleSolo: vi.fn(),
    setLoop: vi.fn(),
    setLoopEnabled: vi.fn(),
    toggleLoopEnabled: vi.fn(),
    clearLoop: vi.fn(),
    setWaveformNormalization: vi.fn(),
    toggleWaveformNormalization: vi.fn(),
    setTitle: vi.fn(),
    renameStem: vi.fn(),
    removeStem: vi.fn(),
    clear: vi.fn(),
  };
}

function makeViewportState(): ViewportState {
  return {
    hZoom: 1,
    trackHeight: 44,
    scrollLeft: 0,
    followMode: 'smooth',
    followActive: true,
    stageWidth: 0,
    railWidth: 0,
  };
}

function makeViewport(): ViewportControls {
  return {
    state: makeViewportState(),
    zoomH: vi.fn(),
    zoomHBy: vi.fn(),
    zoomV: vi.fn(),
    zoomVBy: vi.fn(),
    setScrollLeft: vi.fn(),
    fitToWindow: vi.fn(),
    setFollowActive: vi.fn(),
    setFollowMode: vi.fn(),
    setStageWidth: vi.fn(),
    setRailWidth: vi.fn(),
    setView: vi.fn(),
  };
}

function props(overrides: Record<string, unknown> = {}) {
  return {
    player: makePlayer(),
    annotations: [],
    userColorMap: new Map<string, string>(),
    markersVisible: false,
    annotationCreateMode: false,
    onAnnotationCreated: vi.fn(),
    onAnnotationSelected: vi.fn(),
    pendingDraft: null,
    hoveredAnnotationId: null,
    onHoverAnnotation: vi.fn(),
    onLoopAnnotation: vi.fn(),
    sections: [],
    songUseCounts: new Map<string, number>(),
    activeSectionId: null,
    revealLaneNonce: 0,
    sectionCreateMode: false,
    onSectionSelected: vi.fn(),
    onPatchSection: vi.fn(),
    onPatchAnnotation: vi.fn(),
    selfUserId: 'u-1',
    onSectionCreated: vi.fn(),
    onToggleSectionCreate: vi.fn(),
    railCollapsed: false,
    canMutate: true,
    onToggleAnnotationCreate: vi.fn(),
    onOpenPicker: vi.fn(),
    onRenameStem: vi.fn(),
    onDeleteStem: vi.fn(),
    viewport: makeViewport(),
    ...overrides,
  };
}

describe('Player section-lane reveal on song focus', () => {
  afterEach(() => {
    mobile.value = false;
    laneSpy.expanded = undefined;
  });

  it('expands the lane on mobile when revealLaneNonce changes', () => {
    mobile.value = true;
    const { rerender } = render(<Player {...props({ revealLaneNonce: 0 })} />);
    // A nonce of 0 is the "no focus yet" sentinel — lane stays collapsed.
    expect(laneSpy.expanded).toBe(false);

    rerender(<Player {...props({ revealLaneNonce: 1 })} />);
    expect(laneSpy.expanded).toBe(true);
  });

  it('does not expand the lane on desktop (the active-section chip names it instead)', () => {
    mobile.value = false;
    const { rerender } = render(<Player {...props({ revealLaneNonce: 0 })} />);
    rerender(<Player {...props({ revealLaneNonce: 1 })} />);
    expect(laneSpy.expanded).toBe(false);
  });
});
