import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Player } from './Player';
import type { PlayerControls } from '../hooks/usePlayer';
import type { ViewportControls, ViewportState } from '../hooks/useViewport';
import type { PlayerState } from '../data/types';

// Minimal paused player state with no stems loaded.
function makePlayerState(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    projectId: null,
    title: '—',
    folderId: null,
    stems: [],
    duration: 0,
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

function makePlayer(overrides: Partial<PlayerControls> = {}): PlayerControls {
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
    ...overrides,
  };
}

function makeViewportState(overrides: Partial<ViewportState> = {}): ViewportState {
  return {
    hZoom: 1,
    trackHeight: 44,
    scrollLeft: 0,
    followMode: 'smooth',
    followActive: true,
    stageWidth: 0,
    railWidth: 0,
    ...overrides,
  };
}

function makeViewport(overrides: Partial<ViewportControls> = {}): ViewportControls {
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
    ...overrides,
  };
}

function defaultProps() {
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
    sectionCreateMode: false,
    onSectionSelected: vi.fn(),
    onSectionCreated: vi.fn(),
    onToggleSectionCreate: vi.fn(),
    railCollapsed: false,
    contentEntering: false,
    canMutate: true,
    onToggleAnnotationCreate: vi.fn(),
    onOpenPicker: vi.fn(),
    onRenameStem: vi.fn(),
    onDeleteStem: vi.fn(),
    viewport: makeViewport(),
  };
}

describe('Player', () => {
  it('renders without crashing (empty player state)', () => {
    const { container } = render(<Player {...defaultProps()} />);
    expect(container.querySelector('.player')).not.toBeNull();
  });

  it('shows the empty-stage prompt when no stems are loaded', () => {
    render(<Player {...defaultProps()} />);
    expect(screen.getByText(/no project open/i)).not.toBeNull();
  });

  it('shows a description of the app in the empty state', () => {
    render(<Player {...defaultProps()} />);
    expect(screen.getByText(/stem player for bands/i)).not.toBeNull();
  });

  it('shows a CTA button that wires to onOpenPicker', async () => {
    const user = userEvent.setup();
    const onOpenPicker = vi.fn();
    render(<Player {...defaultProps()} onOpenPicker={onOpenPicker} />);
    await user.click(screen.getByRole('button', { name: /open a project/i }));
    expect(onOpenPicker).toHaveBeenCalledOnce();
  });

  it('annotation-mode banner is hidden when annotationCreateMode is false', () => {
    render(<Player {...defaultProps()} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows annotation-mode banner and Cancel button when annotationCreateMode is true', () => {
    render(<Player {...defaultProps()} annotationCreateMode={true} />);
    expect(screen.getByRole('status')).not.toBeNull();
    expect(screen.getByRole('button', { name: /cancel/i })).not.toBeNull();
  });

  it('Cancel button in annotation-mode banner calls onToggleAnnotationCreate', async () => {
    const user = userEvent.setup();
    const onToggleAnnotationCreate = vi.fn();
    render(
      <Player
        {...defaultProps()}
        annotationCreateMode={true}
        onToggleAnnotationCreate={onToggleAnnotationCreate}
      />,
    );
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onToggleAnnotationCreate).toHaveBeenCalledOnce();
  });

  it('adds rail-collapsed class when railCollapsed is true', () => {
    const { container } = render(<Player {...defaultProps()} railCollapsed={true} />);
    expect(container.querySelector('.player')?.classList.contains('rail-collapsed')).toBe(true);
  });

  it('adds annotating class when annotationCreateMode is true', () => {
    const { container } = render(<Player {...defaultProps()} annotationCreateMode={true} />);
    expect(container.querySelector('.player')?.classList.contains('annotating')).toBe(true);
  });

  it('renders the section-mode banner when sectionCreateMode is true', () => {
    render(<Player {...defaultProps()} sectionCreateMode={true} />);
    expect(screen.getByText(/section mode/i)).not.toBeNull();
    // The banner should be the only mode banner — comment mode is off.
    expect(screen.queryByText(/comment mode/i)).toBeNull();
  });

  it('Cancel button in section-mode banner fires onToggleSectionCreate', async () => {
    const user = userEvent.setup();
    const onToggleSectionCreate = vi.fn();
    render(
      <Player
        {...defaultProps()}
        sectionCreateMode={true}
        onToggleSectionCreate={onToggleSectionCreate}
      />,
    );
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onToggleSectionCreate).toHaveBeenCalledOnce();
  });
});
