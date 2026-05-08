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
    { id: 'p1', title: 'Practice 2026-04-28', folder: '2026/04', stems: ['a','b','c'], driveFolderId: 'd1' },
    { id: 'p2', title: 'Practice 2026-04-21', folder: '2026/04', stems: ['a','b'], driveFolderId: 'd2' },
    { id: 'p3', title: 'Practice 2026-03-31', folder: '2026/03', stems: ['a'], driveFolderId: null },
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
});
