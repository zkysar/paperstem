import { render, renderHook, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppToolbar } from './AppToolbar';
import { useViewport } from '../hooks/useViewport';

function vp() {
  const { result } = renderHook(() => useViewport());
  return result.current;
}

const baseProps = {
  hasProject: true,
  isPlaying: false,
  hasLoop: true,
  loopEnabled: false,
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
  beforeEach(() => {
    // Reset navigator.share between tests — defaults to clipboard path.
    // Individual tests can opt into the Web Share path.
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  });

  it('renders all transport buttons', () => {
    render(<AppToolbar {...baseProps} />);
    expect(screen.getByLabelText('Restart')).not.toBeNull();
    expect(screen.getByLabelText('Play')).not.toBeNull();
    expect(screen.getByLabelText('Toggle loop')).not.toBeNull();
  });

  it('disables transport when no project loaded', () => {
    render(<AppToolbar {...baseProps} hasProject={false} />);
    expect((screen.getByLabelText('Restart') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Play') as HTMLButtonElement).disabled).toBe(true);
  });

  it('no longer renders the Download button (moved to header)', () => {
    render(<AppToolbar {...baseProps} />);
    expect(screen.queryByLabelText('Download all stems')).toBeNull();
  });

  it('disables ＋ when canCreateAnnotations is false', () => {
    render(<AppToolbar {...baseProps} canCreateAnnotations={false} />);
    expect((screen.getByLabelText('Add annotation') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders rail-toggle inside the overflow menu when showRailToggle is true', async () => {
    const user = userEvent.setup();
    render(<AppToolbar {...baseProps} showRailToggle={true} />);
    await user.click(screen.getByLabelText('More options'));
    expect(screen.getByRole('menuitem', { name: /track controls/i })).not.toBeNull();
  });

  it('renders 0:00 / 0:00 when duration is 0', () => {
    render(<AppToolbar {...baseProps} hasProject={false} duration={0} currentTime={0} />);
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

  it('Share button is disabled when no project loaded', () => {
    render(<AppToolbar {...baseProps} hasProject={false} />);
    expect((screen.getByLabelText('Copy share link') as HTMLButtonElement).disabled).toBe(true);
  });

  it('time display sits between the transport group and the share button', () => {
    render(<AppToolbar {...baseProps} currentTime={84} duration={272.5} />);
    const time = screen.getByText(/1:24 \/ 4:32/).closest('span');
    const loop = screen.getByLabelText('Toggle loop');
    const share = screen.getByLabelText('Copy share link');
    expect(time).not.toBeNull();
    if (!time) return;
    // time appears after loop and before share in DOM order
    expect(loop.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(time.compareDocumentPosition(share) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it('share toast is anchored inside .atb-share-wrap (does not shift siblings)', async () => {
    const onShare = vi.fn(() => ({ fullUrl: 'http://x.test/p/abc', categories: [] }));
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    render(<AppToolbar {...baseProps} onShare={onShare} />);
    await user.click(screen.getByLabelText('Copy share link'));
    const toast = await screen.findByRole('status');
    expect(toast.className).toContain('atb-share-label');
    // The toast must be a child of .atb-share-wrap (the anchor), not a sibling of share neighbors.
    const wrap = toast.parentElement;
    expect(wrap?.className).toContain('atb-share-wrap');
  });

  it('prefers navigator.share() when available, with title and URL', async () => {
    const user = userEvent.setup();
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: shareSpy });
    const onShare = vi.fn(() => ({
      fullUrl: 'http://x.test/p/abc',
      categories: [] as Array<'loop' | 'mix' | 'comment'>,
      title: 'Tuesday rehearsal 5/12',
    }));
    render(<AppToolbar {...baseProps} onShare={onShare} />);
    await user.click(screen.getByLabelText('Copy share link'));
    expect(shareSpy).toHaveBeenCalledWith({
      title: 'Tuesday rehearsal 5/12',
      url: 'http://x.test/p/abc',
    });
  });

  it('falls back to clipboard when navigator.share is unavailable', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const onShare = vi.fn(() => ({
      fullUrl: 'http://x.test/p/abc',
      categories: ['loop' as const],
    }));
    render(<AppToolbar {...baseProps} onShare={onShare} />);
    await user.click(screen.getByLabelText('Copy share link'));
    expect(writeText).toHaveBeenCalledWith('http://x.test/p/abc');
  });

  it('treats AbortError from navigator.share() as a silent user cancel', async () => {
    const user = userEvent.setup();
    const err = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const shareSpy = vi.fn().mockRejectedValue(err);
    Object.defineProperty(navigator, 'share', { configurable: true, value: shareSpy });
    const onShare = vi.fn(() => ({
      fullUrl: 'http://x.test/p/abc',
      categories: [] as Array<'loop' | 'mix' | 'comment'>,
    }));
    render(<AppToolbar {...baseProps} onShare={onShare} />);
    await user.click(screen.getByLabelText('Copy share link'));
    // No toast on user cancel
    expect(screen.queryByRole('status')).toBeNull();
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

  it('does not render a minimap toggle button', () => {
    // Minimap lives in the timeline area and is always present — no toolbar
    // toggle. (Previously the button cycled auto/off/pinned.)
    render(<AppToolbar {...baseProps} viewport={vp()} />);
    expect(screen.queryByLabelText('Hide minimap')).toBeNull();
    expect(screen.queryByLabelText('Always show minimap')).toBeNull();
    expect(screen.queryByLabelText('Reset minimap to auto')).toBeNull();
  });
});
