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
});
