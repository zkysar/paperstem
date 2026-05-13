import { render, renderHook, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { AppToolbar } from './AppToolbar';
import { useViewport } from '../hooks/useViewport';

function vp() {
  const { result } = renderHook(() => useViewport());
  return result.current;
}

const baseProps = {
  hasPractice: true,
  isPlaying: false,
  hasLoop: true,
  loopEnabled: false,
  downloading: false,
  waveformNormalization: 'per-track' as const,
  masterVolume: 50,
  currentTime: 0,
  duration: 272.5,
  annotationCreateMode: false,
  canCreateAnnotations: true,
  markersVisible: true,
  railCollapsed: false,
  showRailToggle: false, // wide widths default
  isWide: true,
  onSeek: vi.fn(),
  onTogglePlay: vi.fn(),
  onToggleLoopEnabled: vi.fn(),
  onDownloadAll: vi.fn(),
  onToggleWaveformNormalization: vi.fn(),
  onToggleAnnotationCreate: vi.fn(),
  onToggleMarkersVisible: vi.fn(),
  onSetMasterVolume: vi.fn(),
  onToggleRailCollapsed: vi.fn(),
  viewport: vp(),
  onOpenShortcuts: vi.fn(),
  onShare: vi.fn(() => null),
};

describe('AppToolbar', () => {
  it('renders all transport buttons', () => {
    render(<AppToolbar {...baseProps} />);
    expect(screen.getByLabelText('Restart')).not.toBeNull();
    expect(screen.getByLabelText('Play')).not.toBeNull();
    expect(screen.getByLabelText('Toggle loop')).not.toBeNull();
    expect(screen.getByLabelText('Download all stems')).not.toBeNull();
  });

  it('disables transport when no practice loaded', () => {
    render(<AppToolbar {...baseProps} hasPractice={false} />);
    expect((screen.getByLabelText('Restart') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Play') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Download all stems') as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps ▥ ◉ enabled even without practice (user prefs)', () => {
    render(<AppToolbar {...baseProps} hasPractice={false} canCreateAnnotations={false} />);
    expect((screen.getByLabelText('Toggle waveform scale') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText('Toggle marker visibility') as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables ＋ when canCreateAnnotations is false', () => {
    render(<AppToolbar {...baseProps} canCreateAnnotations={false} />);
    expect((screen.getByLabelText('Add annotation') as HTMLButtonElement).disabled).toBe(true);
  });

  it('hides rail-toggle when showRailToggle is false', () => {
    render(<AppToolbar {...baseProps} showRailToggle={false} />);
    expect(screen.queryByLabelText('Hide track controls')).toBeNull();
    expect(screen.queryByLabelText('Show track controls')).toBeNull();
  });

  it('renders rail-toggle on narrow viewports when showRailToggle is true', () => {
    // Stems live in the rail; narrow-viewport users still need a way to open
    // it to access stem rename/delete actions.
    render(
      <AppToolbar
        {...baseProps}
        isWide={false}
        railCollapsed={true}
        showRailToggle={true}
      />,
    );
    expect(screen.getByLabelText('Show track controls')).not.toBeNull();
  });

  it('renders 0:00 / 0:00 when duration is 0', () => {
    render(<AppToolbar {...baseProps} hasPractice={false} duration={0} currentTime={0} />);
    expect(screen.getByText(/0:00 \/ 0:00/)).not.toBeNull();
  });

  it('clicking ＋ toggles annotation create-mode', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<AppToolbar {...baseProps} onToggleAnnotationCreate={onToggle} />);
    await user.click(screen.getByLabelText('Add annotation'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('uses popover on narrow widths', () => {
    render(<AppToolbar {...baseProps} isWide={false} />);
    expect(screen.getByLabelText('Master volume')).not.toBeNull();
    expect(screen.queryByLabelText('Master volume slider')).toBeNull();
  });

  it('clicking the volume button opens the popover', async () => {
    const user = userEvent.setup();
    render(<AppToolbar {...baseProps} isWide={false} />);
    await user.click(screen.getByLabelText('Master volume'));
    expect(screen.getByLabelText('Master volume slider')).not.toBeNull();
  });

  it('Share button is disabled when no practice loaded', () => {
    render(<AppToolbar {...baseProps} hasPractice={false} />);
    expect((screen.getByLabelText('Copy share link') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Share button writes to clipboard and shows a Copied label', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const onShare = vi.fn(() => ({
      fullUrl: 'https://x.app/#p=abc&t=10.00&l=1.00-2.00',
      categories: ['loop' as const],
    }));
    render(<AppToolbar {...baseProps} onShare={onShare} />);
    await user.click(screen.getByLabelText('Copy share link'));
    expect(onShare).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith('https://x.app/#p=abc&t=10.00&l=1.00-2.00');
    expect(screen.getByRole('status').textContent).toMatch(/Copied — includes loop/);
  });
});

describe('AppToolbar zoom group', () => {
  it('renders zoom buttons and percentage', () => {
    render(<AppToolbar {...baseProps} viewport={vp()} />);
    expect(screen.getByLabelText('Zoom out')).not.toBeNull();
    expect(screen.getByLabelText('Zoom in')).not.toBeNull();
    expect(screen.getByLabelText('Fit to window')).not.toBeNull();
    expect(screen.getByText('100%')).not.toBeNull();
  });

  it('clicking zoom in calls viewport.zoomH("in")', () => {
    const viewport = vp();
    const zoomH = vi.spyOn(viewport, 'zoomH');
    render(<AppToolbar {...baseProps} viewport={viewport} />);
    fireEvent.click(screen.getByLabelText('Zoom in'));
    expect(zoomH).toHaveBeenCalledWith('in', expect.any(Object));
  });

  it('clicking ? button calls onOpenShortcuts', () => {
    const onOpenShortcuts = vi.fn();
    render(<AppToolbar {...baseProps} viewport={vp()} onOpenShortcuts={onOpenShortcuts} />);
    fireEvent.click(screen.getByLabelText('Keyboard shortcuts'));
    expect(onOpenShortcuts).toHaveBeenCalledOnce();
  });

  it('minimap toggle cycles auto -> off -> pinned -> auto', () => {
    // Use stub viewports so we can drive the rendered state explicitly across
    // re-renders (the real useViewport state is a useState snapshot — we'd
    // need to actually invoke setMinimapPref to advance it).
    function stubViewport(pref: 'auto' | 'off' | 'pinned') {
      return {
        state: {
          hZoom: 1, trackHeight: 44, scrollLeft: 0,
          followMode: 'smooth' as const, followActive: true,
          minimapPref: pref,
        },
        zoomH: vi.fn(), zoomHBy: vi.fn(), zoomV: vi.fn(),
        setScrollLeft: vi.fn(), fitToWindow: vi.fn(),
        setFollowActive: vi.fn(), setFollowMode: vi.fn(),
        setMinimapPref: vi.fn(),
      };
    }

    const v1 = stubViewport('auto');
    const { rerender } = render(<AppToolbar {...baseProps} viewport={v1 as any} />);
    fireEvent.click(screen.getByLabelText('Hide minimap'));
    expect(v1.setMinimapPref).toHaveBeenCalledWith('off');

    const v2 = stubViewport('off');
    rerender(<AppToolbar {...baseProps} viewport={v2 as any} />);
    fireEvent.click(screen.getByLabelText('Always show minimap'));
    expect(v2.setMinimapPref).toHaveBeenCalledWith('pinned');

    const v3 = stubViewport('pinned');
    rerender(<AppToolbar {...baseProps} viewport={v3 as any} />);
    fireEvent.click(screen.getByLabelText('Reset minimap to auto'));
    expect(v3.setMinimapPref).toHaveBeenCalledWith('auto');
  });
});
