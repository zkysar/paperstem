import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { UploadDrawer } from './UploadDrawer';

const baseProps = {
  bandId: 'band-1',
  open: true,
  onClose: vi.fn(),
  onUploaded: vi.fn(),
};

describe('UploadDrawer', () => {
  it('renders the standard upload form when no prefill is supplied', () => {
    render(<UploadDrawer {...baseProps} />);
    expect(screen.getByText('Upload practice')).not.toBeNull();
    // Folder input is the only way to provide stems in the standalone flow.
    const folderInput = document.querySelector(
      'input[type="file"][webkitdirectory]',
    ) as HTMLInputElement | null;
    expect(folderInput).not.toBeNull();
  });

  it('skips the folder picker UI when prefilledFiles is supplied', () => {
    const file = new File(
      [new Uint8Array([0])],
      'kick.wav',
      { type: 'audio/wav' },
    );
    render(
      <UploadDrawer
        {...baseProps}
        prefilledFiles={[file]}
        prefilledName="My band practice"
      />,
    );
    // Heading flips to the promote-flow title.
    expect(screen.getByText('Save to your band')).not.toBeNull();
    // Folder input is hidden — the user already picked the folder upstream.
    const folderInput = document.querySelector(
      'input[type="file"][webkitdirectory]',
    ) as HTMLInputElement | null;
    expect(folderInput).toBeNull();
    // Prefilled files appear in the list immediately.
    expect(screen.getByText('kick.wav')).not.toBeNull();
    // Practice name field defaults to the prefilled name.
    const nameInput = screen.getByLabelText(/practice name/i) as HTMLInputElement;
    expect(nameInput.value).toBe('My band practice');
  });
});
