import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BugReportDrawer } from './BugReportDrawer';
import * as capture from '../lib/captureScreenshot';
import { clearClientErrorBuffer } from '../lib/clientErrorBuffer';

const baseProps = {
  open: true,
  isNarrow: false,
  reporterEmail: 'zach@example.com',
  appVersion: 'v0.2.1',
  prefill: null as null | { description?: string },
  pageContext: { page: 'player', projectId: 'abc' },
  onClose: vi.fn(),
};

beforeEach(() => {
  clearClientErrorBuffer();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeFetch(status: number) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ ok: true }),
  });
}

function fakeScreenshot(base64 = 'BASE64DATA'): capture.Screenshot {
  return {
    blob: new Blob(['x'], { type: 'image/png' }),
    base64,
    width: 100,
    height: 50,
    dataUrl: `data:image/png;base64,${base64}`,
  };
}

describe('BugReportDrawer', () => {
  it('does not render when closed', () => {
    render(<BugReportDrawer {...baseProps} open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Send button is disabled until description is non-empty', async () => {
    const user = userEvent.setup();
    render(<BugReportDrawer {...baseProps} onClose={vi.fn()} />);
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await user.type(screen.getByLabelText('Describe the bug'), 'something broke');
    expect(send.disabled).toBe(false);
  });

  it('submits without a screenshot and shows the sent toast', async () => {
    const user = userEvent.setup();
    const fetchMock = makeFetch(200);
    vi.stubGlobal('fetch', fetchMock);

    render(<BugReportDrawer {...baseProps} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText('Describe the bug'), 'it broke');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body as string);
    expect(body.description).toBe('it broke');
    expect(body.screenshotBase64).toBeUndefined();
    expect(body.pageContext).toEqual({ page: 'player', projectId: 'abc' });

    await waitFor(() => expect(screen.getByText('Sent. Thanks.')).not.toBeNull());
  });

  it('opens the cropper after capture, then attaches the chosen image on Use full image', async () => {
    const user = userEvent.setup();
    vi.spyOn(capture, 'captureCurrentTab').mockResolvedValue(fakeScreenshot());
    const fetchMock = makeFetch(200);
    vi.stubGlobal('fetch', fetchMock);

    render(<BugReportDrawer {...baseProps} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText('Describe the bug'), 'check this');
    await user.click(screen.getByRole('button', { name: /Add screenshot/i }));

    // Cropper is rendered.
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: /Crop screenshot/i })).not.toBeNull(),
    );

    await user.click(screen.getByRole('button', { name: 'Use full image' }));
    await waitFor(() =>
      expect(screen.getByText('Does this look right?')).not.toBeNull(),
    );

    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.screenshotBase64).toBe('BASE64DATA');
  });

  it('Cancel in the cropper drops the screenshot and returns to the drawer', async () => {
    const user = userEvent.setup();
    vi.spyOn(capture, 'captureCurrentTab').mockResolvedValue(fakeScreenshot());

    render(<BugReportDrawer {...baseProps} onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Add screenshot/i }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: /Crop screenshot/i })).not.toBeNull(),
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: /Crop screenshot/i })).toBeNull();
    expect(screen.queryByText('Does this look right?')).toBeNull();
    expect(screen.getByRole('button', { name: /Add screenshot/i })).not.toBeNull();
  });

  it('shows an inline error when capture fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(capture, 'captureCurrentTab').mockResolvedValue(null);

    render(<BugReportDrawer {...baseProps} onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Add screenshot/i }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/Couldn't capture/i),
    );
  });

  it('preserves description and surfaces error when send fails', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', makeFetch(500));

    render(<BugReportDrawer {...baseProps} onClose={vi.fn()} />);
    const textarea = screen.getByLabelText('Describe the bug') as HTMLTextAreaElement;
    await user.type(textarea, 'broken again');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/Couldn't send/i),
    );
    expect(textarea.value).toBe('broken again');
  });

  it('shows the rate-limit message on 429', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', makeFetch(429));

    render(<BugReportDrawer {...baseProps} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText('Describe the bug'), 'again');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/wait a few minutes/i),
    );
  });

  it('pre-fills description from prefill prop', () => {
    render(
      <BugReportDrawer
        {...baseProps}
        onClose={vi.fn()}
        prefill={{ description: '[crash] ' }}
      />,
    );
    const textarea = screen.getByLabelText('Describe the bug') as HTMLTextAreaElement;
    expect(textarea.value).toBe('[crash] ');
  });
});
