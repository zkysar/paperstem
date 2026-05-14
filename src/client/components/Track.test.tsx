import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Track } from './Track';
import { DEFAULT_TRACK_H } from '../hooks/useViewport';
import type { LoadedStem } from '../data/types';

function makeStem(overrides: Partial<LoadedStem> = {}): LoadedStem {
  return {
    name: 'old.wav',
    displayName: 'old.wav',
    color: '#888',
    audio: new Audio(),
    audioBuffer: null,
    userMuted: false,
    soloed: false,
    userVolume: 100,
    projectId: 'project-1',
    serverId: 'stem-1',
    gain: null,
    peaks: null,
    ...overrides,
  };
}

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    stem: makeStem(),
    idx: 0,
    focused: false,
    effectiveMuted: false,
    durationRef: 60,
    waveformNormalization: 'global' as const,
    canMutate: true,
    trackHeight: DEFAULT_TRACK_H,
    onFocus: vi.fn(),
    onToggleMute: vi.fn(),
    onToggleSolo: vi.fn(),
    onSetVolume: vi.fn(),
    onSeek: vi.fn(),
    onRenameStem: vi.fn(),
    onDeleteStem: vi.fn(),
    ...overrides,
  };
}

describe('Track inline rename', () => {
  it('clicking the stem name lets the user rename via Enter', async () => {
    const user = userEvent.setup();
    const onRenameStem = vi.fn();
    render(<Track {...defaultProps({ onRenameStem })} />);

    await user.click(screen.getByText('old.wav'));
    const input = screen.getByRole('textbox', { name: /rename stem/i });
    await user.clear(input);
    await user.type(input, 'new.wav{Enter}');
    expect(onRenameStem).toHaveBeenCalledWith('stem-1', 'new.wav');
  });

  it('Escape cancels', async () => {
    const user = userEvent.setup();
    const onRenameStem = vi.fn();
    render(<Track {...defaultProps({ onRenameStem })} />);
    await user.click(screen.getByText('old.wav'));
    const input = screen.getByRole('textbox', { name: /rename stem/i });
    await user.type(input, 'changed{Escape}');
    expect(onRenameStem).not.toHaveBeenCalled();
  });

  it('local-folder stems (serverId null) are not editable', () => {
    render(
      <Track
        {...defaultProps({ stem: makeStem({ serverId: null }) })}
      />,
    );
    // Name renders as a disabled button (no editable input).
    expect(screen.queryByRole('textbox', { name: /rename stem/i })).toBeNull();
    const trigger = screen.getByRole('button', { name: 'old.wav' });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
  });

  it('rename trigger is keyboard-activatable', async () => {
    const user = userEvent.setup();
    const onRenameStem = vi.fn();
    render(<Track {...defaultProps({ onRenameStem })} />);
    const trigger = screen.getByRole('button', { name: 'old.wav' });
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
    trigger.focus();
    await user.keyboard('{Enter}');
    const input = screen.getByRole('textbox', { name: /rename stem/i });
    await user.clear(input);
    await user.type(input, 'kbd.wav{Enter}');
    expect(onRenameStem).toHaveBeenCalledWith('stem-1', 'kbd.wav');
  });
});

describe('Track delete', () => {
  it('clicking trash button shows confirm and calls onDeleteStem', async () => {
    const user = userEvent.setup();
    const onDeleteStem = vi.fn();
    render(<Track {...defaultProps({ onDeleteStem })} />);

    await user.click(
      screen.getByRole('button', { name: /move old.wav to trash/i }),
    );
    await user.click(screen.getByRole('button', { name: /^move to trash$/i }));
    expect(onDeleteStem).toHaveBeenCalledWith('stem-1');
  });

  it('trash button is disabled for local-folder stems (no serverId)', () => {
    render(
      <Track
        {...defaultProps({ stem: makeStem({ serverId: null }) })}
      />,
    );
    const btn = screen.getByRole('button', { name: /move old.wav to trash/i });
    expect(btn.hasAttribute('disabled')).toBe(true);
  });

  it('Cancel dismisses the confirm without calling onDeleteStem', async () => {
    const user = userEvent.setup();
    const onDeleteStem = vi.fn();
    render(<Track {...defaultProps({ onDeleteStem })} />);

    await user.click(
      screen.getByRole('button', { name: /move old.wav to trash/i }),
    );
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onDeleteStem).not.toHaveBeenCalled();
  });
});

describe('Track unavailable state', () => {
  it('shows the alert icon when audio errors and reveals detail on click', async () => {
    const user = userEvent.setup();
    const stem = makeStem({ name: 'broken.wav' });
    render(<Track {...defaultProps({ stem })} />);
    fireEvent.error(stem.audio);

    const icon = screen.getByRole('button', { name: /stem unavailable/i });
    expect(icon).not.toBeNull();
    // Detail is not in the document until the icon is clicked or hovered.
    expect(screen.queryByRole('tooltip')).toBeNull();

    await user.click(icon);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toMatch(/missing in Drive/i);
    expect(icon.getAttribute('aria-expanded')).toBe('true');
  });

  it('Escape closes the pinned-open unavailable popover', async () => {
    const user = userEvent.setup();
    const stem = makeStem({ name: 'broken.wav' });
    render(<Track {...defaultProps({ stem })} />);
    fireEvent.error(stem.audio);

    const icon = screen.getByRole('button', { name: /stem unavailable/i });
    await user.click(icon);
    expect(screen.queryByRole('tooltip')).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('Track tier class by height', () => {
  it('applies tier-min class when trackHeight is below 32', () => {
    const { container } = render(
      <Track {...defaultProps({ trackHeight: 24 })} />,
    );
    expect(container.querySelector('.track')?.classList.contains('tier-min')).toBe(true);
  });

  it('applies tier-mid class between 32 and 43', () => {
    const { container } = render(
      <Track {...defaultProps({ trackHeight: 36 })} />,
    );
    expect(container.querySelector('.track')?.classList.contains('tier-mid')).toBe(true);
  });

  it('applies tier-full class at 44 and above', () => {
    const { container } = render(
      <Track {...defaultProps({ trackHeight: 60 })} />,
    );
    expect(container.querySelector('.track')?.classList.contains('tier-full')).toBe(true);
  });
});
