import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Track } from './Track';
import type { LoadedStem } from '../data/types';

function makeStem(overrides: Partial<LoadedStem> = {}): LoadedStem {
  return {
    name: 'old.wav',
    displayName: 'old.wav',
    color: '#888',
    audio: new Audio(),
    userMuted: false,
    soloed: false,
    userVolume: 100,
    practiceId: 'practice-1',
    serverId: 'stem-1',
    gain: null,
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
    // Name renders as a non-editable span (no input present).
    expect(screen.queryByRole('textbox', { name: /rename stem/i })).toBeNull();
    expect(screen.getByText('old.wav')).not.toBeNull();
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
