import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = mkdtempSync(join(tmpdir(), 'paperstem-upload-test-'));
const dbPath = join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.GMAIL_USER = 'test@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';
process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CLIENT_SECRET = 'csec';
process.env.GOOGLE_REFRESH_TOKEN = 'rtok';

type DbModule = typeof import('./db.js');
type ProjectsModule = typeof import('./projects.js');
type DriveModule = typeof import('./drive.js');
type MiddlewareModule = typeof import('./auth/middleware.js');
type CookieModule = typeof import('./auth/cookie.js');

let dbMod: DbModule;
let projectsMod: ProjectsModule;
let driveMod: DriveModule;
let middlewareMod: MiddlewareModule;
let cookieMod: CookieModule;
let app: import('hono').Hono;

beforeAll(async () => {
  dbMod = await import('./db.js');
  projectsMod = await import('./projects.js');
  driveMod = await import('./drive.js');
  middlewareMod = await import('./auth/middleware.js');
  cookieMod = await import('./auth/cookie.js');
  const { Hono } = await import('hono');
  app = new Hono();
  app.use('*', middlewareMod.sessionMiddleware);
  app.post('/api/projects', projectsMod.handleCreateProject);
  app.post('/api/projects/:id/stems', projectsMod.handleCreateStem);
  app.get('/api/projects/:id', projectsMod.handleGetProject);
  app.put('/api/stems/:id/peaks', projectsMod.handleUpdateStemPeaks);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function reset() {
  dbMod.db.exec(
    'DELETE FROM stems; DELETE FROM projects; DELETE FROM memberships; DELETE FROM bands; DELETE FROM sessions; DELETE FROM magic_links; DELETE FROM users;',
  );
  driveMod._resetTokenCacheForTests();
  vi.restoreAllMocks();
}

function createUser(email: string): string {
  const id = randomUUID();
  dbMod.stmts.insertUser.run(id, email, null, Math.floor(Date.now() / 1000));
  return id;
}

function createBand(name: string, ownerId: string, driveFolderId = 'drive-folder-x'): string {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertBand.run(id, name, driveFolderId, ownerId, now);
  dbMod.stmts.insertMembership.run(id, ownerId, 'owner', now);
  return id;
}

function addMember(bandId: string, userId: string): void {
  dbMod.stmts.insertMembership.run(
    bandId,
    userId,
    'member',
    Math.floor(Date.now() / 1000),
  );
}

function createProject(bandId: string, ownerId: string): string {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertProject.run(
    id,
    bandId,
    'p1',
    null,
    'project-folder-x',
    null,
    now,
    ownerId,
    now,
  );
  return id;
}

function createSession(userId: string): string {
  const sid = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  dbMod.stmts.insertSession.run(sid, userId, now + 3600, now);
  return sid;
}

function cookieHeader(sid: string): string {
  return `${cookieMod.SESSION_COOKIE_NAME}=${sid}`;
}

function mockDriveSuccess(opts: {
  folderId?: string;
  fileId?: string;
  observedFileSize?: { bytes: number };
}) {
  const folderId = opts.folderId ?? 'project-folder-new';
  const fileId = opts.fileId ?? 'drive-file-new';
  const seenFileSize = opts.observedFileSize;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(
        JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.startsWith('https://www.googleapis.com/drive/v3/files') && (init?.method === 'POST' || (init?.method ?? 'GET') === 'POST')) {
      return new Response(JSON.stringify({ id: folderId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files') && url.includes('uploadType=resumable')) {
      return new Response('', {
        status: 200,
        headers: { Location: 'https://upload.example/sess-1' },
      });
    }
    if (url === 'https://upload.example/sess-1') {
      const body = init?.body as ReadableStream<Uint8Array> | Buffer | undefined;
      let bytes = 0;
      if (body instanceof Buffer) {
        bytes = body.length;
      } else if (body && typeof (body as ReadableStream).getReader === 'function') {
        const reader = (body as ReadableStream<Uint8Array>).getReader();
        // Drain the stream to count bytes; the streaming-not-buffering test
        // measures peak RSS while this consumes. We deliberately do NOT
        // accumulate chunks into a single buffer.
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
        }
      }
      if (seenFileSize) seenFileSize.bytes = bytes;
      return new Response(JSON.stringify({ id: fileId, size: String(bytes) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files') && url.includes('uploadType=multipart')) {
      const body = init?.body;
      let bytes = 0;
      if (body instanceof Buffer) bytes = body.length;
      return new Response(JSON.stringify({ id: fileId, size: String(bytes) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch ${url} (method=${init?.method})`);
  });
}

function buildMultipart(
  fields: { name: string; value: string }[],
  file: { fieldName: string; filename: string; mime: string; body: Buffer },
): { contentType: string; body: Buffer } {
  const boundary = `----paperstem-test-${Math.random().toString(36).slice(2)}`;
  const parts: Buffer[] = [];
  for (const f of fields) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"\r\n\r\n${f.value}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\nContent-Type: ${file.mime}\r\n\r\n`,
    ),
  );
  parts.push(file.body);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat(parts),
  };
}

beforeEach(() => {
  reset();
});

describe('POST /api/projects owner-only auth', () => {
  it('401 unauthenticated', async () => {
    const res = await app.fetch(
      new Request('http://x/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ band_id: 'x', name: 'p1' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('403 for member (not owner)', async () => {
    const owner = createUser('owner@example.com');
    const member = createUser('member@example.com');
    const bandId = createBand('Alpha', owner);
    addMember(bandId, member);

    const sid = createSession(member);
    const res = await app.fetch(
      new Request('http://x/api/projects', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({ band_id: bandId, name: 'p1' }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('403 for stranger (no membership)', async () => {
    const owner = createUser('owner@example.com');
    const stranger = createUser('stranger@example.com');
    const bandId = createBand('Alpha', owner);

    const sid = createSession(stranger);
    const res = await app.fetch(
      new Request('http://x/api/projects', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({ band_id: bandId, name: 'p1' }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('201 for owner; creates Drive folder and inserts row', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    mockDriveSuccess({ folderId: 'project-folder-abc' });

    const sid = createSession(owner);
    const res = await app.fetch(
      new Request('http://x/api/projects', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({
          band_id: bandId,
          name: 'project-2026-05-04',
          recorded_on: '2026-05-04',
        }),
      }),
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as {
      project: {
        id: string;
        band_id: string;
        drive_folder_id: string;
        name: string;
        recorded_on: string | null;
        notes: string | null;
      };
    };
    expect(data.project.band_id).toBe(bandId);
    expect(data.project.drive_folder_id).toBe('project-folder-abc');
    expect(data.project.name).toBe('project-2026-05-04');
    expect(data.project.recorded_on).toBe('2026-05-04');
    expect(data.project.notes).toBe(null);

    const row = dbMod.stmts.findProjectById.get(data.project.id);
    expect(row?.band_id).toBe(bandId);
  });

  it('400 invalid recorded_on', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const sid = createSession(owner);
    const res = await app.fetch(
      new Request('http://x/api/projects', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({
          band_id: bandId,
          name: 'p',
          recorded_on: 'not-a-date',
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('409 when band drive_folder_id is PENDING_', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner, 'PENDING_drive');
    const sid = createSession(owner);
    const res = await app.fetch(
      new Request('http://x/api/projects', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({ band_id: bandId, name: 'p' }),
      }),
    );
    expect(res.status).toBe(409);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('band_not_provisioned');
  });
});

describe('POST /api/projects/:id/stems', () => {
  it('403 for member (not owner)', async () => {
    const owner = createUser('owner@example.com');
    const member = createUser('member@example.com');
    const bandId = createBand('Alpha', owner);
    addMember(bandId, member);
    const projectId = createProject(bandId, owner);

    const sid = createSession(member);
    const { contentType, body } = buildMultipart(
      [{ name: 'position', value: '1' }],
      {
        fieldName: 'file',
        filename: 'drums.mp3',
        mime: 'audio/mpeg',
        body: Buffer.from('hello'),
      },
    );
    const res = await app.fetch(
      new Request(`http://x/api/projects/${projectId}/stems`, {
        method: 'POST',
        headers: { 'content-type': contentType, cookie: cookieHeader(sid) },
        body,
      }),
    );
    expect(res.status).toBe(403);
  });

  it('404 for missing project', async () => {
    const owner = createUser('owner@example.com');
    const sid = createSession(owner);
    const { contentType, body } = buildMultipart([], {
      fieldName: 'file',
      filename: 'drums.mp3',
      mime: 'audio/mpeg',
      body: Buffer.from('hello'),
    });
    const res = await app.fetch(
      new Request('http://x/api/projects/no-such/stems', {
        method: 'POST',
        headers: { 'content-type': contentType, cookie: cookieHeader(sid) },
        body,
      }),
    );
    expect(res.status).toBe(404);
  });

  it('400 missing_file when no file part', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const projectId = createProject(bandId, owner);
    const sid = createSession(owner);

    const boundary = '----paperstem-test-empty';
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="position"\r\n\r\n1\r\n--${boundary}--\r\n`,
    );
    const res = await app.fetch(
      new Request(`http://x/api/projects/${projectId}/stems`, {
        method: 'POST',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
          cookie: cookieHeader(sid),
        },
        body,
      }),
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('missing_file');
  });

  it('415 unsupported mime', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const projectId = createProject(bandId, owner);
    const sid = createSession(owner);

    const { contentType, body } = buildMultipart([], {
      fieldName: 'file',
      filename: 'notes.txt',
      mime: 'text/plain',
      body: Buffer.from('hello'),
    });
    const res = await app.fetch(
      new Request(`http://x/api/projects/${projectId}/stems`, {
        method: 'POST',
        headers: { 'content-type': contentType, cookie: cookieHeader(sid) },
        body,
      }),
    );
    expect(res.status).toBe(415);
  });

  it('happy path: extracts filename, mime, content; inserts stem row', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const projectId = createProject(bandId, owner);
    const sid = createSession(owner);

    const observed = { bytes: 0 };
    mockDriveSuccess({ fileId: 'drive-file-abc', observedFileSize: observed });

    const audioBytes = Buffer.from('synthetic-audio-payload');
    const { contentType, body } = buildMultipart(
      [{ name: 'position', value: '7' }],
      {
        fieldName: 'file',
        filename: 'drums.mp3',
        mime: 'audio/mpeg',
        body: audioBytes,
      },
    );
    const res = await app.fetch(
      new Request(`http://x/api/projects/${projectId}/stems`, {
        method: 'POST',
        headers: { 'content-type': contentType, cookie: cookieHeader(sid) },
        body,
      }),
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as {
      stem: {
        id: string;
        project_id: string;
        name: string;
        position: number;
        size_bytes: number | null;
      };
    };
    expect(data.stem.project_id).toBe(projectId);
    expect(data.stem.name).toBe('drums');
    expect(data.stem.position).toBe(7);
    // Drive saw exactly the file bytes, not the multipart envelope
    expect(observed.bytes).toBe(audioBytes.length);
    expect(data.stem.size_bytes).toBe(audioBytes.length);

    const stem = dbMod.stmts.findStemById.get(data.stem.id);
    expect(stem?.drive_file_id).toBe('drive-file-abc');
    // and the response body never includes drive_file_id
    const text = JSON.stringify(data);
    expect(text).not.toMatch(/drive_file_id/);
  });

  it('413 when file exceeds 100MB', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const projectId = createProject(bandId, owner);
    const sid = createSession(owner);

    mockDriveSuccess({});

    const TEN_MB = 10 * 1024 * 1024;
    // 101MB synthetic file: bigger than the 100MB cap. We use 101 1MB
    // chunks via Buffer.concat to avoid a single huge alloc here.
    const chunk = Buffer.alloc(TEN_MB, 0x61);
    const fileBody = Buffer.concat(Array(11).fill(chunk));
    expect(fileBody.length).toBe(110 * 1024 * 1024);

    const { contentType, body } = buildMultipart([], {
      fieldName: 'file',
      filename: 'huge.mp3',
      mime: 'audio/mpeg',
      body: fileBody,
    });
    const res = await app.fetch(
      new Request(`http://x/api/projects/${projectId}/stems`, {
        method: 'POST',
        headers: { 'content-type': contentType, cookie: cookieHeader(sid) },
        body,
      }),
    );
    expect(res.status).toBe(413);
  });

  it('streaming: 50MB upload reaches Drive without buffering the body', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const projectId = createProject(bandId, owner);
    const sid = createSession(owner);

    let bodyKind: 'buffer' | 'stream' | 'unknown' = 'unknown';
    let observedBytes = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files') && url.includes('uploadType=resumable')) {
        return new Response('', {
          status: 200,
          headers: { Location: 'https://upload.example/sess-stream' },
        });
      }
      if (url === 'https://upload.example/sess-stream') {
        const body = init?.body;
        if (body instanceof Buffer) {
          bodyKind = 'buffer';
          observedBytes = body.length;
        } else if (body && typeof (body as ReadableStream).getReader === 'function') {
          bodyKind = 'stream';
          const reader = (body as ReadableStream<Uint8Array>).getReader();
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            observedBytes += value.byteLength;
          }
        }
        return new Response(
          JSON.stringify({ id: 'streamed-file', size: String(observedBytes) }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const FIFTY_MB = 50 * 1024 * 1024;
    const fileBody = Buffer.alloc(FIFTY_MB, 0);
    const { contentType, body } = buildMultipart([], {
      fieldName: 'file',
      filename: 'big.mp3',
      mime: 'audio/mpeg',
      body: fileBody,
    });

    const res = await app.fetch(
      new Request(`http://x/api/projects/${projectId}/stems`, {
        method: 'POST',
        headers: { 'content-type': contentType, cookie: cookieHeader(sid) },
        body,
      }),
    );
    expect(res.status).toBe(201);
    expect(bodyKind).toBe('stream');
    expect(observedBytes).toBe(FIFTY_MB);
  });

  it('persists peaks field on upload and returns them on GET', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const projectId = createProject(bandId, owner);
    const sid = createSession(owner);
    mockDriveSuccess({ fileId: 'drive-file-peaks' });

    const peaksStr = '0,64,128,192,255,128,64,0';
    const { contentType, body } = buildMultipart(
      [
        { name: 'position', value: '0' },
        { name: 'peaks', value: peaksStr },
      ],
      {
        fieldName: 'file',
        filename: 'guitar.mp3',
        mime: 'audio/mpeg',
        body: Buffer.from('synthetic'),
      },
    );
    const res = await app.fetch(
      new Request(`http://x/api/projects/${projectId}/stems`, {
        method: 'POST',
        headers: { 'content-type': contentType, cookie: cookieHeader(sid) },
        body,
      }),
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as { stem: { id: string; peaks: string | null } };
    expect(data.stem.peaks).toBe(peaksStr);

    const stored = dbMod.stmts.findStemById.get(data.stem.id);
    expect(stored?.peaks).toBe(peaksStr);

    const getRes = await app.fetch(
      new Request(`http://x/api/projects/${projectId}`, {
        headers: { cookie: cookieHeader(sid) },
      }),
    );
    const getData = (await getRes.json()) as {
      stems: { id: string; peaks: string | null }[];
    };
    expect(getData.stems[0].peaks).toBe(peaksStr);
  });

  it('rejects malformed peaks and stores null', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const projectId = createProject(bandId, owner);
    const sid = createSession(owner);
    mockDriveSuccess({});

    const { contentType, body } = buildMultipart(
      [{ name: 'peaks', value: 'not,a,number' }],
      {
        fieldName: 'file',
        filename: 'guitar.mp3',
        mime: 'audio/mpeg',
        body: Buffer.from('x'),
      },
    );
    const res = await app.fetch(
      new Request(`http://x/api/projects/${projectId}/stems`, {
        method: 'POST',
        headers: { 'content-type': contentType, cookie: cookieHeader(sid) },
        body,
      }),
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as { stem: { id: string; peaks: string | null } };
    expect(data.stem.peaks).toBeNull();
  });

  it('PUT /api/stems/:id/peaks backfills peaks for an existing stem', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const projectId = createProject(bandId, owner);
    const sid = createSession(owner);
    mockDriveSuccess({ fileId: 'drive-file-pre' });

    const { contentType, body } = buildMultipart([], {
      fieldName: 'file',
      filename: 'bass.mp3',
      mime: 'audio/mpeg',
      body: Buffer.from('x'),
    });
    const create = await app.fetch(
      new Request(`http://x/api/projects/${projectId}/stems`, {
        method: 'POST',
        headers: { 'content-type': contentType, cookie: cookieHeader(sid) },
        body,
      }),
    );
    const { stem } = (await create.json()) as { stem: { id: string } };

    const peaksStr = '10,20,30,40,50';
    const put = await app.fetch(
      new Request(`http://x/api/stems/${stem.id}/peaks`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader(sid),
        },
        body: JSON.stringify({ peaks: peaksStr }),
      }),
    );
    expect(put.status).toBe(200);

    const stored = dbMod.stmts.findStemById.get(stem.id);
    expect(stored?.peaks).toBe(peaksStr);
  });

  it('502 upstream_error if Drive upload fails', async () => {
    const owner = createUser('owner@example.com');
    const bandId = createBand('Alpha', owner);
    const projectId = createProject(bandId, owner);
    const sid = createSession(owner);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
          { status: 200 },
        );
      }
      return new Response('drive boom', { status: 500 });
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { contentType, body } = buildMultipart([], {
      fieldName: 'file',
      filename: 'drums.mp3',
      mime: 'audio/mpeg',
      body: Buffer.from('hi'),
    });
    const res = await app.fetch(
      new Request(`http://x/api/projects/${projectId}/stems`, {
        method: 'POST',
        headers: { 'content-type': contentType, cookie: cookieHeader(sid) },
        body,
      }),
    );
    expect(res.status).toBe(502);
  });
});
