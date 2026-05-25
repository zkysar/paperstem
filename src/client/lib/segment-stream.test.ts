import { describe, it, expect, vi, afterEach } from 'vitest';
import { planSegments, LEAD_IN_BYTES, fetchSegmentBytes, decodeSegment } from './segment-stream';

describe('planSegments', () => {
  it('splits a CBR file into ~segSec windows by linear byte interpolation', () => {
    // 1,000,000 bytes, 100 s, 20 s segments -> 5 segments of 200,000 bytes.
    const segs = planSegments(1_000_000, 100, 20);
    expect(segs).toHaveLength(5);
    expect(segs[0]).toMatchObject({ index: 0, byteStart: 0, byteEnd: 200_000, leadInBytes: 0 });
    expect(segs[1]).toMatchObject({ index: 1, byteStart: 200_000, byteEnd: 400_000, leadInBytes: LEAD_IN_BYTES });
    expect(segs[4].byteEnd).toBe(1_000_000); // last segment runs to EOF
  });

  it('produces a single segment when the file is shorter than one window', () => {
    const segs = planSegments(50_000, 5, 20);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ index: 0, byteStart: 0, byteEnd: 50_000, leadInBytes: 0 });
  });

  it('clamps the fetch start by lead-in but never below 0', () => {
    const segs = planSegments(1_000_000, 100, 20);
    expect(segs[1].fetchStart).toBe(200_000 - LEAD_IN_BYTES);
    expect(segs[0].fetchStart).toBe(0);
  });

  it('returns [] when totalBytes is 0', () => {
    expect(planSegments(0, 100, 20)).toEqual([]);
  });

  it('returns [] when totalSec is 0', () => {
    expect(planSegments(1000, 0, 20)).toEqual([]);
  });
});

function fakeFrames(n: number): Uint8Array {
  const out = new Uint8Array(n * 208);
  for (let k = 0; k < n; k++) {
    const i = k * 208;
    out[i] = 0xff; out[i + 1] = 0xfb; out[i + 2] = 0x50; out[i + 3] = 0x00; // 64k/44.1k frame
  }
  return out;
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchSegmentBytes', () => {
  it('sends a Range header and parses total size from Content-Range', async () => {
    const body = fakeFrames(10);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 206,
        headers: { 'content-range': 'bytes 0-2079/999999', 'content-length': '2080' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchSegmentBytes('/api/audio/x', 0, 2080);
    expect(fetchMock).toHaveBeenCalledWith('/api/audio/x', {
      credentials: 'include',
      headers: { Range: 'bytes=0-2079' },
    });
    expect(res.totalBytes).toBe(999999);
    expect(res.bytes.length).toBe(2080);
  });
});

describe('decodeSegment', () => {
  it('decodes the first segment at the native sample rate and returns the full buffer', async () => {
    const decoded = { duration: 1.0, numberOfChannels: 1, length: 44100, sampleRate: 44100 };
    const offline = { decodeAudioData: vi.fn().mockResolvedValue(decoded), createBuffer: vi.fn() };
    const Ctor = vi.fn(() => offline);
    vi.stubGlobal('OfflineAudioContext', Ctor);
    const buf = await decodeSegment(fakeFrames(5), { isFirst: true });
    expect(Ctor).toHaveBeenCalledWith(1, 1, 44100); // native rate parsed from header
    expect(offline.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(buf).toBe(decoded);
  });

  it('trims lead-in samples for a non-first segment', async () => {
    const src = { duration: 1.0, numberOfChannels: 1, length: 44100, sampleRate: 44100,
      getChannelData: () => new Float32Array(44100) };
    const trimmed = { duration: 0.75, length: 33075, numberOfChannels: 1, sampleRate: 44100,
      getChannelData: () => new Float32Array(33075) };
    const offline = { decodeAudioData: vi.fn().mockResolvedValue(src),
      createBuffer: vi.fn().mockReturnValue(trimmed) };
    vi.stubGlobal('OfflineAudioContext', vi.fn(() => offline));
    const buf = await decodeSegment(fakeFrames(20), { isFirst: false, leadInSec: 0.25 });
    // drop = round(0.25*44100)=11025; keep = 44100-11025 = 33075
    expect(offline.createBuffer).toHaveBeenCalledWith(1, 33075, 44100);
    expect(buf).toBe(trimmed);
  });
});
