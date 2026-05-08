import { stmts, type BandRow, type ProjectRow } from '../db.js';
import {
  findFileByName,
  updateFile,
  uploadFile,
} from '../drive.js';

const META_FILENAME = '_meta.json';
const META_MIME = 'application/json';
const SCHEMA_VERSION = 1;

export type SnapshotMeta = {
  schema_version: number;
  snapshot_at: number;
  band: { id: string; name: string };
  project: {
    id: string;
    name: string;
    recorded_on: string | null;
    bpm: number | null;
    reference_stem: string | null;
    notes: string | null;
    created_at: number;
    updated_at: number;
    created_by: string;
  };
  stems: {
    id: string;
    name: string;
    position: number;
    duration_ms: number | null;
    size_bytes: number | null;
  }[];
  annotations: {
    id: string;
    user_id: string;
    user_email: string;
    user_display_name: string | null;
    start_ms: number;
    end_ms: number | null;
    body: string;
    starred: boolean;
    created_at: number;
    updated_at: number;
  }[];
};

export function buildProjectMeta(
  band: BandRow,
  project: ProjectRow,
  nowSec: number,
): SnapshotMeta {
  const stems = stmts.findStemsForProject.all(project.id).map((s) => ({
    id: s.id,
    name: s.name,
    position: s.position,
    duration_ms: s.duration_ms,
    size_bytes: s.size_bytes,
  }));
  const annotations = stmts.findAnnotationsForProject
    .all(project.id)
    .map((a) => ({
      id: a.id,
      user_id: a.user_id,
      user_email: a.user_email,
      user_display_name: a.user_display_name,
      start_ms: a.start_ms,
      end_ms: a.end_ms,
      body: a.body,
      starred: a.starred === 1,
      created_at: a.created_at,
      updated_at: a.updated_at,
    }));
  return {
    schema_version: SCHEMA_VERSION,
    snapshot_at: nowSec,
    band: { id: band.id, name: band.name },
    project: {
      id: project.id,
      name: project.name,
      recorded_on: project.recorded_on,
      bpm: project.bpm,
      reference_stem: project.reference_stem,
      notes: project.notes,
      created_at: project.created_at,
      updated_at: project.updated_at,
      created_by: project.created_by,
    },
    stems,
    annotations,
  };
}

async function writeMetaFile(
  projectFolderId: string,
  body: Buffer,
): Promise<void> {
  const existing = await findFileByName(META_FILENAME, projectFolderId);
  if (existing) {
    await updateFile(existing.id, META_MIME, body);
    return;
  }
  await uploadFile(projectFolderId, META_FILENAME, META_MIME, body);
}

let runInFlight: Promise<void> | null = null;

export async function runSnapshotsNow(): Promise<void> {
  if (runInFlight) return runInFlight;
  runInFlight = (async () => {
    const bands = stmts.findAllBands.all();
    for (const band of bands) {
      const projects = stmts.findProjectsForBand.all(band.id);
      let updated = 0;
      for (const project of projects) {
        try {
          const nowSec = Math.floor(Date.now() / 1000);
          const meta = buildProjectMeta(band, project, nowSec);
          const body = Buffer.from(JSON.stringify(meta, null, 2), 'utf8');
          await writeMetaFile(project.drive_folder_id, body);
          updated += 1;
        } catch (err) {
          console.error(
            `[snapshots] band=${band.id} project=${project.id} failed:`,
            err,
          );
        }
      }
      stmts.setBandLastSnapshotAt.run(
        Math.floor(Date.now() / 1000),
        band.id,
      );
      console.log(
        `[snapshots] band=${band.id} projects=${projects.length} updated=${updated}`,
      );
    }
  })().finally(() => {
    runInFlight = null;
  });
  return runInFlight;
}
