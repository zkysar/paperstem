export type Practice = {
  id: string;
  title: string;
  folder: string;
  stems: string[];
};

export type LoadedStem = {
  name: string;
  displayName: string;
  color: string;
  audio: HTMLAudioElement;
  userMuted: boolean;
  soloed: boolean;
  userVolume: number;
  practiceId: string | null;
  revoke?: () => void;
};

export type LoopRegion = {
  start: number;
  end: number;
  enabled: boolean;
};

export type PlayerState = {
  practiceId: string | null;
  title: string;
  stems: LoadedStem[];
  duration: number;
  referenceIdx: number;
  isPlaying: boolean;
  focusedIdx: number;
  loop: LoopRegion | null;
  status: string;
};

export type StemSource = {
  name: string;
  src: string;
  revoke?: () => void;
};

export type LoadContext = {
  practiceId: string | null;
  title: string;
};
