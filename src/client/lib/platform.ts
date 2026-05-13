export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac/i.test(navigator.platform);
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
