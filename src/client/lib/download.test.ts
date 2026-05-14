import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LoadedStem } from '../data/types';
import { downloadStemsAsZip } from './download';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStem(overrides: Partial<LoadedStem> & { src?: string } = {}): LoadedStem {
  const audio = new Audio();
  if (overrides.src !== undefined) {
    Object.defineProperty(audio, 'src', { value: overrides.src, writable: true });
  }
  const { src: _src, ...rest } = overrides;
  return {
    name: 'stem.mp3',
    displayName: 'stem.mp3',
    color: '#888',
    audio,
    audioBuffer: null,
    userMuted: false,
    soloed: false,
    userVolume: 100,
    projectId: 'p1',
    serverId: 's1',
    gain: null,
    peaks: null,
    ...rest,
  };
}

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const FAKE_OBJECT_URL = 'blob:http://localhost/fake-uuid';

beforeEach(() => {
  // Stub fetch to return a fresh Response per call (Response body can only be
  // consumed once; reusing the same instance across calls causes "body already used").
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(new Blob(['audio-bytes'], { type: 'audio/mpeg' }), { status: 200 }),
      ),
    ),
  );

  // happy-dom does not implement URL.createObjectURL; stub it.
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn().mockReturnValue(FAKE_OBJECT_URL),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  // Real timers first in case a test enabled fake ones — the dangling 60s
  // revoke setTimeout inside download.ts is harmless once timers are real
  // (the test process exits long before 60s) but switching restores any
  // global state and clears pending fake-timer queues.
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('downloadStemsAsZip', () => {
  it('does nothing when the stems array is empty', async () => {
    await downloadStemsAsZip([], 'my-band.zip');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches each stem audio URL', async () => {
    const stems = [
      makeStem({ name: 'drums.mp3', src: '/audio/drums.mp3' }),
      makeStem({ name: 'bass.mp3', src: '/audio/bass.mp3' }),
    ];
    // Stub click so the test doesn't trigger a real navigation attempt.
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await downloadStemsAsZip(stems, 'session.zip');

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith(stems[0].audio.src);
    expect(fetch).toHaveBeenCalledWith(stems[1].audio.src);

    clickSpy.mockRestore();
  });

  it('appends, clicks, and removes the anchor without leaking it to the DOM', async () => {
    const stem = makeStem({ name: 'guitar.mp3', src: '/audio/guitar.mp3' });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await downloadStemsAsZip([stem], 'guitar.zip');

    // click was invoked exactly once
    expect(clickSpy).toHaveBeenCalledOnce();

    // No anchor remains in the DOM after the call returns
    const anchors = document.body.querySelectorAll('a[download]');
    expect(anchors.length).toBe(0);

    clickSpy.mockRestore();
  });

  it('sets the correct href and download attribute on the anchor', async () => {
    const stem = makeStem({ name: 'keys.mp3', src: '/audio/keys.mp3' });

    let capturedHref: string | undefined;
    let capturedDownload: string | undefined;

    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        capturedHref = this.href;
        capturedDownload = this.download;
      });

    await downloadStemsAsZip([stem], 'band-session.zip');

    expect(capturedHref).toContain(FAKE_OBJECT_URL);
    expect(capturedDownload).toBe('band-session.zip');

    clickSpy.mockRestore();
  });

  it('revokes the object URL ~60s after the download to free the blob', async () => {
    // Fake ONLY setTimeout so JSZip's promise-based async (which Vitest's
    // full fake-timer mode would deadlock) still runs naturally.
    vi.useFakeTimers({ toFake: ['setTimeout'] });

    const stem = makeStem({ name: 'cleanup.mp3', src: '/audio/cleanup.mp3' });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await downloadStemsAsZip([stem], 'cleanup.zip');

    // Immediately after the call, the URL must still be valid (the browser
    // may still be following the blob: URL to start the download).
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    // Advance past the scheduled revoke (60s in download.ts).
    vi.advanceTimersByTime(60_000);

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(FAKE_OBJECT_URL);

    clickSpy.mockRestore();
  });

  it('throws when a fetch returns a non-OK status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 404 })),
      ),
    );

    const stem = makeStem({ name: 'missing.mp3', src: '/audio/missing.mp3' });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await expect(downloadStemsAsZip([stem], 'fail.zip')).rejects.toThrow('HTTP 404');

    clickSpy.mockRestore();
  });
});
