import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { FilePicker } from './FilePicker';
import type { Practice, TrashList } from '../data/types';

const practices: Practice[] = []; // empty for now
const baseProps = {
  open: true,
  loading: false,
  loadError: null,
  practices,
  activePracticeId: null,
  showUpload: true,
  onClose: vi.fn(),
  onSelect: vi.fn(),
  onLoadFolder: vi.fn(),
  onUploadClick: vi.fn(),
  onRetry: vi.fn(),
  onRenamePractice: vi.fn(),
  onDeletePractice: vi.fn(),
  trash: null as TrashList | null,
  trashError: null as string | null,
  onLoadTrash: vi.fn(),
  onRestorePractice: vi.fn(),
  onRestoreStem: vi.fn(),
};

describe('FilePicker', () => {
  it('renders title and close button when open', () => {
    render(<FilePicker {...baseProps} />);
    expect(screen.getByText('Practices')).not.toBeNull();
    expect(screen.getByLabelText('Close picker')).not.toBeNull();
  });

  it('renders nothing when open is false', () => {
    render(<FilePicker {...baseProps} open={false} />);
    expect(screen.queryByText('Practices')).toBeNull();
  });

  it('clicking ✕ calls onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<FilePicker {...baseProps} onClose={onClose} />);
    await user.click(screen.getByLabelText('Close picker'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('clicking the scrim calls onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<FilePicker {...baseProps} onClose={onClose} />);
    await user.click(screen.getByTestId('filepicker-scrim'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Esc calls onClose', () => {
    const onClose = vi.fn();
    render(<FilePicker {...baseProps} onClose={onClose} />);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  const fixturePractices: Practice[] = [
    { id: 'p1', title: 'Practice 2026-04-28', folder: '2026/04', stems: ['a','b','c'], stemCount: 3, driveFolderId: 'd1', referenceStemId: null },
    { id: 'p2', title: 'Practice 2026-04-21', folder: '2026/04', stems: ['a','b'], stemCount: 2, driveFolderId: 'd2', referenceStemId: null },
    { id: 'p3', title: 'Practice 2026-03-31', folder: '2026/03', stems: ['a'], stemCount: 1, driveFolderId: null, referenceStemId: null },
  ];

  it('renders one row per practice', () => {
    render(<FilePicker {...baseProps} practices={fixturePractices} />);
    expect(screen.getByText('Practice 2026-04-28')).not.toBeNull();
    expect(screen.getByText('Practice 2026-04-21')).not.toBeNull();
    expect(screen.getByText('Practice 2026-03-31')).not.toBeNull();
  });

  it('filters by search query (title)', async () => {
    const user = userEvent.setup();
    render(<FilePicker {...baseProps} practices={fixturePractices} />);
    await user.type(screen.getByPlaceholderText('Search practices'), '04-28');
    expect(screen.getByText('Practice 2026-04-28')).not.toBeNull();
    expect(screen.queryByText('Practice 2026-04-21')).toBeNull();
  });

  it('clicking a row calls onSelect with practice id', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<FilePicker {...baseProps} practices={fixturePractices} onSelect={onSelect} />);
    await user.click(screen.getByText('Practice 2026-04-28'));
    expect(onSelect).toHaveBeenCalledWith('p1');
  });

  it('marks active row with active class', () => {
    render(<FilePicker {...baseProps} practices={fixturePractices} activePracticeId="p2" />);
    const row = screen.getByTestId('fp-row-p2');
    expect(row.className).toContain('active');
  });

  it('shows loading skeleton when loading is true', () => {
    render(<FilePicker {...baseProps} loading={true} />);
    expect(screen.getAllByTestId('fp-row-skeleton').length).toBeGreaterThan(0);
  });

  it('shows error and Retry when loadError is set', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<FilePicker {...baseProps} loadError="network down" onRetry={onRetry} />);
    expect(screen.getByText(/network down/)).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows empty-state with Upload (when allowed) and Local folder', () => {
    render(<FilePicker {...baseProps} practices={[]} showUpload={true} />);
    expect(screen.getByText(/No practices yet/)).not.toBeNull();
  });

  it('hides Upload in empty state when showUpload is false', () => {
    render(<FilePicker {...baseProps} practices={[]} showUpload={false} />);
    expect(screen.getByText(/No practices yet/)).not.toBeNull();
    // No "+ Upload" button in the empty body. The header upload button may still
    // be present when showUpload=false ... it shouldn't be (header gates on showUpload too)
    expect(screen.queryByRole('button', { name: /Upload/ })).toBeNull();
  });

  it('renders Drive ↗ link per row when driveFolderId set', () => {
    render(<FilePicker {...baseProps} practices={fixturePractices} />);
    const row = screen.getByTestId('fp-row-p1');
    const link = row.querySelector('.fp-drive-link') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.href).toContain('drive.google.com/drive/folders/d1');
    expect(link.target).toBe('_blank');
  });

  it('hides Drive ↗ when driveFolderId is null', () => {
    render(<FilePicker {...baseProps} practices={fixturePractices} />);
    const row = screen.getByTestId('fp-row-p3');
    expect(row.querySelector('.fp-drive-link')).toBeNull();
  });

  it('clicking Drive ↗ does not trigger row onSelect', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<FilePicker {...baseProps} practices={fixturePractices} onSelect={onSelect} />);
    const row = screen.getByTestId('fp-row-p1');
    const link = row.querySelector('.fp-drive-link') as HTMLAnchorElement;
    await user.click(link);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renames a practice via inline edit', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const rows: Practice[] = [
      { id: 'p1', title: 'Alpha', folder: '', stems: [], driveFolderId: null },
    ];
    render(
      <FilePicker {...baseProps} practices={rows} onRenamePractice={onRename} />,
    );
    await user.click(screen.getByLabelText(/rename Alpha/i));
    const input = screen.getByRole('textbox', { name: /rename practice/i });
    await user.clear(input);
    await user.type(input, 'Beta{Enter}');
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('p1', 'Beta'));
  });

  it('Esc cancels inline rename', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const rows: Practice[] = [
      { id: 'p1', title: 'Alpha', folder: '', stems: [], driveFolderId: null },
    ];
    render(
      <FilePicker {...baseProps} practices={rows} onRenamePractice={onRename} />,
    );
    await user.click(screen.getByLabelText(/rename Alpha/i));
    const input = screen.getByRole('textbox', { name: /rename practice/i });
    await user.type(input, 'changed{Escape}');
    expect(onRename).not.toHaveBeenCalled();
  });

  it('rename pencil click does not trigger row onSelect', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const rows: Practice[] = [
      { id: 'p1', title: 'Alpha', folder: '', stems: [], driveFolderId: null },
    ];
    render(
      <FilePicker {...baseProps} practices={rows} onSelect={onSelect} />,
    );
    await user.click(screen.getByLabelText(/rename Alpha/i));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows confirm dialog and calls onDeletePractice on confirm', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const rows: Practice[] = [
      { id: 'p1', title: 'Alpha', folder: '', stems: [], driveFolderId: null },
    ];
    render(
      <FilePicker {...baseProps} practices={rows} onDeletePractice={onDelete} />,
    );
    await user.click(screen.getByRole('button', { name: /move alpha to trash/i }));
    expect(screen.getByText(/move .*alpha.* to trash/i)).not.toBeNull();
    await user.click(screen.getByRole('button', { name: /^move to trash$/i }));
    expect(onDelete).toHaveBeenCalledWith('p1');
  });

  it('cancel button closes the dialog without deleting', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const rows: Practice[] = [
      { id: 'p1', title: 'Alpha', folder: '', stems: [], driveFolderId: null },
    ];
    render(
      <FilePicker {...baseProps} practices={rows} onDeletePractice={onDelete} />,
    );
    await user.click(screen.getByRole('button', { name: /move alpha to trash/i }));
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('renders trash tab content with restore buttons', async () => {
    const user = userEvent.setup();
    const onRestorePractice = vi.fn();
    const onRestoreStem = vi.fn();
    const trash: TrashList = {
      practices: [{
        id: 'p1', name: 'Trashed', deleted_at: 1700000000,
        deleted_by_email: 'a@b.com', deleted_reason: 'user',
      }],
      stems: [{
        id: 's1', name: 'gone.wav', practice_id: 'p2', practice_name: 'Live',
        deleted_at: 1700000000, deleted_by_email: 'a@b.com', deleted_reason: 'drive_missing',
      }],
    };
    render(
      <FilePicker
        {...baseProps}
        trash={trash}
        onRestorePractice={onRestorePractice}
        onRestoreStem={onRestoreStem}
      />,
    );

    await user.click(screen.getByRole('tab', { name: /trash/i }));

    expect(screen.queryByText('Trashed')).not.toBeNull();
    expect(screen.queryByText('gone.wav')).not.toBeNull();

    const restorePracticeBtn = screen.getByRole('button', { name: /restore Trashed/i });
    const restoreStemBtn = screen.getByRole('button', { name: /restore gone.wav/i });
    expect(restorePracticeBtn.hasAttribute('disabled')).toBe(false);
    expect(restoreStemBtn.hasAttribute('disabled')).toBe(true);

    await user.click(restorePracticeBtn);
    expect(onRestorePractice).toHaveBeenCalledWith('p1');
  });

  it('calls onLoadTrash when trash tab is selected', async () => {
    const user = userEvent.setup();
    const onLoadTrash = vi.fn();
    render(
      <FilePicker {...baseProps} trash={null} onLoadTrash={onLoadTrash} />,
    );

    await user.click(screen.getByRole('tab', { name: /trash/i }));
    expect(onLoadTrash).toHaveBeenCalled();
  });

  it('Esc closes the delete-confirm modal without closing the picker', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onDelete = vi.fn();
    const rows: Practice[] = [
      { id: 'p1', title: 'Alpha', folder: '', stems: [], driveFolderId: null },
    ];
    render(
      <FilePicker
        {...baseProps}
        practices={rows}
        onClose={onClose}
        onDeletePractice={onDelete}
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
    expect(screen.getByText('Practices')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('shows trash error banner with Retry when trashError is set', async () => {
    const user = userEvent.setup();
    const onLoadTrash = vi.fn();
    render(
      <FilePicker
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
});
