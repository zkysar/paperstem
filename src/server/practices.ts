import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Context } from 'hono';
import busboy from 'busboy';
import { stmts } from './db.js';
import { requireUser, type AuthVariables } from './auth/middleware.js';
import { createFolder, uploadFile } from './drive.js';

const MAX_NAME_LENGTH = 200;
const MAX_STEM_BYTES = 100 * 1024 * 1024;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
};

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function inferAudioMime(filename: string, declared: string | undefined): string | null {
  const ext = extOf(filename);
  const fromExt = MIME_BY_EXT[ext];
  if (fromExt) return fromExt;
  if (declared && declared.startsWith('audio/')) return declared;
  return null;
}

export function handleListPractices(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const user = requireUser(c);
  const bandId = c.req.query('band_id') ?? '';
  if (!bandId) return c.json({ error: 'not_found' }, 404);

  const membership = stmts.findMembership.get(bandId, user.id);
  if (!membership) return c.json({ error: 'not_found' }, 404);

  const rows = stmts.findPracticesForBand.all(bandId);
  const practices = rows.map((p) => ({
    id: p.id,
    name: p.name,
    recorded_on: p.recorded_on,
    bpm: p.bpm,
    reference_stem: p.reference_stem,
    drive_folder_id: p.drive_folder_id,
    created_at: p.created_at,
    updated_at: p.updated_at,
  }));
  return c.json({ practices });
}

export function handleGetPractice(
  c: Context<{ Variables: AuthVariables }>,
): Response {
  const user = requireUser(c);
  const id = c.req.param('id') ?? '';
  if (!id) return c.json({ error: 'not_found' }, 404);

  const practice = stmts.findPracticeById.get(id);
  if (!practice) return c.json({ error: 'not_found' }, 404);

  const membership = stmts.findMembership.get(practice.band_id, user.id);
  if (!membership) return c.json({ error: 'not_found' }, 404);

  const stems = stmts.findStemsForPractice.all(id).map((s) => ({
    id: s.id,
    name: s.name,
    position: s.position,
    duration_ms: s.duration_ms,
    size_bytes: s.size_bytes,
  }));

  return c.json({
    practice: {
      id: practice.id,
      band_id: practice.band_id,
      name: practice.name,
      recorded_on: practice.recorded_on,
      drive_folder_id: practice.drive_folder_id,
      bpm: practice.bpm,
      reference_stem: practice.reference_stem,
      notes: practice.notes,
      created_at: practice.created_at,
      created_by: practice.created_by,
      updated_at: practice.updated_at,
    },
    stems,
  });
}

type CreatePracticeBody = {
  band_id?: unknown;
  name?: unknown;
  recorded_on?: unknown;
  bpm?: unknown;
  reference_stem?: unknown;
};

export async function handleCreatePractice(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const user = requireUser(c);

  let body: CreatePracticeBody;
  try {
    body = (await c.req.json()) as CreatePracticeBody;
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const bandId = typeof body.band_id === 'string' ? body.band_id.trim() : '';
  const rawName = typeof body.name === 'string' ? body.name.trim() : '';
  if (!bandId || !rawName) return c.json({ error: 'invalid_input' }, 400);
  if (rawName.length > MAX_NAME_LENGTH) {
    return c.json({ error: 'invalid_input' }, 400);
  }

  let recordedOn: string | null = null;
  if (body.recorded_on != null && body.recorded_on !== '') {
    if (typeof body.recorded_on !== 'string' || !ISO_DATE_RE.test(body.recorded_on)) {
      return c.json({ error: 'invalid_input' }, 400);
    }
    recordedOn = body.recorded_on;
  }

  let bpm: number | null = null;
  if (body.bpm != null && body.bpm !== '') {
    const n = typeof body.bpm === 'number' ? body.bpm : Number(body.bpm);
    if (!Number.isInteger(n) || n < 1 || n > 300) {
      return c.json({ error: 'invalid_input' }, 400);
    }
    bpm = n;
  }

  let referenceStem: string | null = null;
  if (body.reference_stem != null && body.reference_stem !== '') {
    if (typeof body.reference_stem !== 'string') {
      return c.json({ error: 'invalid_input' }, 400);
    }
    referenceStem = body.reference_stem.trim() || null;
  }

  if (!stmts.findOwnerMembership.get(bandId, user.id)) {
    return c.json({ error: 'forbidden' }, 403);
  }
  const band = stmts.findBandById.get(bandId);
  if (!band) return c.json({ error: 'forbidden' }, 403);
  if (band.drive_folder_id.startsWith('PENDING_')) {
    return c.json({ error: 'band_not_provisioned' }, 409);
  }

  let practiceFolder: { id: string };
  try {
    practiceFolder = await createFolder(rawName, band.drive_folder_id);
  } catch (err) {
    console.error('[practices] createFolder failed', err);
    return c.json({ error: 'upstream_error' }, 502);
  }

  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  stmts.insertPractice.run(
    id,
    bandId,
    rawName,
    recordedOn,
    practiceFolder.id,
    bpm,
    referenceStem,
    null,
    now,
    user.id,
    now,
  );

  return c.json(
    {
      practice: {
        id,
        band_id: bandId,
        name: rawName,
        recorded_on: recordedOn,
        drive_folder_id: practiceFolder.id,
        bpm,
        reference_stem: referenceStem,
        notes: null,
        created_at: now,
        created_by: user.id,
        updated_at: now,
      },
    },
    201,
  );
}

type ParsedUpload = {
  filename: string;
  mime: string;
  body: ReadableStream<Uint8Array>;
  position: number | null;
  done: Promise<{ tooLarge: boolean }>;
};

function parseStemMultipart(
  bodyStream: ReadableStream<Uint8Array>,
  contentType: string,
): Promise<ParsedUpload> {
  return new Promise((resolve, reject) => {
    let fileSeen = false;
    let positionField: number | null = null;
    let resolved = false;
    const bb = busboy({
      headers: { 'content-type': contentType },
      limits: { files: 1, fileSize: MAX_STEM_BYTES + 1 },
    });

    bb.on('field', (name, value) => {
      if (name === 'position') {
        const n = Number(value);
        if (Number.isInteger(n) && n >= 0) positionField = n;
      }
    });

    bb.on('file', (name, fileStream, info) => {
      if (name !== 'file' || fileSeen) {
        fileStream.resume();
        return;
      }
      fileSeen = true;

      let tooLarge = false;
      fileStream.on('limit', () => {
        tooLarge = true;
      });

      const finished = new Promise<{ tooLarge: boolean }>((doneResolve, doneReject) => {
        fileStream.on('end', () => doneResolve({ tooLarge }));
        fileStream.on('error', doneReject);
      });

      const filename = info.filename || 'upload';
      const declaredMime = info.mimeType;
      const mime = inferAudioMime(filename, declaredMime);
      if (!mime) {
        fileStream.resume();
        if (!resolved) {
          resolved = true;
          reject(new MultipartError('unsupported_media_type', 415));
        }
        return;
      }

      resolved = true;
      resolve({
        filename,
        mime,
        body: Readable.toWeb(fileStream) as ReadableStream<Uint8Array>,
        position: positionField,
        done: finished,
      });
    });

    bb.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    bb.on('close', () => {
      if (!resolved) {
        resolved = true;
        reject(new MultipartError('missing_file', 400));
      }
    });

    Readable.fromWeb(bodyStream as import('node:stream/web').ReadableStream<Uint8Array>).pipe(bb);
  });
}

type MultipartErrorStatus = 400 | 413 | 415;

class MultipartError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: MultipartErrorStatus,
  ) {
    super(code);
  }
}

export async function handleCreateStem(
  c: Context<{ Variables: AuthVariables }>,
): Promise<Response> {
  const user = requireUser(c);
  const practiceId = c.req.param('id') ?? '';
  if (!practiceId) return c.json({ error: 'not_found' }, 404);

  const practice = stmts.findPracticeById.get(practiceId);
  if (!practice) return c.json({ error: 'not_found' }, 404);

  if (!stmts.findOwnerMembership.get(practice.band_id, user.id)) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return c.json({ error: 'invalid_content_type' }, 400);
  }

  const reqBody = c.req.raw.body;
  if (!reqBody) {
    return c.json({ error: 'missing_body' }, 400);
  }

  let parsed: ParsedUpload;
  try {
    parsed = await parseStemMultipart(reqBody, contentType);
  } catch (err) {
    if (err instanceof MultipartError) {
      return c.json({ error: err.code }, err.status);
    }
    console.error('[practices] multipart parse failed', err);
    return c.json({ error: 'invalid_multipart' }, 400);
  }

  let uploaded: { id: string; size: number };
  try {
    uploaded = await uploadFile(
      practice.drive_folder_id,
      parsed.filename,
      parsed.mime,
      parsed.body,
    );
  } catch (err) {
    console.error('[practices] uploadFile failed', err);
    void parsed.done.catch(() => {});
    return c.json({ error: 'upstream_error' }, 502);
  }

  const { tooLarge } = await parsed.done;
  if (tooLarge) {
    return c.json({ error: 'file_too_large' }, 413);
  }

  const ext = extOf(parsed.filename);
  const stemName = ext ? parsed.filename.slice(0, -ext.length) : parsed.filename;

  const position =
    parsed.position ?? (stmts.countStemsForPractice.get(practiceId)?.c ?? 0);

  const stemId = randomUUID();
  stmts.insertStem.run(
    stemId,
    practiceId,
    stemName,
    position,
    uploaded.id,
    null,
    uploaded.size,
  );

  return c.json(
    {
      stem: {
        id: stemId,
        practice_id: practiceId,
        name: stemName,
        position,
        duration_ms: null,
        size_bytes: uploaded.size,
      },
    },
    201,
  );
}
