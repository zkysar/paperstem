import JSZip from 'jszip';
import type { LoadedStem } from '../data/types';

export async function downloadStemsAsZip(
  stems: LoadedStem[],
  filename: string,
): Promise<void> {
  if (!stems.length) return;
  const zip = new JSZip();
  for (const s of stems) {
    const res = await fetch(s.audio.src);
    if (!res.ok) throw new Error(`${s.name}: HTTP ${res.status}`);
    const blob = await res.blob();
    zip.file(s.name, blob);
  }
  const out = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(out);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
