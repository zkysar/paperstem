import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../hooks/usePresence', () => ({
  usePresence: () => ({}),
}));

import { ProjectPicker } from './ProjectPicker';
import type { Project, TrashList } from '../data/types';

const projects: Project[] = []; // empty for now
const baseProps = {
  open: true,
  loading: false,
  loadError: null,
  projects,
  activeProjectId: null,
  showUpload: true,
  bandSongs: [],
  songUsage: [],
  filterSongId: null,
  onSetFilterSongId: vi.fn(),
  onClose: vi.fn(),
  onSelect: vi.fn(),
  onLoadFolder: vi.fn(),
  onRetry: vi.fn(),
  onRenameProject: vi.fn(),
  onDeleteProject: vi.fn(),
  trash: null as TrashList | null,
  trashError: null as string | null,
  onLoadTrash: vi.fn(),
  onRestoreProject: vi.fn(),
  onRestoreStem: vi.fn(),
};

describe('ProjectPicker', () => {
  it('renders title and close button when open', () => {
    render(<ProjectPicker {...baseProps} />);
    expect(screen.getByText('Projects')).not.toBeNull();
    expect(screen.getByLabelText('Close picker')).not.toBeNull();
  });

  it('moves focus to the search input when opened', () => {
    render(<ProjectPicker {...baseProps} />);
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Search projects'));
  });

  it('marks sibling elements as inert while the picker is open', () => {
    // The sibling must live inside the same React-managed container as the
    // picker (a real sibling of the dialog in the DOM tree) — createRoot wipes
    // any pre-existing children of a custom container before effects run.
    render(
      <>
        <section data-testid="picker-sibling" />
        <ProjectPicker {...baseProps} />
      </>,
    );
    expect(screen.getByTestId('picker-sibling').hasAttribute('inert')).toBe(true);
  });

  it('removes inert from siblings when the picker closes', () => {
    const { rerender } = render(
      <>
        <section data-testid="picker-sibling" />
        <ProjectPicker {...baseProps} />
      </>,
    );
    expect(screen.getByTestId('picker-sibling').hasAttribute('inert')).toBe(true);

    rerender(
      <>
        <section data-testid="picker-sibling" />
        <ProjectPicker {...baseProps} open={false} />
      </>,
    );
    expect(screen.getByTestId('picker-sibling').hasAttribute('inert')).toBe(false);
  });

  it('renders nothing when open is false', () => {
    render(<ProjectPicker {...baseProps} open={false} />);
    expect(screen.queryByText('Projects')).toBeNull();
  });

  it('clicking ✕ calls onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ProjectPicker {...baseProps} onClose={onClose} />);
    await user.click(screen.getByLabelText('Close picker'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('clicking the scrim calls onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ProjectPicker {...baseProps} onClose={onClose} />);
    await user.click(screen.getByTestId('projectpicker-scrim'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Esc calls onClose', () => {
    const onClose = vi.fn();
    render(<ProjectPicker {...baseProps} onClose={onClose} />);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  const fixtureProjects: Project[] = [
    { id: 'p1', title: 'Project 2026-04-28', folder: '2026/04', stems: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }, { id: 'c', name: 'c' }], stemCount: 3, folderId: 'd1', referenceStemId: null, updatedAt: 1714262400000, totalDurationMs: 272_000, commentCount: 0 },
    { id: 'p2', title: 'Project 2026-04-21', folder: '2026/04', stems: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }], stemCount: 2, folderId: 'd2', referenceStemId: null, updatedAt: 1713657600000, totalDurationMs: 180_000, commentCount: 5 },
    { id: 'p3', title: 'Project 2026-03-31', folder: '2026/03', stems: [{ id: 'a', name: 'a' }], stemCount: 1, folderId: null, referenceStemId: null, updatedAt: 1711843200000, totalDurationMs: null, commentCount: 1 },
  ];

  it('renders one row per project', () => {
    render(<ProjectPicker {...baseProps} projects={fixtureProjects} />);
    expect(screen.getByText('Project 2026-04-28')).not.toBeNull();
    expect(screen.getByText('Project 2026-04-21')).not.toBeNull();
    expect(screen.getByText('Project 2026-03-31')).not.toBeNull();
  });

  it('default sort puts the most recently updated project first', () => {
    render(<ProjectPicker {...baseProps} projects={fixtureProjects} />);
    const titles = screen
      .getAllByTestId(/^fp-row-/)
      .map((el) => el.textContent ?? '');
    // p1 (newest) first; p3 (oldest) last.
    expect(titles[0]).toMatch(/Project 2026-04-28/);
    expect(titles[2]).toMatch(/Project 2026-03-31/);
  });

  it('clicking a sort header reorders rows by that column', async () => {
    const user = userEvent.setup();
    render(<ProjectPicker {...baseProps} projects={fixtureProjects} />);
    // Click "Comments" — first click is desc, so p2 (5 comments) leads.
    await user.click(screen.getByRole('button', { name: /^Comments/ }));
    let titles = screen
      .getAllByTestId(/^fp-row-/)
      .map((el) => el.textContent ?? '');
    expect(titles[0]).toMatch(/Project 2026-04-21/);
    // Click again to flip to asc — p1 (0 comments) leads.
    await user.click(screen.getByRole('button', { name: /^Comments/ }));
    titles = screen
      .getAllByTestId(/^fp-row-/)
      .map((el) => el.textContent ?? '');
    expect(titles[0]).toMatch(/Project 2026-04-28/);
  });

  it('renders duration and comment count from project fields', () => {
    render(<ProjectPicker {...baseProps} projects={fixtureProjects} />);
    // 272_000 ms = 4:32
    expect(screen.getByText('4:32')).not.toBeNull();
    // 5 comments on p2 — the row's accessible label exposes the count.
    expect(screen.getByLabelText('5 comments')).not.toBeNull();
    expect(screen.getByLabelText('1 comment')).not.toBeNull();
  });

  it('Trash icon toggles to trash view and back', async () => {
    const user = userEvent.setup();
    const onLoadTrash = vi.fn();
    render(
      <ProjectPicker
        {...baseProps}
        projects={fixtureProjects}
        trash={null}
        onLoadTrash={onLoadTrash}
      />,
    );
    const trashTab = screen.getByRole('tab', { name: /trash/i });
    await user.click(trashTab);
    expect(onLoadTrash).toHaveBeenCalledTimes(1);
    // Clicking the same icon again returns to Recent without re-loading.
    await user.click(trashTab);
    expect(onLoadTrash).toHaveBeenCalledTimes(1);
    // Recent rows are visible again.
    expect(screen.getByText('Project 2026-04-28')).not.toBeNull();
  });

  it('filters by search query (title)', async () => {
    const user = userEvent.setup();
    render(<ProjectPicker {...baseProps} projects={fixtureProjects} />);
    await user.type(screen.getByPlaceholderText('Search projects'), '04-28');
    expect(screen.getByText('Project 2026-04-28')).not.toBeNull();
    expect(screen.queryByText('Project 2026-04-21')).toBeNull();
  });

  it('clicking a row calls onSelect with project id', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ProjectPicker {...baseProps} projects={fixtureProjects} onSelect={onSelect} />);
    await user.click(screen.getByText('Project 2026-04-28'));
    expect(onSelect).toHaveBeenCalledWith('p1');
  });

  it('marks active row with active class', () => {
    render(<ProjectPicker {...baseProps} projects={fixtureProjects} activeProjectId="p2" />);
    const row = screen.getByTestId('fp-row-p2');
    expect(row.className).toContain('active');
  });

  it('shows loading skeleton when loading is true', () => {
    render(<ProjectPicker {...baseProps} loading={true} />);
    expect(screen.getAllByTestId('fp-row-skeleton').length).toBeGreaterThan(0);
  });

  it('shows error and Retry when loadError is set', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<ProjectPicker {...baseProps} loadError="network down" onRetry={onRetry} />);
    expect(screen.getByText(/network down/)).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows empty-state with New project button (when allowed)', () => {
    render(<ProjectPicker {...baseProps} projects={[]} showUpload={true} />);
    expect(screen.getByText(/No projects yet/)).not.toBeNull();
    // The new entry-point label (header + bottom + empty state all read
    // "New project" — we just assert the empty-state action exists).
    expect(
      screen.getAllByRole('button', { name: /New project/i }).length,
    ).toBeGreaterThan(0);
  });

  it('hides New project in empty state when showUpload is false', () => {
    render(<ProjectPicker {...baseProps} projects={[]} showUpload={false} />);
    expect(screen.getByText(/No projects yet/)).not.toBeNull();
    // Header, bottom, and empty-state buttons all gate on showUpload — none
    // of them should appear when the user can't create projects.
    expect(screen.queryByRole('button', { name: /New project/i })).toBeNull();
    // And the legacy "Upload" label is gone.
    expect(screen.queryByRole('button', { name: /Upload/ })).toBeNull();
  });

  it('does not render the Local-folder tab', () => {
    render(<ProjectPicker {...baseProps} />);
    // The picker's tabs are now Recent | All | Trash only.
    expect(screen.queryByRole('tab', { name: /Local folder/i })).toBeNull();
  });

  it('clicking + New project opens the folder picker', async () => {
    const user = userEvent.setup();
    render(<ProjectPicker {...baseProps} projects={[]} showUpload={true} />);
    // The header button triggers a click on the hidden file input — we can't
    // easily intercept the OS dialog, but we can verify the input exists and
    // the click handler is wired by spying on its click method.
    const folderInput = document.querySelector(
      'input[type="file"][webkitdirectory]',
    ) as HTMLInputElement | null;
    expect(folderInput).not.toBeNull();
    const click = vi.spyOn(folderInput!, 'click');
    // Header + bottom + empty-state all render the same button; click any.
    const buttons = screen.getAllByRole('button', { name: /New project/i });
    await user.click(buttons[0]);
    expect(click).toHaveBeenCalled();
  });

  it('renames a project via inline edit', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const rows: Project[] = [
      { id: 'p1', title: 'Alpha', folder: '', stems: [], stemCount: 0, folderId: null, referenceStemId: null, updatedAt: 0, totalDurationMs: null, commentCount: 0 },
    ];
    render(
      <ProjectPicker {...baseProps} projects={rows} onRenameProject={onRename} />,
    );
    await user.click(screen.getByLabelText(/rename Alpha/i));
    const input = screen.getByRole('textbox', { name: /rename project/i });
    await user.clear(input);
    await user.type(input, 'Beta{Enter}');
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('p1', 'Beta'));
  });

  it('Esc cancels inline rename', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const rows: Project[] = [
      { id: 'p1', title: 'Alpha', folder: '', stems: [], stemCount: 0, folderId: null, referenceStemId: null, updatedAt: 0, totalDurationMs: null, commentCount: 0 },
    ];
    render(
      <ProjectPicker {...baseProps} projects={rows} onRenameProject={onRename} />,
    );
    await user.click(screen.getByLabelText(/rename Alpha/i));
    const input = screen.getByRole('textbox', { name: /rename project/i });
    await user.type(input, 'changed{Escape}');
    expect(onRename).not.toHaveBeenCalled();
  });

  it('rename pencil click does not trigger row onSelect', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const rows: Project[] = [
      { id: 'p1', title: 'Alpha', folder: '', stems: [], stemCount: 0, folderId: null, referenceStemId: null, updatedAt: 0, totalDurationMs: null, commentCount: 0 },
    ];
    render(
      <ProjectPicker {...baseProps} projects={rows} onSelect={onSelect} />,
    );
    await user.click(screen.getByLabelText(/rename Alpha/i));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows confirm dialog and calls onDeleteProject on confirm', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const rows: Project[] = [
      { id: 'p1', title: 'Alpha', folder: '', stems: [], stemCount: 0, folderId: null, referenceStemId: null, updatedAt: 0, totalDurationMs: null, commentCount: 0 },
    ];
    render(
      <ProjectPicker {...baseProps} projects={rows} onDeleteProject={onDelete} />,
    );
    await user.click(screen.getByRole('button', { name: /move alpha to trash/i }));
    expect(screen.getByText(/move .*alpha.* to trash/i)).not.toBeNull();
    await user.click(screen.getByRole('button', { name: /^move to trash$/i }));
    expect(onDelete).toHaveBeenCalledWith('p1');
  });

  it('cancel button closes the dialog without deleting', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const rows: Project[] = [
      { id: 'p1', title: 'Alpha', folder: '', stems: [], stemCount: 0, folderId: null, referenceStemId: null, updatedAt: 0, totalDurationMs: null, commentCount: 0 },
    ];
    render(
      <ProjectPicker {...baseProps} projects={rows} onDeleteProject={onDelete} />,
    );
    await user.click(screen.getByRole('button', { name: /move alpha to trash/i }));
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('renders trash tab content with restore buttons', async () => {
    const user = userEvent.setup();
    const onRestoreProject = vi.fn();
    const onRestoreStem = vi.fn();
    const trash: TrashList = {
      projects: [{
        id: 'p1', name: 'Trashed', deleted_at: 1700000000,
        deleted_by_email: 'a@b.com', deleted_reason: 'user',
      }],
      stems: [{
        id: 's1', name: 'gone.wav', project_id: 'p2', project_name: 'Live',
        deleted_at: 1700000000, deleted_by_email: 'a@b.com', deleted_reason: 'drive_missing',
      }],
    };
    render(
      <ProjectPicker
        {...baseProps}
        trash={trash}
        onRestoreProject={onRestoreProject}
        onRestoreStem={onRestoreStem}
      />,
    );

    await user.click(screen.getByRole('tab', { name: /trash/i }));

    expect(screen.queryByText('Trashed')).not.toBeNull();
    expect(screen.queryByText('gone.wav')).not.toBeNull();

    const restoreProjectBtn = screen.getByRole('button', { name: /restore Trashed/i });
    const restoreStemBtn = screen.getByRole('button', { name: /restore gone.wav/i });
    expect(restoreProjectBtn.hasAttribute('disabled')).toBe(false);
    expect(restoreStemBtn.hasAttribute('disabled')).toBe(true);

    await user.click(restoreProjectBtn);
    expect(onRestoreProject).toHaveBeenCalledWith('p1');
  });

  it('calls onLoadTrash when trash tab is selected', async () => {
    const user = userEvent.setup();
    const onLoadTrash = vi.fn();
    render(
      <ProjectPicker {...baseProps} trash={null} onLoadTrash={onLoadTrash} />,
    );

    await user.click(screen.getByRole('tab', { name: /trash/i }));
    expect(onLoadTrash).toHaveBeenCalled();
  });

  it('Esc closes the delete-confirm modal without closing the picker', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onDelete = vi.fn();
    const rows: Project[] = [
      { id: 'p1', title: 'Alpha', folder: '', stems: [], stemCount: 0, folderId: null, referenceStemId: null, updatedAt: 0, totalDurationMs: null, commentCount: 0 },
    ];
    render(
      <ProjectPicker
        {...baseProps}
        projects={rows}
        onClose={onClose}
        onDeleteProject={onDelete}
      />,
    );
    await user.click(screen.getByRole('button', { name: /move alpha to trash/i }));
    expect(screen.getByText(/move .*alpha.* to trash/i)).not.toBeNull();
    // Cancel should have initial focus.
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /^cancel$/i }),
    );
    await user.keyboard('{Escape}');
    // Confirm modal gone, but picker still open and onClose not called.
    expect(screen.queryByText(/move .*alpha.* to trash/i)).toBeNull();
    expect(screen.getByText('Projects')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('shows trash error banner with Retry when trashError is set', async () => {
    const user = userEvent.setup();
    const onLoadTrash = vi.fn();
    render(
      <ProjectPicker
        {...baseProps}
        trash={null}
        trashError="network down"
        onLoadTrash={onLoadTrash}
      />,
    );
    await user.click(screen.getByRole('tab', { name: /trash/i }));
    expect(screen.getByText(/couldn't load trash/i)).not.toBeNull();
    expect(screen.getByText(/network down/)).not.toBeNull();
    // Should NOT be the "empty" state.
    expect(screen.queryByText(/trash is empty/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(onLoadTrash).toHaveBeenCalled();
  });

  it('shows starter song chips when empty and narrows them as you type', async () => {
    const user = userEvent.setup();
    render(
      <ProjectPicker
        {...baseProps}
        bandSongs={[
          { id: 's-1', band_id: 'b', name: 'Heart Sounds', created_at: 0, use_count: 4 },
          { id: 's-2', band_id: 'b', name: 'Solo Idea', created_at: 0, use_count: 1 },
          // use_count = 0 — a catalog ghost, never offered as a filter
          { id: 's-3', band_id: 'b', name: 'Heartless', created_at: 0, use_count: 0 },
        ]}
      />,
    );
    // Empty query → used songs are offered as starter chips so the feature
    // stays visible; the ghost (use_count 0) is never offered.
    expect(screen.queryByTestId('fp-song-chip-s-1')).not.toBeNull();
    expect(screen.queryByTestId('fp-song-chip-s-2')).not.toBeNull();
    expect(screen.queryByTestId('fp-song-chip-s-3')).toBeNull();
    // Typing narrows the chips to name matches (and still excludes the ghost).
    await user.type(screen.getByPlaceholderText('Search projects'), 'heart');
    expect(screen.queryByTestId('fp-song-chip-s-1')).not.toBeNull();
    expect(screen.queryByTestId('fp-song-chip-s-2')).toBeNull();
    expect(screen.queryByTestId('fp-song-chip-s-3')).toBeNull();
  });

  it('caps the starter chips and hides the "1" count noise', () => {
    const bandSongs = Array.from({ length: 9 }, (_, i) => ({
      id: `s-${i}`,
      band_id: 'b',
      // Letter names (no digits) so the count-badge assertion isn't fooled.
      name: `Song ${String.fromCharCode(65 + i)}`,
      created_at: 0,
      // s-0 is used twice (count shows), the rest once (count hidden).
      use_count: i === 0 ? 2 : 1,
    }));
    render(<ProjectPicker {...baseProps} bandSongs={bandSongs} />);
    // Only 6 starter chips render even though 9 songs are in use.
    expect(screen.getAllByTestId(/^fp-song-chip-/).length).toBe(6);
    // The use_count == 1 chips show no count badge; the count == 2 one does.
    expect(screen.getByTestId('fp-song-chip-s-0').textContent).toContain('2');
    expect(screen.getByTestId('fp-song-chip-s-1').textContent).toBe('Song B');
  });

  it('clicking a song chip applies the filter and clears the search', async () => {
    const user = userEvent.setup();
    const onSetFilterSongId = vi.fn();
    render(
      <ProjectPicker
        {...baseProps}
        bandSongs={[
          { id: 's-1', band_id: 'b', name: 'Heart Sounds', created_at: 0, use_count: 4 },
        ]}
        onSetFilterSongId={onSetFilterSongId}
      />,
    );
    const input = screen.getByPlaceholderText('Search projects');
    await user.type(input, 'heart');
    await user.click(screen.getByTestId('fp-song-chip-s-1'));
    expect(onSetFilterSongId).toHaveBeenCalledWith('s-1');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('shows an active-filter pill that clears the filter when clicked', async () => {
    const user = userEvent.setup();
    const onSetFilterSongId = vi.fn();
    render(
      <ProjectPicker
        {...baseProps}
        filterSongId="s-1"
        bandSongs={[
          { id: 's-1', band_id: 'b', name: 'Heart Sounds', created_at: 0, use_count: 4 },
        ]}
        onSetFilterSongId={onSetFilterSongId}
      />,
    );
    const pill = screen.getByTestId('fp-song-active-s-1');
    expect(pill).not.toBeNull();
    await user.click(pill);
    expect(onSetFilterSongId).toHaveBeenCalledWith(null);
  });

  it('filters the project list when a song filter is active', () => {
    const rows: Project[] = [
      { id: 'p1', title: 'Alpha', folder: '', stems: [], stemCount: 0, folderId: null, referenceStemId: null },
      { id: 'p2', title: 'Bravo', folder: '', stems: [], stemCount: 0, folderId: null, referenceStemId: null },
      { id: 'p3', title: 'Charlie', folder: '', stems: [], stemCount: 0, folderId: null, referenceStemId: null },
    ];
    render(
      <ProjectPicker
        {...baseProps}
        projects={rows}
        filterSongId="s-1"
        bandSongs={[
          { id: 's-1', band_id: 'b', name: 'Heart Sounds', created_at: 0, use_count: 2 },
        ]}
        songUsage={[
          { project_id: 'p1', song_id: 's-1' },
          { project_id: 'p3', song_id: 's-1' },
        ]}
      />,
    );
    // Only p1 and p3 contain Heart Sounds; p2 should be filtered out.
    expect(screen.queryByText('Alpha')).not.toBeNull();
    expect(screen.queryByText('Bravo')).toBeNull();
    expect(screen.queryByText('Charlie')).not.toBeNull();
  });

  it('text query narrows rows by title only; songs are a separate facet', async () => {
    const user = userEvent.setup();
    const onSetFilterSongId = vi.fn();
    const rows: Project[] = [
      { id: 'p1', title: 'Tuesday jam', folder: '', stems: [], stemCount: 0, folderId: null, referenceStemId: null },
      { id: 'p2', title: 'Wednesday jam', folder: '', stems: [], stemCount: 0, folderId: null, referenceStemId: null },
    ];
    render(
      <ProjectPicker
        {...baseProps}
        projects={rows}
        bandSongs={[
          { id: 's-1', band_id: 'b', name: 'Heart Sounds', created_at: 0, use_count: 1 },
        ]}
        songUsage={[{ project_id: 'p1', song_id: 's-1' }]}
        onSetFilterSongId={onSetFilterSongId}
      />,
    );
    // "heart" matches no project TITLE, so no rows surface by song name —
    // songs are reached through the chip facet, not row matching.
    await user.type(screen.getByPlaceholderText('Search projects'), 'heart');
    expect(screen.queryByText('Tuesday jam')).toBeNull();
    expect(screen.queryByText('Wednesday jam')).toBeNull();
    // Instead the matching song is offered as a "Filter by song" suggestion.
    await user.click(screen.getByTestId('fp-song-chip-s-1'));
    expect(onSetFilterSongId).toHaveBeenCalledWith('s-1');
  });

  it('shows a distinct empty-state when a search matches no projects', async () => {
    const user = userEvent.setup();
    const rows: Project[] = [
      { id: 'p1', title: 'Tuesday jam', folder: '', stems: [], stemCount: 0, folderId: null, referenceStemId: null },
    ];
    render(<ProjectPicker {...baseProps} projects={rows} />);
    await user.type(screen.getByPlaceholderText('Search projects'), 'zzz');
    // Not the "first project" CTA — the band already has projects.
    expect(screen.queryByText(/No projects yet/i)).toBeNull();
    expect(screen.getByText(/No projects match your search/i)).not.toBeNull();
    // Clearing restores the full list.
    await user.click(screen.getByRole('button', { name: /clear search/i }));
    expect(screen.queryByText('Tuesday jam')).not.toBeNull();
  });

  it('points at the song chips when the query matches a song but no title', async () => {
    const user = userEvent.setup();
    const rows: Project[] = [
      { id: 'p1', title: 'Tuesday jam', folder: '', stems: [], stemCount: 0, folderId: null, referenceStemId: null },
    ];
    render(
      <ProjectPicker
        {...baseProps}
        projects={rows}
        bandSongs={[
          { id: 's-1', band_id: 'b', name: 'Island in the Sun', created_at: 0, use_count: 1 },
        ]}
        songUsage={[{ project_id: 'p1', song_id: 's-1' }]}
      />,
    );
    // "island" matches no project title, but matches the song.
    await user.type(screen.getByPlaceholderText('Search projects'), 'island');
    expect(screen.getByText(/No project titled/i)).not.toBeNull();
    expect(screen.getByText(/Pick a song above/i)).not.toBeNull();
    // The matching song chip is right there to act on.
    expect(screen.queryByTestId('fp-song-chip-s-1')).not.toBeNull();
  });

  it('ArrowDown highlights the first row', async () => {
    const user = userEvent.setup();
    render(<ProjectPicker {...baseProps} projects={fixtureProjects} />);
    await user.keyboard('{ArrowDown}');
    const rows = screen.getAllByTestId(/^fp-row-/);
    expect(rows[0].className).toContain('fp-row-highlighted');
    expect(rows[1].className).not.toContain('fp-row-highlighted');
  });

  it('ArrowDown then ArrowDown highlights the second row', async () => {
    const user = userEvent.setup();
    render(<ProjectPicker {...baseProps} projects={fixtureProjects} />);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    const rows = screen.getAllByTestId(/^fp-row-/);
    expect(rows[0].className).not.toContain('fp-row-highlighted');
    expect(rows[1].className).toContain('fp-row-highlighted');
  });

  it('ArrowUp from first row clears the highlight', async () => {
    const user = userEvent.setup();
    render(<ProjectPicker {...baseProps} projects={fixtureProjects} />);
    await user.keyboard('{ArrowDown}{ArrowUp}');
    const rows = screen.getAllByTestId(/^fp-row-/);
    rows.forEach((r) => expect(r.className).not.toContain('fp-row-highlighted'));
  });

  it('Enter selects the highlighted row', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ProjectPicker {...baseProps} projects={fixtureProjects} onSelect={onSelect} />);
    // ArrowDown highlights first row (p1 is newest so it's first in default sort)
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith('p1');
  });

  it('Enter with no highlight selects the sole result when search narrows to one', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ProjectPicker {...baseProps} projects={fixtureProjects} onSelect={onSelect} />);
    await user.type(screen.getByPlaceholderText('Search projects'), '04-28');
    // Only p1 visible — Enter without ArrowDown should select it.
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('p1');
  });

  it('Enter with no highlight does nothing when multiple rows are visible', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ProjectPicker {...baseProps} projects={fixtureProjects} onSelect={onSelect} />);
    await user.keyboard('{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('highlight resets when search changes', async () => {
    const user = userEvent.setup();
    render(<ProjectPicker {...baseProps} projects={fixtureProjects} />);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    // Changing the search text should clear the highlight index
    await user.type(screen.getByPlaceholderText('Search projects'), '2026');
    const rows = screen.getAllByTestId(/^fp-row-/);
    rows.forEach((r) => expect(r.className).not.toContain('fp-row-highlighted'));
  });
});
