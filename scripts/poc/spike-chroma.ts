// scripts/poc/spike-chroma.ts
//
// Compute chroma fingerprints for three hand-trimmed audio clips and report
// pairwise DTW distances. Pass criteria for the design: same-song distance
// is meaningfully smaller than cross-song distance (≥2× ratio).
//
// Usage:
//   npm run spike:chroma -- /path/same-a.wav /path/same-b.wav /path/diff.wav
//   # or
//   npx tsx spike-chroma.ts /path/same-a.wav /path/same-b.wav /path/diff.wav
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import Meyda from 'meyda';

const CHROMA_FRAME_SIZE = 4096;
const CHROMA_HOP_SIZE = 2048;
const CHROMA_SAMPLE_RATE = 22050;

function loadAudio(path: string, sampleRate: number): Float32Array {
  const buf = execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-i', path,
    '-ac', '1',
    '-ar', String(sampleRate),
    '-f', 'f32le',
    '-',
  ], { maxBuffer: 1024 * 1024 * 1024 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function chromaSequence(audio: Float32Array, sampleRate = CHROMA_SAMPLE_RATE): number[][] {
  const seq: number[][] = [];
  for (let i = 0; i + CHROMA_FRAME_SIZE <= audio.length; i += CHROMA_HOP_SIZE) {
    const frame = audio.subarray(i, i + CHROMA_FRAME_SIZE);
    const features = Meyda.extract('chroma', frame, {
      sampleRate,
      bufferSize: CHROMA_FRAME_SIZE,
    }) as number[];
    seq.push(Array.from(features));
  }
  return seq;
}

function dtwDistance(a: number[][], b: number[][]): number {
  if (a.length === 0 || b.length === 0) throw new Error('dtwDistance: empty sequence');
  const n = a.length, m = b.length, dim = a[0].length;

  const normA = new Float64Array(n);
  const normB = new Float64Array(m);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let d = 0; d < dim; d++) s += a[i][d] * a[i][d];
    normA[i] = Math.sqrt(s) || 1;
  }
  for (let j = 0; j < m; j++) {
    let s = 0;
    for (let d = 0; d < dim; d++) s += b[j][d] * b[j][d];
    normB[j] = Math.sqrt(s) || 1;
  }

  const cost = (i: number, j: number): number => {
    let dot = 0;
    for (let d = 0; d < dim; d++) dot += a[i][d] * b[j][d];
    return 1 - dot / (normA[i] * normB[j]);
  };

  let prev = new Float64Array(m + 1).fill(Infinity);
  let cur = new Float64Array(m + 1).fill(Infinity);
  prev[0] = 0;

  for (let i = 1; i <= n; i++) {
    cur[0] = Infinity;
    for (let j = 1; j <= m; j++) {
      const c = cost(i - 1, j - 1);
      cur[j] = c + Math.min(prev[j], cur[j - 1], prev[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[m] / (n + m);
}

async function main() {
  const [, , a, b, c] = process.argv;
  if (!a || !b || !c) {
    console.error('Usage: tsx spike-chroma.ts <same-a> <same-b> <diff>');
    process.exit(1);
  }
  for (const p of [a, b, c]) {
    if (!existsSync(p)) {
      console.error(`File does not exist: ${p}`);
      process.exit(1);
    }
  }

  console.log('Loading + chroma-extracting three clips...');
  const seqA = chromaSequence(loadAudio(a, CHROMA_SAMPLE_RATE));
  const seqB = chromaSequence(loadAudio(b, CHROMA_SAMPLE_RATE));
  const seqC = chromaSequence(loadAudio(c, CHROMA_SAMPLE_RATE));
  console.log(`  ${a}: ${seqA.length} frames`);
  console.log(`  ${b}: ${seqB.length} frames`);
  console.log(`  ${c}: ${seqC.length} frames`);

  console.log('\nComputing DTW distances...');
  const ab = dtwDistance(seqA, seqB);
  const ac = dtwDistance(seqA, seqC);
  const bc = dtwDistance(seqB, seqC);

  console.log(`  same(A,B): ${ab.toFixed(4)}`);
  console.log(`  cross(A,C): ${ac.toFixed(4)}`);
  console.log(`  cross(B,C): ${bc.toFixed(4)}`);

  const ratio = Math.min(ac, bc) / ab;
  console.log(`\nRatio cross/same = ${ratio.toFixed(2)}`);
  console.log(`Pass criterion: ratio ≥ 2.0 → ${ratio >= 2.0 ? 'PASS' : 'FAIL'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
