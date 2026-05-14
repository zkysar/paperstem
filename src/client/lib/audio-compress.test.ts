import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock lamejs — the real encoder requires a native binary and does not run in
// happy-dom. Mp3Encoder is called with `new`, so the mock must be a class.
// ---------------------------------------------------------------------------
vi.mock('@breezystack/lamejs', () => {
  class MockMp3Encoder {
    encodeBuffer(_left: Int16Array, _right?: Int16Array): Int8Array {
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

  it('encodes stereo audio with both channel buffers', async () => {
    const ch0 = new Float32Array(1152).fill(0.5);
    const ch1 = new Float32Array(1152).fill(-0.5);
    const audioBuffer = {
      numberOfChannels: 2,
      sampleRate: 44100,
      length: 1152,
      getChannelData: vi.fn((ch: number) => (ch === 0 ? ch0 : ch1)),
    } as unknown as AudioBuffer;
    vi.stubGlobal('AudioContext', makeAudioContext(audioBuffer));

    await compressToMp3(makeFile('stereo.wav'));

    expect(audioBuffer.getChannelData).toHaveBeenCalledWith(0);
    expect(audioBuffer.getChannelData).toHaveBeenCalledWith(1);
  });

  it('produces a non-empty output file', async () => {
    const audioBuffer = makeAudioBuffer({ numberOfChannels: 1, sampleRate: 44100, length: 2304 });
    vi.stubGlobal('AudioContext', makeAudioContext(audioBuffer));

    const result = await compressToMp3(makeFile('sample.wav'));
    expect(result.size).toBeGreaterThan(0);
  });
});
