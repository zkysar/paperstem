// Unit tests for the auto-classify orchestrator hook. The hook composes
// three external pieces — runStage1 (browser Stage 1), postClassify (API
// upload), and Web Audio's OfflineAudioContext — all of which are mocked
// at the module boundary so the tests stay pure and fast.
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runStage1Mock = vi.fn();
const postClassifyMock = vi.fn();

vi.mock('../lib/auto-classify/classify', () => ({
  runStage1: (...args: unknown[]) => runStage1Mock(...args),
}));
vi.mock('../data/classify-repo', () => ({
  postClassify: (...args: unknown[]) => postClassifyMock(...args),
  // postSectionFingerprint is not used by useAutoClassify itself; the App
  // wires it directly. Provide a stub anyway so the module export shape
  // matches.
  postSectionFingerprint: vi.fn(),
}));

import { useAutoClassify } from './useAutoClassify';
import type { LoadedStem } from '../data/types';

// Bare-minimum AudioBuffer stub that satisfies the bits the hook touches.
function fakeAudioBuffer(durationSec: number): AudioBuffer {
  const sampleRate = 48000;
  const length = Math.floor(durationSec * sampleRate);
  return {
    sampleRate,
    length,
    duration: durationSec,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(length),
    copyFromChannel: () => {},
    copyToChannel: () => {},
  } as unknown as AudioBuffer;
}

// Stub LoadedStem matching only the shape `mixStemsToBlob` reads.
function fakeStem(buf: AudioBuffer | null): LoadedStem {
  return {
    name: 'stem.wav',
    displayName: 'stem',
    src: 'blob:fake',
    audio: { duration: 1 } as unknown as HTMLAudioElement,
    audioBuffer: buf,
  } as unknown as LoadedStem;
}

// Replace OfflineAudioContext on globalThis with a minimal stub that
// returns a rendered AudioBuffer of zeros — the hook only feeds the
// rendered buffer into the WAV encoder, so a zero-filled buffer is fine.
class FakeOfflineAudioContext {
  destination = {} as AudioDestinationNode;
  private channels: number;
  private length: number;
  private rate: number;
  constructor(channels: number, length: number, rate: number) {
    this.channels = channels;
    this.length = length;
    this.rate = rate;
  }
  createBufferSource() {
    return { buffer: null, connect: () => {}, start: () => {} };
  }
  async startRendering(): Promise<AudioBuffer> {
    return fakeAudioBuffer(this.length / this.rate);
  }
}

beforeEach(() => {
  runStage1Mock.mockReset();
  postClassifyMock.mockReset();
  (globalThis as unknown as { OfflineAudioContext: typeof FakeOfflineAudioContext }).OfflineAudioContext =
    FakeOfflineAudioContext;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useAutoClassify', () => {
  it('stays idle when disabled', async () => {
    const { result } = renderHook(() =>
      useAutoClassify({ enabled: false, stems: [fakeStem(fakeAudioBuffer(1))], loading: false }),
    );
    expect(result.current.state.phase).toBe('idle');
    expect(runStage1Mock).not.toHaveBeenCalled();
  });

  it('does not start while the player is still loading', async () => {
    const { result } = renderHook(() =>
      useAutoClassify({ enabled: true, stems: [fakeStem(fakeAudioBuffer(1))], loading: true }),
    );
    expect(result.current.state.phase).toBe('idle');
    expect(runStage1Mock).not.toHaveBeenCalled();
  });

  it('runs Stage 1 when stems are decoded and produces preview sections', async () => {
    runStage1Mock.mockResolvedValue({
      segments: [
        {
          start_ms: 0,
          end_ms: 5000,
          segment_type: 'chatter',
          top_classes: [],
        },
        {
          start_ms: 5000,
          end_ms: 30000,
          segment_type: 'music',
          top_classes: [],
          chroma: [
            [0.1, 0.2, 0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          ],
        },
        {
          start_ms: 30000,
          end_ms: 35000,
          segment_type: 'silence',
          top_classes: [],
        },
      ],
      audio_hash: 'abc123',
      duration_ms: 35000,
    });
    const { result } = renderHook(() =>
      useAutoClassify({
        enabled: true,
        stems: [fakeStem(fakeAudioBuffer(1))],
        loading: false,
      }),
    );
    await waitFor(() => expect(result.current.state.phase).toBe('ready'));
    // Silence segments are filtered out — chatter + music remain.
    expect(result.current.state.previewSections.map((s) => s.label)).toEqual([
      'Chatter',
      'Music',
    ]);
    // Preview sections carry source='auto' so the SectionLane applies the
    // fresh treatment.
    expect(
      result.current.state.previewSections.every((s) => s.source === 'auto'),
    ).toBe(true);
  });

  it('exposes the chroma blob by start_ms so the popover can upload fingerprints', async () => {
    const chroma = [[0.1, 0.2, 0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0]];
    runStage1Mock.mockResolvedValue({
      segments: [
        {
          start_ms: 5000,
          end_ms: 30000,
          segment_type: 'music',
          top_classes: [],
          chroma,
        },
      ],
      audio_hash: 'abc',
      duration_ms: 30000,
    });
    const { result } = renderHook(() =>
      useAutoClassify({
        enabled: true,
        stems: [fakeStem(fakeAudioBuffer(1))],
        loading: false,
      }),
    );
    await waitFor(() => expect(result.current.state.phase).toBe('ready'));
    const sec = result.current.state.previewSections[0];
    expect(result.current.chromaForSection(sec)).toEqual(chroma);
  });

  it('cancel() stops a running classification', async () => {
    let resolveRun!: (v: unknown) => void;
    runStage1Mock.mockImplementation(
      () => new Promise((resolve) => { resolveRun = resolve; }),
    );
    const { result } = renderHook(() =>
      useAutoClassify({
        enabled: true,
        stems: [fakeStem(fakeAudioBuffer(1))],
        loading: false,
      }),
    );
    await waitFor(() => expect(result.current.state.phase).toBe('running'));
    act(() => result.current.cancel());
    // Resolving the underlying promise after cancel must NOT flip the
    // hook to 'ready' — the cancel flag is observed in the post-await
    // checkpoint.
    resolveRun({
      segments: [
        {
          start_ms: 0,
          end_ms: 1000,
          segment_type: 'chatter',
          top_classes: [],
        },
      ],
      audio_hash: 'h',
      duration_ms: 1000,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.state.phase).toBe('cancelled');
  });

  it('commit() POSTs to /classify with the stage-1 result and CLASSIFIER_VERSION', async () => {
    runStage1Mock.mockResolvedValue({
      segments: [
        {
          start_ms: 0,
          end_ms: 10000,
          segment_type: 'chatter',
          top_classes: [],
        },
      ],
      audio_hash: 'hhh',
      duration_ms: 10000,
    });
    postClassifyMock.mockResolvedValue({
      run_id: 'run-1',
      reused: false,
      sections: [
        {
          id: 'srv-1',
          start_ms: 0,
          end_ms: 10000,
          song_id: null,
          song_name: null,
          label: 'Chatter',
          segment_type: 'chatter',
          confidence: 0,
          tentative: false,
        },
      ],
    });
    const { result } = renderHook(() =>
      useAutoClassify({
        enabled: true,
        stems: [fakeStem(fakeAudioBuffer(1))],
        loading: false,
      }),
    );
    await waitFor(() => expect(result.current.state.phase).toBe('ready'));
    let returned: unknown;
    await act(async () => {
      returned = await result.current.commit('proj-1');
    });
    expect(postClassifyMock).toHaveBeenCalledTimes(1);
    const [projectId, body] = postClassifyMock.mock.calls[0];
    expect(projectId).toBe('proj-1');
    expect(body.source_surface).toBe('web');
    expect(body.classifier_version).toBe('yamnet-v1');
    expect(body.audio_hash).toBe('hhh');
    expect(Array.isArray(returned)).toBe(true);
    expect((returned as Array<{ id: string }>).length).toBe(1);
  });

  it('commit() returns null when not in ready state', async () => {
    const { result } = renderHook(() =>
      useAutoClassify({ enabled: false, stems: [], loading: false }),
    );
    let returned: unknown;
    await act(async () => {
      returned = await result.current.commit('proj-1');
    });
    expect(returned).toBeNull();
    expect(postClassifyMock).not.toHaveBeenCalled();
  });

  it('moves to failed when runStage1 throws', async () => {
    runStage1Mock.mockRejectedValue(new Error('YAMNet did not load'));
    const { result } = renderHook(() =>
      useAutoClassify({
        enabled: true,
        stems: [fakeStem(fakeAudioBuffer(1))],
        loading: false,
      }),
    );
    await waitFor(() => expect(result.current.state.phase).toBe('failed'));
    expect(result.current.state.errorMessage).toContain('YAMNet');
  });
});
