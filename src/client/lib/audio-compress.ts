import lamejs from '@breezystack/lamejs';

const TARGET_BITRATE_KBPS = 64;
const FRAME_SAMPLES = 1152;
const YIELD_EVERY_FRAMES = 200;

type Mp3EncoderCtor = new (
  channels: number,
  sampleRate: number,
  kbps: number,
) => {
  encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
  flush(): Int8Array;
};

export async function compressToMp3(
  file: File,
  onProgress?: (frac: number) => void,
): Promise<File> {
  const buf = await file.arrayBuffer();

  const AudioCtx =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  let audio: AudioBuffer;
  try {
    audio = await ctx.decodeAudioData(buf);
  } finally {
    void ctx.close();
  }

  const sampleRate = audio.sampleRate;
  const length = audio.length;

  const Encoder = (lamejs as unknown as { Mp3Encoder: Mp3EncoderCtor }).Mp3Encoder;
  const encoder = new Encoder(1, sampleRate, TARGET_BITRATE_KBPS);

  // Downmix every input to mono. Stems on Paperstem come from per-track
  // multitrackers (Zoom Model 12, etc.) where each channel is already a
  // single-source mono signal; the stereo path was carrying duplicate audio
  // and doubling file size for no perceptual benefit.
  const mono = downmixToMono(audio);
  const samples = floatToInt16(mono);

  const chunks: Uint8Array[] = [];
  let frameIndex = 0;

  for (let i = 0; i < length; i += FRAME_SAMPLES) {
    const end = Math.min(i + FRAME_SAMPLES, length);
    const frame = samples.subarray(i, end);

    const mp3buf = encoder.encodeBuffer(frame);

    if (mp3buf.length > 0) chunks.push(new Uint8Array(mp3buf));

    frameIndex++;
    if (frameIndex % YIELD_EVERY_FRAMES === 0) {
      onProgress?.(i / length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(new Uint8Array(tail));
  onProgress?.(1);

  const blob = new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
  const newName = file.name.replace(/\.[^.]+$/, '') + '.mp3';
  return new File([blob], newName, { type: 'audio/mpeg' });
}

function downmixToMono(audio: AudioBuffer): Float32Array {
  const length = audio.length;
  if (audio.numberOfChannels <= 1) return audio.getChannelData(0);
  const out = new Float32Array(length);
  const channels: Float32Array[] = [];
  for (let c = 0; c < audio.numberOfChannels; c++) {
    channels.push(audio.getChannelData(c));
  }
  const inv = 1 / channels.length;
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let c = 0; c < channels.length; c++) sum += channels[c][i];
    out[i] = sum * inv;
  }
  return out;
}

function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
