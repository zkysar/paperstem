import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WaveformThumb } from './WaveformThumb';
import { saveCachedPeaks } from '../lib/peaks';

type IOEntry = { isIntersecting: boolean };
type IOCallback = (entries: IOEntry[]) => void;

let observers: Array<{ cb: IOCallback; disconnect: () => void; observe: () => void }>;

function fireVisible() {
  for (const o of observers) o.cb([{ isIntersecting: true }]);
}

function installIntersectionObserver() {
  observers = [];
  class FakeIO {
    cb: IOCallback;
    constructor(cb: IOCallback) {
      this.cb = cb;
      observers.push({ cb, disconnect: this.disconnect, observe: this.observe });
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as unknown as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
    FakeIO as unknown as typeof IntersectionObserver;
}

function installAudioContext() {
  class FakeAudioContext {
    decodeAudioData(_buf: ArrayBuffer): Promise<AudioBuffer> {
      const samples = Float32Array.from(new Array(1024).fill(0.5));
      return Promise.resolve({
        numberOfChannels: 1,
        sampleRate: 44100,
        length: samples.length,
        duration: samples.length / 44100,
        getChannelData() {
          return samples;
        },
      } as unknown as AudioBuffer);
    }
    close() {
      return Promise.resolve();
    }
  }
  (window as unknown as { AudioContext: typeof AudioContext }).AudioContext =
    FakeAudioContext as unknown as typeof AudioContext;
}

describe('WaveformThumb', () => {
  beforeEach(() => {
    localStorage.clear();
    installIntersectionObserver();
    installAudioContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the placeholder span before becoming visible', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ArrayBuffer(8)));
    render(<WaveformThumb stemId="stem-a" />);
    expect(screen.queryByTestId('fp-waveform')).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not fetch when stemId is null', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new ArrayBuffer(8)),
    );
    render(<WaveformThumb stemId={null} />);
    await act(async () => {
      fireVisible();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('renders a canvas synchronously when peaks are cached', () => {
    saveCachedPeaks('stem-cached', [0.1, 0.5, 1.0]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new ArrayBuffer(8)),
    );
    render(<WaveformThumb stemId="stem-cached" />);
    expect(screen.getByTestId('fp-waveform')).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to placeholder on a non-OK fetch response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('forbidden', { status: 403 }),
    );
    render(<WaveformThumb stemId="stem-403" />);
    await act(async () => {
      fireVisible();
    });
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
    // Even after fetch settles, no canvas should appear.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('fp-waveform')).toBeNull();
  });

  it('aborts the in-flight fetch when unmounted', async () => {
    let capturedSignal: AbortSignal | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedSignal = init?.signal ?? null;
        return new Promise(() => {
          // never resolves; we want the unmount path to abort it
        });
      },
    );
    const { unmount } = render(<WaveformThumb stemId="stem-unmount" />);
    await act(async () => {
      fireVisible();
    });
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
    unmount();
    expect(capturedSignal).not.toBeNull();
    expect(capturedSignal!.aborted).toBe(true);
  });
});
