// Browser-side orchestrator for auto-classification.
//
// When the user picks a folder of stems, this hook:
//   1. Mixes the loaded stems into a single mono full-mix Blob.
//   2. Runs Stage 1 (YAMNet + chroma) on that Blob via runStage1.
//   3. Holds the resulting ClassifiedSegment[] + audio_hash in state until
//      the user clicks Save. The "fresh" sections render in the section
//      lane via a synthetic preview list (so the UX matches Flow C in the
//      mockup — sections appear before any upload).
//   4. On commit(projectId), POSTs to /api/projects/:id/classify and
//      returns the server's persisted sections.
//   5. cancel() flips a flag that downstream awaits poll, and any
//      in-flight progress is discarded — Save during detection means
//      "skip and save without auto-sections" per the design.
//
// Failure modes are best-effort: model load errors, OOM, decode failures
// log to the console and resolve the hook state to `idle` so the Save
// path is never blocked.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClassifiedSegment, Section } from '../../shared/types';
import { runStage1, type Stage1Result } from '../lib/auto-classify/classify';
import { CLASSIFIER_VERSION } from '../lib/auto-classify/mediapipe-yamnet';
import { FINGERPRINT_VERSION } from '../lib/auto-classify/chroma';
import { postClassify, type ClassifyResponseSection } from '../data/classify-repo';
import type { LoadedStem } from '../data/types';

export type AutoClassifyPhase =
  | 'idle'
  | 'running'
  | 'ready'
  | 'failed'
  // Terminal phase entered when the user clicks Save mid-detection. Stays
  // sticky so the effect doesn't immediately re-run another Stage 1 pass.
  | 'cancelled';

export type AutoClassifyState = {
  phase: AutoClassifyPhase;
  progress: number;
  // Preview sections derived from the Stage 1 segments — rendered in the
  // section lane during draft mode before the user clicks Save. These have
  // synthetic `preview:<i>` ids and `source: 'auto'` so the lane component
  // applies the "fresh" treatment.
  previewSections: Section[];
  // The raw Stage 1 result; null while running/idle, populated on success
  // so commit() can re-use the same audio_hash and segments without a
  // re-run.
  stage1: Stage1Result | null;
  errorMessage: string | null;
};

export type UseAutoClassifyOptions = {
  // When true, kick off classification on the next stems-loaded transition.
  enabled: boolean;
  // The loaded stems from the player. Each LoadedStem may carry an
  // `audioBuffer` (Web Audio decoded PCM); we mix the buffers offline to
  // synthesize a single full-mix Blob.
  stems: LoadedStem[];
  // True while the player is still decoding. We wait until decode finishes
  // before starting Stage 1 so we have the AudioBuffers in hand.
  loading: boolean;
};

export type AutoClassifyControls = {
  state: AutoClassifyState;
  // Called when the user clicks Save mid-detection. Discards everything.
  cancel(): void;
  // Called after the project is saved server-side. POSTs the stage-1
  // segments and returns the server-persisted sections. Returns null if
  // nothing to commit (cancelled, failed, or no segments emitted).
  commit(projectId: string): Promise<ClassifyResponseSection[] | null>;
  // Look up the chroma blob for a given section (by start_ms+end_ms match
  // against the underlying segment). Used by SectionPopover to upload a
  // fingerprint when the user renames an auto section onto a song.
  chromaForSection(section: Section): number[][] | null;
  // Reset the hook to idle — called when leaving draft mode (e.g. after
  // selecting a server-saved project) so a stale "ready" state doesn't
  // bleed across project switches.
  reset(): void;
};

// Compose the LoadedStems' audioBuffers into a single mono Float32 array
// rendered through an OfflineAudioContext, then wrap it as a 16-bit PCM WAV
// Blob. The Blob is what `runStage1` decodes back through Web Audio — going
// through an actual audio container ensures the same decode path the rest of
// the app uses.
async function mixStemsToBlob(stems: LoadedStem[]): Promise<Blob | null> {
  const buffers = stems
    .map((s) => s.audioBuffer)
    .filter((b): b is AudioBuffer => b !== null);
  if (buffers.length === 0) return null;
  const sampleRate = buffers[0].sampleRate;
  const lengthSamples = Math.max(...buffers.map((b) => b.length));
  const w = globalThis as unknown as {
    OfflineAudioContext?: new (
      channels: number,
      length: number,
      rate: number,
    ) => OfflineAudioContext;
    webkitOfflineAudioContext?: new (
      channels: number,
      length: number,
      rate: number,
    ) => OfflineAudioContext;
  };
  const OCtor = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
  if (!OCtor) throw new Error('mixStemsToBlob: OfflineAudioContext not available');
  // Render mono — YAMNet only needs mono input and downstream chroma reads
  // mono PCM too. Sum stems by routing each through the context's
  // destination.
  const ctx = new OCtor(1, lengthSamples, sampleRate);
  for (const buf of buffers) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  }
  const rendered = await ctx.startRendering();
  return audioBufferToWavBlob(rendered);
}

// Encode an AudioBuffer's mono channel to a 16-bit PCM WAV Blob. WAV is the
// simplest universally-decoded container in the browser; the encoding cost
// for a 5-minute mix is a few ms.
function audioBufferToWavBlob(buf: AudioBuffer): Blob {
  const sampleRate = buf.sampleRate;
  const samples = buf.getChannelData(0);
  const numSamples = samples.length;
  const bytesPerSample = 2;
  const blockAlign = 1 * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  let offset = 0;
  function writeString(s: string): void {
    for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i));
  }
  writeString('RIFF');
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;
  writeString('WAVE');
  writeString('fmt ');
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true); // PCM
  offset += 2;
  view.setUint16(offset, 1, true); // mono
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, byteRate, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, 16, true); // bitsPerSample
  offset += 2;
  writeString('data');
  view.setUint32(offset, dataSize, true);
  offset += 4;
  // Convert float32 [-1,1] → int16 with simple clamping.
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

// Convert a Stage1 ClassifiedSegment into a synthetic Section the section
// lane can render. Mirrors the server's `nameForSegment` rules so the user
// sees the same names before Save as after Save.
function segmentToPreviewSection(
  seg: ClassifiedSegment,
  i: number,
): Section | null {
  // Skip silence and unknown — they aren't useful section cards (matches the
  // server's `shouldEmitSection` filter).
  if (seg.segment_type === 'silence' || seg.segment_type === 'unknown') return null;
  let label: string | null;
  switch (seg.segment_type) {
    case 'music':
      label = 'Music';
      break;
    case 'chatter':
      label = 'Chatter';
      break;
    case 'tuning':
      label = 'Tuning';
      break;
    case 'count_in':
      label = 'Count-in';
      break;
    default:
      label = null;
  }
  return {
    id: `preview:${i}`,
    project_id: 'draft',
    start_ms: seg.start_ms,
    song_id: null,
    song_name: null,
    label,
    source: 'auto',
    created_at: 0,
    updated_at: 0,
    confidence: null,
    segment_type: seg.segment_type,
    tentative: false,
    run_id: null,
  };
}

export function useAutoClassify(opts: UseAutoClassifyOptions): AutoClassifyControls {
  const [state, setState] = useState<AutoClassifyState>({
    phase: 'idle',
    progress: 0,
    previewSections: [],
    stage1: null,
    errorMessage: null,
  });

  // Cancel flag the orchestrator polls between phases; bumping the ref's
  // value mid-run causes the post-await checks to early-return without
  // writing state.
  const cancelledRef = useRef(false);
  // Generation token so a fast re-run (rare) doesn't write old results
  // into state after a newer run started.
  const genRef = useRef(0);
  // Map from segment_index → chroma blob, so commit() and the popover can
  // look up fingerprints for music segments.
  const chromaByStartRef = useRef<Map<number, number[][]>>(new Map());
  // After commit() writes server-persisted sections, we remember the
  // mapping from server section id → its start_ms so chromaForSection()
  // can look up the chroma even when called against the persisted Section
  // (which lacks the preview id).
  const chromaByServerIdRef = useRef<Map<string, number[][]>>(new Map());

  const reset = useCallback(() => {
    genRef.current += 1;
    cancelledRef.current = true;
    chromaByStartRef.current = new Map();
    chromaByServerIdRef.current = new Map();
    setState({
      phase: 'idle',
      progress: 0,
      previewSections: [],
      stage1: null,
      errorMessage: null,
    });
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setState((s) => (s.phase === 'running' ? { ...s, phase: 'cancelled' } : s));
  }, []);

  // Kick off classification once when enabled flips true with stems loaded.
  // useEffect deps are intentionally narrow — we only re-run when the
  // `enabled` gate flips or when the stem count crosses 0 with `enabled` set.
  const stemCount = opts.stems.length;
  const allDecoded =
    stemCount > 0 && opts.stems.every((s) => s.audioBuffer !== null);
  const loading = opts.loading;

  useEffect(() => {
    if (!opts.enabled) return;
    if (loading) return;
    if (!allDecoded) return;
    if (state.phase !== 'idle') return;

    const gen = ++genRef.current;
    cancelledRef.current = false;
    chromaByStartRef.current = new Map();
    setState((s) => ({ ...s, phase: 'running', progress: 0, errorMessage: null }));

    (async () => {
      try {
        const blob = await mixStemsToBlob(opts.stems);
        if (cancelledRef.current || gen !== genRef.current) return;
        if (!blob) {
          setState((s) =>
            gen !== genRef.current
              ? s
              : { ...s, phase: 'idle', progress: 0 },
          );
          return;
        }
        const result = await runStage1(blob, {
          onProgress: (p) => {
            if (gen !== genRef.current || cancelledRef.current) return;
            setState((s) =>
              gen !== genRef.current ? s : { ...s, progress: p },
            );
          },
        });
        if (cancelledRef.current || gen !== genRef.current) return;
        // Index chroma by start_ms for the popover/commit lookup.
        const map = new Map<number, number[][]>();
        for (const seg of result.segments) {
          if (seg.chroma) map.set(seg.start_ms, seg.chroma);
        }
        chromaByStartRef.current = map;
        const previews = result.segments
          .map(segmentToPreviewSection)
          .filter((s): s is Section => s !== null);
        setState({
          phase: 'ready',
          progress: 1,
          previewSections: previews,
          stage1: result,
          errorMessage: null,
        });
      } catch (err) {
        if (gen !== genRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error('auto-classify failed', err);
        setState({
          phase: 'failed',
          progress: 0,
          previewSections: [],
          stage1: null,
          errorMessage: msg,
        });
      }
    })();
  }, [opts.enabled, opts.stems, loading, allDecoded, state.phase]);

  // When enabled flips off (user navigated to a saved project, etc.), reset.
  useEffect(() => {
    if (opts.enabled) return;
    // Only nudge a reset when we have stale state to clear; idle stays idle.
    if (state.phase === 'idle') return;
    reset();
  }, [opts.enabled, state.phase, reset]);

  const commit = useCallback(
    async (projectId: string): Promise<ClassifyResponseSection[] | null> => {
      const s = state;
      if (s.phase !== 'ready' || !s.stage1) return null;
      if (s.stage1.segments.length === 0) return null;
      try {
        const resp = await postClassify(projectId, {
          segments: s.stage1.segments,
          audio_hash: s.stage1.audio_hash,
          classifier_version: CLASSIFIER_VERSION,
          fingerprint_version: FINGERPRINT_VERSION,
          source_surface: 'web',
        });
        // Translate the preview chroma map into a server-id-keyed one so
        // the popover can look up fingerprints by section id later.
        const next = new Map<string, number[][]>();
        for (const ssec of resp.sections) {
          const chroma = chromaByStartRef.current.get(ssec.start_ms);
          if (chroma) next.set(ssec.id, chroma);
        }
        chromaByServerIdRef.current = next;
        return resp.sections;
      } catch (err) {
        console.error('classify POST failed', err);
        return null;
      }
    },
    [state],
  );

  const chromaForSection = useCallback((section: Section): number[][] | null => {
    return (
      chromaByServerIdRef.current.get(section.id) ??
      chromaByStartRef.current.get(section.start_ms) ??
      null
    );
  }, []);

  return { state, cancel, commit, chromaForSection, reset };
}
