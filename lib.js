// Pure helpers shared between the browser app and the test runner.
// Keep dependency-free and side-effect-free.

function fmt(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function mix(a, b, t) {
  const ah = parseInt(a.slice(1), 16), bh = parseInt(b.slice(1), 16);
  const ar = (ah >> 16) & 255, ag = (ah >> 8) & 255, ab = ah & 255;
  const br = (bh >> 16) & 255, bg = (bh >> 8) & 255, bb = bh & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return '#' + ((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0');
}

function stripCommonPrefix(names) {
  if (!names.length) return [];
  let prefix = names[0];
  for (const n of names) {
    while (n.indexOf(prefix) !== 0 && prefix.length) {
      prefix = prefix.slice(0, -1);
    }
    if (!prefix) break;
  }
  return names.map(n =>
    n.slice(prefix.length).replace(/\.[^.]+$/, '').trim() || n.replace(/\.[^.]+$/, '')
  );
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function pixelToTime(localPx, widthPx, durationSec) {
  if (!durationSec || !widthPx) return 0;
  return clamp((localPx / widthPx) * durationSec, 0, durationSec);
}

// Pick the index of the longest-duration stem so the player has a stable time
// reference. Falls back to 0 if all durations are non-finite.
function longestStemIdx(durations) {
  let idx = 0, best = -Infinity;
  for (let i = 0; i < durations.length; i++) {
    const d = durations[i];
    if (isFinite(d) && d > best) { best = d; idx = i; }
  }
  return idx;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fmt, mix, stripCommonPrefix, clamp, pixelToTime, longestStemIdx };
}
