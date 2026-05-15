import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { SectionLane } from './SectionLane';
import type { Section } from '../../shared/types';

function section(over: Partial<Section>): Section {
  return {
    id: 'sec-1',
    project_id: 'p-1',
    start_ms: 0,
    song_id: null,
    song_name: null,
    label: null,
    source: 'manual',
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

const baseProps = {
  sections: [] as Section[],
  duration: 120,
  waveLeftPx: 100,
  waveWidthPx: 800,
  songUseCounts: new Map<string, number>(),
  activeSectionId: null as string | null,
  onSelect: vi.fn(),
  onSeek: vi.fn(),
};

describe('SectionLane', () => {
  it('renders nothing when there are no sections', () => {
    const { container } = render(<SectionLane {...baseProps} />);
    expect(container.querySelector('.section-lane')).toBeNull();
  });

  it('renders one pill per section, with the song name as the label', () => {
    render(
      <SectionLane
        {...baseProps}
        sections={[
          section({ id: 'a', start_ms: 0, song_id: 'song-1', song_name: 'Heart Sounds' }),
          section({ id: 'b', start_ms: 30000, song_id: 'song-2', song_name: 'Solo Idea' }),
        ]}
      />,
    );
    expect(screen.getByText('Heart Sounds')).not.toBeNull();
    expect(screen.getByText('Solo Idea')).not.toBeNull();
  });

  it('falls back to the label for free-text sections', () => {
    render(
      <SectionLane
        {...baseProps}
        sections={[section({ id: 'a', start_ms: 0, label: 'warmup' })]}
      />,
    );
    expect(screen.getByText('warmup')).not.toBeNull();
  });

  it('shows the chain glyph for sections whose song is shared across practices', () => {
    const { container } = render(
      <SectionLane
        {...baseProps}
        sections={[section({ id: 'a', start_ms: 0, song_id: 'song-1', song_name: 'Heart Sounds' })]}
        songUseCounts={new Map([['song-1', 3]])}
      />,
    );
    expect(container.querySelector('.section-pill-chain')).not.toBeNull();
  });

  it('does not show the chain glyph when use_count is 1', () => {
    const { container } = render(
      <SectionLane
        {...baseProps}
        sections={[section({ id: 'a', start_ms: 0, song_id: 'song-1', song_name: 'Heart Sounds' })]}
        songUseCounts={new Map([['song-1', 1]])}
      />,
    );
    expect(container.querySelector('.section-pill-chain')).toBeNull();
  });

  it('clicking a pill seeks and selects', async () => {
    const onSelect = vi.fn();
    const onSeek = vi.fn();
    const user = userEvent.setup();
    const s = section({ id: 'a', start_ms: 12000, song_id: 'song-1', song_name: 'Heart Sounds' });
    render(
      <SectionLane
        {...baseProps}
        sections={[s]}
        onSelect={onSelect}
        onSeek={onSeek}
      />,
    );
    await user.click(screen.getByText('Heart Sounds'));
    expect(onSeek).toHaveBeenCalledWith(12);
    expect(onSelect).toHaveBeenCalledWith(s);
  });
});
