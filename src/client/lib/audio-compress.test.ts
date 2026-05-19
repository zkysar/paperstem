import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock lamejs — the real encoder requires a native binary and does not run in
// happy-dom. Mp3Encoder is called with `new`, so the mock must be a class.
// `encoderCalls` and `encodeBufferCalls` capture constructor and frame-level
// args so tests can assert encoder configuration and the bytes seen by it.
// ---------------------------------------------------------------------------
const { encoderCalls, encodeBufferCalls } = vi.hoisted(() => ({
  encoderCalls: [] as Array<{ channels: number; sampleRate: number; kbps: number }>,
  encodeBufferCalls: [] as Array<{ left: Int16Array; right?: Int16Array }>,
}));

vi.mock('@breezystack/lamejs', () => {
  class MockMp3Encoder {
    constructor(channels: number, sampleRate: number, kbps: number) {
      encoderCalls.push({ channels, sampleRate, kbps });
    }
    encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array {
      encodeBufferCalls.push({ left, right });
      return new Int8Array([1, 2, 3]);
    }
    flush(): Int8Array {
      return new Int8Array([4, 5]);
    }
  }

  return {
    default: { Mp3Encoder: MockMp3Encoder },
  };
});

// ---------------------------------------------------------------------------
// Stub AudioContext — happy-dom does not ship a Web Audio implementation.
// ---------------------------------------------------------------------------

function makeAudioBuffer(opts: {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
}): AudioBuffer {
  const channelData = new Float32Array(opts.length).fill(0.5);
  return {
    numberOfChannels: opts.numberOfChannels,
    sampleRate: opts.sampleRate,
    length: opts.length,
    duration: opts.length / opts.sampleRate,
    getChannelData: vi.fn().mockReturnValue(channelData),
  } as unknown as AudioBuffer;
}

function makeAudioContext(audioBuffer: AudioBuffer): typeof AudioContext {
  // Must use a real class so `new AudioCtx()` works without the "not a constructor" warning.
  class FakeAudioContext {
    decodeAudioData = vi.fn().mockResolvedValue(audioBuffer);
    close = vi.fn().mockResolvedValue(undefined);
  }
  return FakeAudioContext as unknown as typeof AudioContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('compressToMp3', () => {
  let compressToMp3: typeof import('./audio-compress').compressToMp3;

  beforeEach(async () => {
    encoderCalls.length = 0;
    encodeBufferCalls.length = 0;
    vi.resetModules();
    const mod = await import('./audio-compress.js');
    compressToMp3 = mod.compressToMp3;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeFile(name: string, content: string = 'audio-data'): File {
    return new File([content], name, { type: 'audio/wav' });
  }

  it('returns a File with audio/mpeg type', async () => {
    const audioBuffer = makeAudioBuffer({ numberOfChannels: 1, sampleRate: 44100, length: 1152 });
    vi.stubGlobal('AudioContext', makeAudioContext(audioBuffer));

    const file = makeFile('recording.wav');
    const result = await compressToMp3(file);

    expect(result).toBeInstanceOf(File);
    expect(result.type).toBe('audio/mpeg');
  });

  it('renames the output file to .mp3', async () => {
    const audioBuffer = makeAudioBuffer({ numberOfChannels: 1, sampleRate: 44100, length: 1152 });
    vi.stubGlobal('AudioContext', makeAudioContext(audioBuffer));

    const result = await compressToMp3(makeFile('session.wav'));
    expect(result.name).toBe('session.mp3');
  });

  it('strips a double-dotted extension correctly', async () => {
    const audioBuffer = makeAudioBuffer({ numberOfChannels: 1, sampleRate: 44100, length: 1152 });
    vi.stubGlobal('AudioContext', makeAudioContext(audioBuffer));

    const result = await compressToMp3(makeFile('take.01.wav'));
    expect(result.name).toBe('take.01.mp3');
  });

  it('calls onProgress with 1 when encoding completes', async () => {
    const audioBuffer = makeAudioBuffer({ numberOfChannels: 1, sampleRate: 44100, length: 1152 });
    vi.stubGlobal('AudioContext', makeAudioContext(audioBuffer));

    const onProgress = vi.fn();
    await compressToMp3(makeFile('mono.wav'), onProgress);

    // Last call must be onProgress(1)
    const calls = onProgress.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1][0]).toBe(1);
  });

  it('encodes mono audio with a single channel buffer', async () => {
    const audioBuffer = makeAudioBuffer({ numberOfChannels: 1, sampleRate: 44100, length: 1152 });
    const ctx = makeAudioContext(audioBuffer);
    vi.stubGlobal('AudioContext', ctx);

    await compressToMp3(makeFile('mono.wav'));

    // getChannelData must have been called only for channel 0 (mono)
    expect(audioBuffer.getChannelData).toHaveBeenCalledWith(0);
    expect(audioBuffer.getChannelData).not.toHaveBeenCalledWith(1);
  });

  it('constructs the encoder as mono at 64 kbps', async () => {
    const audioBuffer = makeAudioBuffer({ numberOfChannels: 2, sampleRate: 48000, length: 1152 });
    vi.stubGlobal('AudioContext', makeAudioContext(audioBuffer));

    await compressToMp3(makeFile('stem.wav'));

    expect(encoderCalls).toHaveLength(1);
    expect(encoderCalls[0]).toEqual({ channels: 1, sampleRate: 48000, kbps: 64 });
  });

  it('downmixes stereo input by averaging channels', async () => {
    const ch0 = new Float32Array(1152).fill(0.5);
    const ch1 = new Float32Array(1152).fill(-0.5);
    const audioBuffer = {
      numberOfChannels: 2,
      sampleRate: 44100,
      length: 1152,
      getChannelData: vi.fn((ch: number) => (ch === 0 ? ch0 : ch1)),
    } as unknown as AudioBuffer;
    vi.stubGlobal('AudioContext', makeAudioContext(audioBuffer));

    const result = await compressToMp3(makeFile('stereo.wav'));

    expect(audioBuffer.getChannelData).toHaveBeenCalledWith(0);
    expect(audioBuffer.getChannelData).toHaveBeenCalledWith(1);
    expect(result.type).toBe('audio/mpeg');
    // Averaging +0.5 and -0.5 collapses to 0 — every sample handed to the
    // encoder must be 0 (left), and no right channel must be supplied since
    // we're encoding mono.
    expect(encodeBufferCalls.length).toBeGreaterThan(0);
    for (const call of encodeBufferCalls) {
      expect(call.right).toBeUndefined();
      for (let i = 0; i < call.left.length; i++) {
        expect(call.left[i]).toBe(0);
      }
    }
  });

  it('produces a non-empty output file', async () => {
    const audioBuffer = makeAudioBuffer({ numberOfChannels: 1, sampleRate: 44100, length: 2304 });
    vi.stubGlobal('AudioContext', makeAudioContext(audioBuffer));

    const result = await compressToMp3(makeFile('sample.wav'));
    expect(result.size).toBeGreaterThan(0);
  });
});
