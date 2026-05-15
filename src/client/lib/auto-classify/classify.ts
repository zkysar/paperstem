// Browser orchestrator for Stage 1 of auto-classification.
//
// Takes an audio Blob (e.g. a project's full-mix file), decodes it into PCM
// via OfflineAudioContext, runs YAMNet, smooths the per-window predictions
// into segments, and extracts chroma fingerprints for each `music` segment.
// Returns ClassifiedSegment[] ready to POST to /api/projects/:id/classify.
import type { ClassifiedSegment } from '../../../shared/types';
import { mapTopClassesToSegmentType } from './audioset-mapping';
import { smoothAndSegment } from './smooth';
import {
  CHROMA_SAMPLE_RATE,
  extractChromaSequence,
} from './chroma';
import {
  loadYamnetForBrowser,
  YAMNET_HOP_MS,
  YAMNET_SAMPLE_RATE,
  type YamnetClassifier,
} from './mediapipe-yamnet';

export type Stage1Progress = (p: number) => void;

export type Stage1Options = {
  onProgress?: Stage1Progress;
  /** Override the YAMNet loader — useful for tests. */
  loadYamnet?: () => Promise<YamnetClassifier>;
};

/**
 * Decode an audio Blob into a mono Float32Array at the requested sample rate.
 * Uses OfflineAudioContext so the decode does not require a live audio device
 * and runs faster than realtime in modern browsers.
 */
async function decodeAudioToPcm(
  blob: Blob,
  sampleRate: number,
): Promise<Float32Array> {
  const arrayBuf = await blob.arrayBuffer();
  // Decode at the file's native rate first, then resample by rendering through
  // an OfflineAudioContext set to the target rate.
  type AudioContextCtor = new (...args: unknown[]) => AudioContext;
  type OfflineAudioContextCtor = new (
    channels: number,
    length: number,
    rate: number,
  ) => OfflineAudioContext;
  const w = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
    OfflineAudioContext?: OfflineAudioContextCtor;
    webkitOfflineAudioContext?: OfflineAudioContextCtor;
  };
  const ACtor = w.AudioContext ?? w.webkitAudioContext;
  const OCtor = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
  if (!ACtor || !OCtor) {
    throw new Error(
      'decodeAudioToPcm: Web Audio API not available in this environment',
    );
  }
  const decodeCtx = new ACtor();
  try {
    const decoded: AudioBuffer = await decodeCtx.decodeAudioData(
      arrayBuf.slice(0),
    );
    const durationSec = decoded.duration;
    const renderCtx = new OCtor(
      1,
      Math.ceil(durationSec * sampleRate),
      sampleRate,
    );
    const src = renderCtx.createBufferSource();
    src.buffer = decoded;
    src.connect(renderCtx.destination);
    src.start(0);
    const rendered = await renderCtx.startRendering();
    return rendered.getChannelData(0).slice();
  } finally {
    if (typeof decodeCtx.close === 'function') decodeCtx.close();
  }
}

/**
 * Compute a sha256 content hash of the audio Blob's bytes, hex-encoded.
 * Mirrors the server's expectation that the hash is content-based (per the
 * schema's `audio_hash` column).
 */
async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export type Stage1Result = {
  segments: ClassifiedSegment[];
  audio_hash: string;
  duration_ms: number;
};

/**
 * Run the full Stage 1 pipeline on an audio Blob. Reports progress in [0, 1]
 * via the optional `onProgress` callback at four checkpoints: decode (0.2),
 * YAMNet (0.6), smoothing (0.7), chroma (1.0).
 */
export async function runStage1(
  audio: Blob,
  opts: Stage1Options = {},
): Promise<Stage1Result> {
  const report = (p: number) => opts.onProgress?.(Math.min(1, Math.max(0, p)));
  report(0);

  const [hash, audio16k] = await Promise.all([
    sha256Hex(audio),
    decodeAudioToPcm(audio, YAMNET_SAMPLE_RATE),
  ]);
  report(0.2);

  const load = opts.loadYamnet ?? loadYamnetForBrowser;
  const yamnet = await load();
  let topPerWindow: import('../../../shared/types').TopClass[][];
  try {
    topPerWindow = yamnet.classify(audio16k);
  } finally {
    yamnet.close();
  }
  report(0.6);

  const classesPerWindow = topPerWindow.map(mapTopClassesToSegmentType);
  const segments = smoothAndSegment(
    classesPerWindow,
    topPerWindow,
    YAMNET_HOP_MS,
  );
  report(0.7);

  if (segments.some((s) => s.segment_type === 'music')) {
    const audio22k = await decodeAudioToPcm(audio, CHROMA_SAMPLE_RATE);
    const samplesPerMs = CHROMA_SAMPLE_RATE / 1000;
    const musicSegments = segments.filter((s) => s.segment_type === 'music');
    let done = 0;
    for (const seg of musicSegments) {
      const startSample = Math.floor(seg.start_ms * samplesPerMs);
      const endSample = Math.min(
        audio22k.length,
        Math.floor(seg.end_ms * samplesPerMs),
      );
      seg.chroma = extractChromaSequence(
        audio22k.subarray(startSample, endSample),
        CHROMA_SAMPLE_RATE,
      );
      done += 1;
      report(0.7 + (0.3 * done) / musicSegments.length);
    }
  }
  report(1);

  return {
    segments,
    audio_hash: hash,
    duration_ms: Math.round((audio16k.length / YAMNET_SAMPLE_RATE) * 1000),
  };
}
