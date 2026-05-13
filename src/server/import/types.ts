export type ImportTaskStatus =
  | { kind: 'new' }
  | { kind: 'still-recording'; lastModified: Date }
  | { kind: 'in-progress'; practiceId: string }
  | { kind: 'done'; practiceId: string };

export type Segment = {
  /** 1-indexed within the source folder */
  index: number;
  /** total segments produced by this folder */
  totalInFolder: number;
  /** inclusive sample offset within each track WAV */
  startSample: number;
  /** exclusive sample offset within each track WAV */
  endSample: number;
  /** sample rate of the source WAVs */
  sampleRate: number;
};

export type ImportTask = {
  /** Absolute path to the source folder on the SD card. */
  folderPath: string;
  /** Source track WAVs in stem-position order (position 1 = first). */
  trackFiles: string[];
  /** Stem positions corresponding to trackFiles (e.g. [1, 2, 7] for TR01/TR02/TR07). */
  trackPositions: number[];
  /** Sample range to extract; null = encode whole file. */
  segment: Segment | null;
  /** Total samples in the source files (same for all track files in the folder). */
  totalSamples: number;
  lastModified: Date;
  defaultPracticeName: string;
  /** YYYY-MM-DD or null if undetermined */
  recordedOn: string | null;
  status: ImportTaskStatus;
};

export interface DeviceImporter {
  id: string;
  label: string;
  scan(
    sdRoot: string,
    opts: { stillRecordingThresholdMs: number },
  ): Promise<ImportTask[]>;
  /** Per-track stem name used when uploading. */
  stemNameFor(filename: string, position: number): string;
}
