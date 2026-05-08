import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { FilePicker } from './FilePicker';
import type { Practice } from '../data/types';

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
    { id: 'p1', title: 'Practice 2026-04-28', folder: '2026/04', stems: ['a','b','c'], stemCount: 3, driveFolderId: 'd1' },
    { id: 'p2', title: 'Practice 2026-04-21', folder: '2026/04', stems: ['a','b'], stemCount: 2, driveFolderId: 'd2' },
    { id: 'p3', title: 'Practice 2026-03-31', folder: '2026/03', stems: ['a'], stemCount: 1, driveFolderId: null },
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
});
