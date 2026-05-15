export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac/i.test(navigator.platform);
}

// True for iPhone/iPad/iPod, including iPadOS 13+ which masquerades as Mac
// (navigator.platform === 'MacIntel') but exposes touch. Used to gate
// behaviors that only apply on iOS — e.g. the Focus/DND audio-suppression
// probe, which would otherwise produce false positives on macOS Safari when
// HTMLAudio.play() momentarily stalls.
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1;
}

// True on Android. Used to gate the silent-loop HTMLAudioElement that
// anchors Chrome's system Media Session — Web Audio alone doesn't surface
// Android's notification/lock-screen media controls.
export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}

export type KeyName = 'mod' | 'alt' | 'ctrl' | 'shift';

const MAC: Record<KeyName, string> = {
  mod: '⌘',
  alt: '⌥',
  ctrl: '⌃',
  shift: '⇧',
};
const OTHER: Record<KeyName, string> = {
  mod: 'Ctrl',
  alt: 'Alt',
  ctrl: 'Ctrl',
  shift: 'Shift',
};

export function keyGlyph(name: KeyName, mac: boolean = isMac()): string {
  return (mac ? MAC : OTHER)[name];
}
