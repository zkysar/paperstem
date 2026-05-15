// Browser-side YAMNet wrapper, backed by @mediapipe/tasks-audio.
//
// The model file `yamnet.tflite` is served from the Paperstem origin at
// `/yamnet.tflite` (committed under `public/`). MediaPipe's wasm bundle ships
// with the npm package and is loaded via FilesetResolver — no external CDN.
//
// This module is browser-only (uses `fetch` and MediaPipe's wasm). The CLI
// path uses the Python sidecar under `bin/auto-classify/`.
import {
  AudioClassifier,
  FilesetResolver,
  type AudioClassifierResult,
} from '@mediapipe/tasks-audio';
import type { TopClass } from '../../../shared/types';

export const YAMNET_SAMPLE_RATE = 16000;
// YAMNet emits a window every 0.48s in MediaPipe's default packing (0.96s
// window with 50% overlap), so each classification result is ~480ms apart.
export const YAMNET_HOP_MS = 480;
export const YAMNET_WINDOW_MS = 960;
export const YAMNET_TOP_K = 5;
export const CLASSIFIER_VERSION = 'yamnet-v1';

const MODEL_PATH = '/yamnet.tflite';

// MediaPipe locates its wasm assets via FilesetResolver.forAudioTasks; given
// no override, it falls back to a JSDelivr URL. We host the wasm ourselves
// under /mediapipe/tasks-audio/wasm/ to avoid a third-party request. The
// browser orchestrator copies the relevant files at build time; in dev, the
// vite config serves them straight out of node_modules. If you change this
// path, update the matching build copy step too.
const WASM_BASE_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio/wasm';

export type YamnetClassifier = {
  /** Classify a mono Float32Array of audio (must be ${YAMNET_SAMPLE_RATE}Hz).
   * Returns one TopClass[] per output window. */
  classify(audio: Float32Array): TopClass[][];
  close(): void;
};

let cachedResolverPromise: Promise<Awaited<
  ReturnType<typeof FilesetResolver.forAudioTasks>
>> | null = null;

function getFilesetResolver() {
  if (!cachedResolverPromise) {
    cachedResolverPromise = FilesetResolver.forAudioTasks(WASM_BASE_PATH);
  }
  return cachedResolverPromise;
}

function topKFromResult(
  result: AudioClassifierResult,
  k: number,
): TopClass[] {
  const heads = result.classifications;
  if (!heads || heads.length === 0) return [];
  // YAMNet has a single classification head.
  const cats = heads[0].categories ?? [];
  return cats.slice(0, k).map((c) => ({
    name: c.categoryName,
    score: c.score,
  }));
}

/**
 * Load the YAMNet AudioClassifier and return a thin wrapper exposing a
 * synchronous classify call.
 */
export async function loadYamnetForBrowser(): Promise<YamnetClassifier> {
  const fileset = await getFilesetResolver();
  const classifier = await AudioClassifier.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_PATH },
    maxResults: YAMNET_TOP_K,
    scoreThreshold: 0,
  });
  return {
    classify(audio: Float32Array): TopClass[][] {
      const results = classifier.classify(audio, YAMNET_SAMPLE_RATE);
      return results.map((r) => topKFromResult(r, YAMNET_TOP_K));
    },
    close() {
      classifier.close();
    },
  };
}
