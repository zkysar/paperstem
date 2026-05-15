import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ActiveSectionChip } from './ActiveSectionChip';
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

describe('ActiveSectionChip', () => {
  it('renders nothing when sections is empty', () => {
    const { container } = render(
      <ActiveSectionChip
        sections={[]}
        songUseCounts={new Map()}
        currentTimeSeconds={10}
        onSeek={vi.fn()}
      />,
    );
    expect(container.querySelector('.active-section-chip')).toBeNull();
  });

  it('renders nothing when playhead is before the first section', () => {
    const { container } = render(
      <ActiveSectionChip
        sections={[section({ id: 'a', start_ms: 10000, song_name: 'Verse 1' })]}
        songUseCounts={new Map()}
        currentTimeSeconds={5}
        onSeek={vi.fn()}
      />,
    );
    expect(container.querySelector('.active-section-chip')).toBeNull();
  });

  it('shows the containing section name when playhead is inside it', () => {
    render(
      <ActiveSectionChip
        sections={[
          section({ id: 'a', start_ms: 0, song_name: 'Intro' }),
          section({ id: 'b', start_ms: 10000, song_name: 'Verse 1' }),
          section({ id: 'c', start_ms: 30000, song_name: 'Chorus' }),
        ]}
        songUseCounts={new Map()}
        currentTimeSeconds={20}
        onSeek={vi.fn()}
      />,
    );
    expect(screen.getByText('Verse 1')).not.toBeNull();
  });

  it('falls back to label for free-text sections', () => {
    render(
      <ActiveSectionChip
        sections={[section({ id: 'a', start_ms: 0, label: 'warmup' })]}
        songUseCounts={new Map()}
        currentTimeSeconds={5}
        onSeek={vi.fn()}
      />,
    );
    expect(screen.getByText('warmup')).not.toBeNull();
  });

  it('falls back to "Untitled" when there is no name or label', () => {
    render(
      <ActiveSectionChip
        sections={[section({ id: 'a', start_ms: 0 })]}
        songUseCounts={new Map()}
        currentTimeSeconds={5}
        onSeek={vi.fn()}
      />,
    );
    expect(screen.getByText('Untitled')).not.toBeNull();
  });

  it('boundary: at exactly the next section start, jumps to that section', () => {
    render(
      <ActiveSectionChip
        sections={[
          section({ id: 'a', start_ms: 0, song_name: 'Intro' }),
          section({ id: 'b', start_ms: 10000, song_name: 'Verse 1' }),
        ]}
        songUseCounts={new Map()}
        currentTimeSeconds={10}
        onSeek={vi.fn()}
      />,
    );
    expect(screen.getByText('Verse 1')).not.toBeNull();
  });

  it('renders the chain glyph when the containing section is shared across practices', () => {
    const { container } = render(
      <ActiveSectionChip
        sections={[
          section({ id: 'a', start_ms: 0, song_id: 'song-1', song_name: 'Verse 1' }),
        ]}
        songUseCounts={new Map([['song-1', 3]])}
        currentTimeSeconds={5}
        onSeek={vi.fn()}
      />,
    );
    expect(container.querySelector('.active-section-chip-chain')).not.toBeNull();
  });

  it('clicking the chip seeks to the section start', () => {
    const onSeek = vi.fn();
    const { container } = render(
      <ActiveSectionChip
        sections={[section({ id: 'a', start_ms: 12000, song_name: 'Verse 1' })]}
        songUseCounts={new Map()}
        currentTimeSeconds={15}
        onSeek={onSeek}
      />,
    );
    const btn = container.querySelector<HTMLButtonElement>('.active-section-chip');
    expect(btn).not.toBeNull();
    fireEvent.click(btn!);
    expect(onSeek).toHaveBeenCalledWith(12);
  });

  it('handles unsorted input — picks the right section regardless of input order', () => {
    render(
      <ActiveSectionChip
        sections={[
          section({ id: 'c', start_ms: 30000, song_name: 'Chorus' }),
          section({ id: 'a', start_ms: 0, song_name: 'Intro' }),
          section({ id: 'b', start_ms: 10000, song_name: 'Verse 1' }),
        ]}
        songUseCounts={new Map()}
        currentTimeSeconds={20}
        onSeek={vi.fn()}
      />,
    );
    expect(screen.getByText('Verse 1')).not.toBeNull();
  });
});
