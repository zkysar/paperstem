import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShareDialog } from './ShareDialog';
import type { Annotation } from '../../shared/types';
import type { ShareState } from '../lib/share-url';

function ann(over: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    project_id: 'p1',
    user_id: 'u1',
    user_email: 'sam@example.com',
    user_display_name: 'Sam',
    start_ms: 83000,
    end_ms: null,
    body: 'thought',
    starred: false,
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

const baseState: ShareState = {
  projectId: 'proj-123',
  time: 83,
  loop: { start: 60, end: 150, enabled: true },
  mix: [
    { stemId: 's1', muted: true },
    { stemId: 's2', soloed: true },
  ],
  masterVolume: 80,
  view: { timeLeft: 0, timeRight: 200 },
  trackHeight: 100,
  focusedCommentId: 'a1',
};

describe('ShareDialog', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'https://paperstem.app/' },
    });
  });

  it('renders nothing when open=false', () => {
    const { container } = render(
      <ShareDialog open={false} state={baseState} focusedAnnotation={null} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the dialog and a Linked-to subhead naming the focused comment', () => {
    render(
      <ShareDialog
        open={true}
        state={baseState}
        focusedAnnotation={ann()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog', { name: /share link/i })).not.toBeNull();
    expect(screen.getByTestId('share-dialog-target').textContent)
      .toMatch(/Linked to Sam's comment at 1:23/);
  });

  it('without a comment, falls back to a loop-anchored Linked-to label', () => {
    const state: ShareState = {
      projectId: 'p',
      loop: { start: 60, end: 90, enabled: true },
    };
    render(<ShareDialog open state={state} focusedAnnotation={null} onClose={vi.fn()} />);
    expect(screen.getByTestId('share-dialog-target').textContent)
      .toMatch(/Linked to loop 1:00 – 1:30/);
  });

  it('with no loop or comment, falls back to a time-anchored Linked-to label', () => {
    const state: ShareState = { projectId: 'p', time: 45 };
    render(<ShareDialog open state={state} focusedAnnotation={null} onClose={vi.fn()} />);
    expect(screen.getByTestId('share-dialog-target').textContent).toMatch(/Linked at 0:45/);
  });

  it('with nothing extra, says "Project link" and shows an empty-state message', () => {
    const state: ShareState = { projectId: 'p' };
    render(<ShareDialog open state={state} focusedAnnotation={null} onClose={vi.fn()} />);
    expect(screen.getByTestId('share-dialog-target').textContent).toBe('Project link');
    expect(screen.getByText(/no extra state/i)).not.toBeNull();
  });

  it('renders one toggle row per piece of bundled state', () => {
    render(
      <ShareDialog
        open
        state={baseState}
        focusedAnnotation={ann()}
        onClose={vi.fn()}
      />,
    );
    // All five available toggles are present, checked by default.
    expect(screen.getByLabelText(/Start time/).hasAttribute('checked') ||
      (screen.getByLabelText(/Start time/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/Loop region/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/Stem mix/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/Zoom & scroll/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/Focused comment/) as HTMLInputElement).checked).toBe(true);
  });

  it('unchecking a toggle strips that param from the URL preview', async () => {
    const user = userEvent.setup();
    render(
      <ShareDialog
        open
        state={baseState}
        focusedAnnotation={ann()}
        onClose={vi.fn()}
      />,
    );
    const url = () => (screen.getByLabelText('Share URL') as HTMLInputElement).value;
    expect(url()).toMatch(/l=60\.00-150\.00/);
    expect(url()).toMatch(/mix=/);
    await user.click(screen.getByLabelText(/Loop region/));
    expect(url()).not.toMatch(/l=60\.00/);
    expect(url()).toMatch(/mix=/);
    await user.click(screen.getByLabelText(/Stem mix/));
    expect(url()).not.toMatch(/mix=/);
    // Master volume rides with the mix toggle (audio-settings bundle).
    expect(url()).not.toMatch(/mv=/);
  });

  it('Linked-to label updates when the comment toggle is unchecked', async () => {
    const user = userEvent.setup();
    render(
      <ShareDialog
        open
        state={baseState}
        focusedAnnotation={ann()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId('share-dialog-target').textContent).toMatch(/Sam's comment/);
    await user.click(screen.getByLabelText(/Focused comment/));
    // With comment off, falls back to the next-most-specific anchor (loop).
    expect(screen.getByTestId('share-dialog-target').textContent).toMatch(/Linked to loop/);
  });

  it('Copy button writes the live URL to the clipboard and flips to "Copied ✓"', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(
      <ShareDialog
        open
        state={baseState}
        focusedAnnotation={ann()}
        onClose={vi.fn()}
      />,
    );
    const copyBtn = screen.getByRole('button', { name: /^Copy link$/ });
    await user.click(copyBtn);
    expect(writeText).toHaveBeenCalledOnce();
    const writtenUrl = writeText.mock.calls[0][0] as string;
    expect(writtenUrl).toContain('p=proj-123');
    expect(writtenUrl).toContain('fc=a1');
    expect(screen.getByRole('button', { name: /Copied/ })).not.toBeNull();
  });

  it('toggling after a successful copy clears the "Copied" indicator', async () => {
    const user = userEvent.setup();
    render(
      <ShareDialog
        open
        state={baseState}
        focusedAnnotation={ann()}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^Copy link$/ }));
    expect(screen.getByRole('button', { name: /Copied/ })).not.toBeNull();
    await user.click(screen.getByLabelText(/Stem mix/));
    expect(screen.getByRole('button', { name: /^Copy link$/ })).not.toBeNull();
  });

  it('shows an error message when the clipboard write rejects', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) },
    });
    render(
      <ShareDialog
        open
        state={baseState}
        focusedAnnotation={ann()}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^Copy link$/ }));
    expect(screen.getByRole('alert').textContent).toMatch(/Select the URL/);
  });

  it('Escape and the close button both call onClose', () => {
    const onClose = vi.fn();
    render(
      <ShareDialog open state={baseState} focusedAnnotation={ann()} onClose={onClose} />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByLabelText(/Close share dialog/));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('in public mode emits a /p/<token> URL and hides the link-admin section', () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'https://paperstem.app/p/pls_abc', origin: 'https://paperstem.app' },
    });
    render(
      <ShareDialog
        open
        state={baseState}
        focusedAnnotation={ann()}
        publicToken="pls_abc"
        onClose={vi.fn()}
      />,
    );
    const url = (screen.getByLabelText('Share URL') as HTMLInputElement).value;
    expect(url).toMatch(/^https:\/\/paperstem\.app\/p\/pls_abc#/);
    expect(url).toContain('fc=a1');
    // The internal project id must not leak into a public link.
    expect(url).not.toMatch(/(^|[#&])p=/);
    // Owner-only create/revoke UI is not shown to public viewers.
    expect(screen.queryByTestId('public-link-section')).toBeNull();
  });

  it('clicking the scrim closes; clicking the dialog body does not', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ShareDialog open state={baseState} focusedAnnotation={ann()} onClose={onClose} />,
    );
    const scrim = container.querySelector('.share-dialog-scrim') as HTMLElement;
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
