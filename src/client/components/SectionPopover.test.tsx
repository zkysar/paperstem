import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { SectionPopover } from './SectionPopover';
import type { Song } from '../../shared/types';

function song(over: Partial<Song>): Song {
  return {
    id: 's-1',
    band_id: 'b-1',
    name: 'Heart Sounds',
    created_at: 0,
    use_count: 1,
    ...over,
  };
}

const baseProps = {
  open: true,
  section: null,
  startMs: 12000,
  bandSongs: [] as Song[],
  runningSection: null,
  anchorLeftPx: 200,
  anchorTopPx: 200,
  onSubmit: vi.fn(),
  onClose: vi.fn(),
};

describe('SectionPopover', () => {
  it('returns null when open is false', () => {
    const { container } = render(<SectionPopover {...baseProps} open={false} />);
    expect(container.querySelector('.section-popover')).toBeNull();
  });

  it('renders create header with the start time', () => {
    render(<SectionPopover {...baseProps} />);
    expect(screen.getByText(/New section at/i)).not.toBeNull();
  });

  it('typing a new name surfaces a "Create song" row', async () => {
    const user = userEvent.setup();
    render(<SectionPopover {...baseProps} />);
    const input = screen.getByLabelText('Song name');
    await user.type(input, 'Heart Sounds');
    expect(screen.getByText(/Create song/)).not.toBeNull();
  });

  it('selecting an existing song fires song_id submit', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <SectionPopover
        {...baseProps}
        bandSongs={[song({ id: 's-1', name: 'Heart Sounds', use_count: 4 })]}
        onSubmit={onSubmit}
      />,
    );
    await user.click(screen.getByTestId('sp-suggestion-s-1'));
    expect(onSubmit).toHaveBeenCalledWith({ kind: 'song_id', song_id: 's-1' });
  });

  it('Enter on the input prefers an exact (case-insensitive) match over create', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <SectionPopover
        {...baseProps}
        bandSongs={[song({ id: 's-1', name: 'Heart Sounds' })]}
        onSubmit={onSubmit}
      />,
    );
    const input = screen.getByLabelText('Song name');
    await user.type(input, 'heart sounds{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ kind: 'song_id', song_id: 's-1' });
  });

  it('Enter with no exact match fires song_name (find-or-create on server)', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<SectionPopover {...baseProps} onSubmit={onSubmit} />);
    const input = screen.getByLabelText('Song name');
    await user.type(input, 'Brand New{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ kind: 'song_name', song_name: 'Brand New' });
  });

  it('Label checkbox + Enter fires label submit', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<SectionPopover {...baseProps} onSubmit={onSubmit} />);
    await user.click(screen.getByRole('radio', { name: /^label$/i }));
    const input = screen.getByRole('textbox', { name: /label/i });
    await user.type(input, 'warmup{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ kind: 'label', label: 'warmup' });
  });

  it('emits song_rename when editing a section attached to a song and typing a new name', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <SectionPopover
        {...baseProps}
        section={{
          id: 'sec-1',
          project_id: 'p-1',
          start_ms: 12000,
          song_id: 's-1',
          song_name: 'Heart Sounds',
          label: null,
          source: 'manual',
          created_at: 0,
          updated_at: 0,
        }}
        bandSongs={[song({ id: 's-1', name: 'Heart Sounds', use_count: 3 })]}
        onSubmit={onSubmit}
      />,
    );
    const input = screen.getByLabelText('Song name');
    await user.clear(input);
    await user.type(input, 'Heart Sounds (final){Enter}');
    expect(onSubmit).toHaveBeenCalledWith({
      kind: 'song_rename',
      song_id: 's-1',
      new_name: 'Heart Sounds (final)',
    });
  });

  it('clicking another catalog song re-attaches the section (no rename)', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <SectionPopover
        {...baseProps}
        section={{
          id: 'sec-1',
          project_id: 'p-1',
          start_ms: 0,
          song_id: 's-1',
          song_name: 'Heart Sounds',
          label: null,
          source: 'manual',
          created_at: 0,
          updated_at: 0,
        }}
        bandSongs={[
          song({ id: 's-1', name: 'Heart Sounds' }),
          song({ id: 's-2', name: 'Solo Idea' }),
        ]}
        onSubmit={onSubmit}
      />,
    );
    // The popover seeds the input with the current song name; clear it
    // so the full catalog re-appears in the suggestions, then pick the
    // other song.
    const input = screen.getByLabelText('Song name');
    await user.clear(input);
    await user.click(screen.getByTestId('sp-suggestion-s-2'));
    expect(onSubmit).toHaveBeenCalledWith({ kind: 'song_id', song_id: 's-2' });
  });

  it('"End here" button is hidden when no runningSection is provided', () => {
    render(<SectionPopover {...baseProps} />);
    expect(screen.queryByRole('button', { name: /end/i })).toBeNull();
  });

  it('"End here" button is hidden when editing an existing section', () => {
    render(
      <SectionPopover
        {...baseProps}
        section={{
          id: 'sec-1',
          project_id: 'p-1',
          start_ms: 0,
          song_id: null,
          song_name: null,
          label: 'warmup',
          source: 'manual',
          created_at: 0,
          updated_at: 0,
        }}
        runningSection={{
          id: 'sec-0',
          project_id: 'p-1',
          start_ms: 0,
          song_id: 's-1',
          song_name: 'Heart Sounds',
          label: null,
          source: 'manual',
          created_at: 0,
          updated_at: 0,
        }}
      />,
    );
    expect(screen.queryByRole('button', { name: /end/i })).toBeNull();
  });

  it('"End here" button renders with the song name when runningSection has a song', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <SectionPopover
        {...baseProps}
        runningSection={{
          id: 'sec-0',
          project_id: 'p-1',
          start_ms: 0,
          song_id: 's-1',
          song_name: 'Wonderwall',
          label: null,
          source: 'manual',
          created_at: 0,
          updated_at: 0,
        }}
        onSubmit={onSubmit}
      />,
    );
    const button = screen.getByRole('button', { name: /end "wonderwall" here/i });
    await user.click(button);
    expect(onSubmit).toHaveBeenCalledWith({ kind: 'label', label: '—' });
  });

  it('"End here" button renders with the label text when runningSection is free-text', () => {
    render(
      <SectionPopover
        {...baseProps}
        runningSection={{
          id: 'sec-0',
          project_id: 'p-1',
          start_ms: 0,
          song_id: null,
          song_name: null,
          label: 'Bridge talk',
          source: 'manual',
          created_at: 0,
          updated_at: 0,
        }}
      />,
    );
    expect(
      screen.getByRole('button', { name: /end "bridge talk" here/i }),
    ).not.toBeNull();
  });

  it('Cancel button calls onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SectionPopover {...baseProps} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Delete button is shown only when editing and calls onDelete', async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(
      <SectionPopover
        {...baseProps}
        section={{
          id: 'sec-1',
          project_id: 'p-1',
          start_ms: 0,
          song_id: null,
          song_name: null,
          label: 'warmup',
          source: 'manual',
          created_at: 0,
          updated_at: 0,
        }}
        onDelete={onDelete}
      />,
    );
    await user.click(screen.getByRole('button', { name: /delete section/i }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('empty input + Save fires the clear payload', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <SectionPopover
        {...baseProps}
        section={{
          id: 'sec-1',
          project_id: 'p-1',
          start_ms: 0,
          song_id: null,
          song_name: null,
          label: 'warmup',
          source: 'manual',
          created_at: 0,
          updated_at: 0,
        }}
        onSubmit={onSubmit}
      />,
    );
    const input = screen.getByRole('textbox', { name: /label/i });
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onSubmit).toHaveBeenCalledWith({ kind: 'clear' });
  });

  it('Label checkbox switches the popover to Label mode', async () => {
    const user = userEvent.setup();
    render(<SectionPopover {...baseProps} />);
    await user.click(screen.getByRole('radio', { name: /^label$/i }));
    expect(screen.getByRole('textbox', { name: /label/i })).not.toBeNull();
  });

  it('Label checkbox is reachable when editing a song-attached section', () => {
    render(
      <SectionPopover
        {...baseProps}
        section={{
          id: 'sec-1',
          project_id: 'p-1',
          start_ms: 0,
          song_id: 's-1',
          song_name: 'Heart Sounds',
          label: null,
          source: 'manual',
          created_at: 0,
          updated_at: 0,
        }}
        bandSongs={[song({ id: 's-1', name: 'Heart Sounds' })]}
      />,
    );
    expect(screen.getByRole('radio', { name: /^label$/i })).not.toBeNull();
  });

  it('submit button reads "Add section" in create mode', () => {
    render(<SectionPopover {...baseProps} />);
    expect(screen.getByRole('button', { name: /add section/i })).not.toBeNull();
  });

  it('submit button reads "Save" when editing a section with no rename intent', () => {
    render(
      <SectionPopover
        {...baseProps}
        section={{
          id: 'sec-1',
          project_id: 'p-1',
          start_ms: 0,
          song_id: null,
          song_name: null,
          label: 'warmup',
          source: 'manual',
          created_at: 0,
          updated_at: 0,
        }}
      />,
    );
    expect(screen.getByRole('button', { name: /^save$/i })).not.toBeNull();
  });

  it('submit button reads "Rename" (no count) when use_count is 1', async () => {
    const user = userEvent.setup();
    render(
      <SectionPopover
        {...baseProps}
        section={{
          id: 'sec-1',
          project_id: 'p-1',
          start_ms: 0,
          song_id: 's-1',
          song_name: 'Heart Sounds',
          label: null,
          source: 'manual',
          created_at: 0,
          updated_at: 0,
        }}
        bandSongs={[song({ id: 's-1', name: 'Heart Sounds', use_count: 1 })]}
      />,
    );
    const input = screen.getByLabelText('Song name');
    await user.clear(input);
    await user.type(input, 'New Name');
    expect(screen.getByRole('button', { name: /^rename$/i })).not.toBeNull();
  });

  it('renders submit button as "Rename in N practices" when retyping a shared song', async () => {
    const user = userEvent.setup();
    render(
      <SectionPopover
        {...baseProps}
        section={{
          id: 'sec-1',
          project_id: 'p-1',
          start_ms: 0,
          song_id: 's-1',
          song_name: 'Heart Sounds',
          label: null,
          source: 'manual',
          created_at: 0,
          updated_at: 0,
        }}
        bandSongs={[song({ id: 's-1', name: 'Heart Sounds', use_count: 4 })]}
      />,
    );
    const input = screen.getByLabelText('Song name');
    await user.clear(input);
    await user.type(input, 'Heart Sounds (final)');
    expect(screen.getByRole('button', { name: /rename in 4 practices/i })).not.toBeNull();
  });

  it('shows the "Will rename in N practices" hint when retyping a shared song', async () => {
    const user = userEvent.setup();
    render(
      <SectionPopover
        {...baseProps}
        section={{
          id: 'sec-1',
          project_id: 'p-1',
          start_ms: 12000,
          song_id: 's-1',
          song_name: 'Heart Sounds',
          label: null,
          source: 'manual',
          created_at: 0,
          updated_at: 0,
        }}
        bandSongs={[song({ id: 's-1', name: 'Heart Sounds', use_count: 5 })]}
      />,
    );
    const input = screen.getByLabelText('Song name');
    await user.clear(input);
    await user.type(input, 'Heart Sounds (final)');
    expect(screen.getByText(/Will rename in 5 practices/i)).not.toBeNull();
  });
});
