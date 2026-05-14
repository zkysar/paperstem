import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UploadDrawer } from './UploadDrawer';

const baseProps = {
  bandId: 'band-1',
  open: true,
  onClose: vi.fn(),
  onUploaded: vi.fn(),
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('UploadDrawer', () => {
  it('renders the standard upload form when no prefill is supplied', () => {
    render(<UploadDrawer {...baseProps} />);
    expect(screen.getByText('Upload project')).not.toBeNull();
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
        prefilledName="My band project"
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
    // Project name field defaults to the prefilled name.
    const nameInput = screen.getByLabelText(/project name/i) as HTMLInputElement;
    expect(nameInput.value).toBe('My band project');
  });

  // Regression test for the "duplicate empty project" bug: a stale closure on
  // `files` made the post-loop "did everything finish?" check always evaluate
  // against the pre-upload state (all 'pending'), so onUploaded never fired
  // after the first click. Users would re-click the still-enabled Upload
  // button, which POSTed /api/projects again and skipped every (already-'done')
  // stem — producing a phantom empty project alongside the real one.
  describe('after a successful upload', () => {
    function setupFetchAndXhr(): {
      fetchMock: ReturnType<typeof vi.fn>;
      xhrCount: { stem: number };
    } {
      const fetchMock = vi.fn().mockImplementation(async (input: string) => {
        if (input === '/api/projects') {
          return {
            ok: true,
            status: 201,
            text: async () => '',
            json: async () => ({ project: { id: 'proj-1' } }),
          };
        }
        throw new Error(`unexpected fetch: ${input}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const xhrCount = { stem: 0 };
      class FakeXHR {
        upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        onabort: (() => void) | null = null;
        status = 0;
        responseText = '';
        withCredentials = false;
        private url = '';
        open(_method: string, url: string) {
          this.url = url;
        }
        send(_body: FormData) {
          if (this.url.startsWith('/api/projects/') && this.url.endsWith('/stems')) {
            xhrCount.stem += 1;
            this.status = 201;
            this.responseText = JSON.stringify({ stem: { id: `stem-${xhrCount.stem}` } });
            queueMicrotask(() => this.onload?.());
          } else {
            this.status = 500;
            queueMicrotask(() => this.onload?.());
          }
        }
      }
      vi.stubGlobal('XMLHttpRequest', FakeXHR);

      return { fetchMock, xhrCount };
    }

    it('fires onUploaded exactly once after the single click', async () => {
      const user = userEvent.setup();
      const { fetchMock, xhrCount } = setupFetchAndXhr();
      const onUploaded = vi.fn();
      const file = new File(
        [new Uint8Array([0])],
        'kick.wav',
        { type: 'audio/wav' },
      );

      render(
        <UploadDrawer
          {...baseProps}
          onUploaded={onUploaded}
          prefilledFiles={[file]}
          prefilledName="My project"
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Upload' }));

      await waitFor(() => expect(onUploaded).toHaveBeenCalledOnce());
      expect(onUploaded).toHaveBeenCalledWith('proj-1');

      // POST /api/projects should have happened exactly once — not once per
      // file, not once per click.
      const projectPosts = fetchMock.mock.calls.filter(
        ([url]) => url === '/api/projects',
      );
      expect(projectPosts).toHaveLength(1);
      // One stem upload for one file.
      expect(xhrCount.stem).toBe(1);
    });

    it('hides the Upload button so a re-click cannot create an empty duplicate project', async () => {
      const user = userEvent.setup();
      setupFetchAndXhr();
      const file = new File(
        [new Uint8Array([0])],
        'kick.wav',
        { type: 'audio/wav' },
      );

      render(
        <UploadDrawer
          {...baseProps}
          prefilledFiles={[file]}
          prefilledName="My project"
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Upload' }));

      // Once every stem is 'done', the Upload button is gone — the only
      // footer action left is "Close". This is defense in depth: even if
      // some future refactor breaks the onUploaded-on-success contract, an
      // accidental re-click cannot fire a second POST /api/projects.
      await waitFor(() => expect(screen.getByText('done')).not.toBeNull());
      expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Close' })).not.toBeNull();
    });
  });
});
