import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { AppToolbar } from './AppToolbar';

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
});
