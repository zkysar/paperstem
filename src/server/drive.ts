import { Buffer } from 'node:buffer';
import {
  createReadStream,
  createWriteStream,
} from 'node:fs';
import {
  mkdir,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FILES_BASE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3/files';
const REFRESH_SKEW_SECONDS = 30;
const RESUMABLE_THRESHOLD = 5 * 1024 * 1024;

const LOCAL_ROOT_ENV = 'PAPERSTEM_LOCAL_DRIVE_ROOT';
const LOCAL_ID_PREFIX = 'local:';
export const LOCAL_ROOT_ID = `${LOCAL_ID_PREFIX}`;

function localRoot(): string | null {
  const v = process.env[LOCAL_ROOT_ENV];
  return v && v.trim() ? resolve(v) : null;
}

function encodeLocalId(rel: string): string {
  return LOCAL_ID_PREFIX + Buffer.from(rel, 'utf8').toString('base64url');
}

function decodeLocalId(id: string): string {
  if (!id.startsWith(LOCAL_ID_PREFIX)) {
    throw new Error(`drive(local): expected '${LOCAL_ID_PREFIX}' id, got ${id}`);
  }
  return Buffer.from(id.slice(LOCAL_ID_PREFIX.length), 'base64url').toString('utf8');
}

function sanitizeSegment(segment: string): string {
  if (
    !segment ||
    segment === '.' ||
    segment === '..' ||
    segment.includes('/') ||
    segment.includes('\\') ||
    segment.includes('\0')
  ) {
    throw new Error(`drive(local): invalid path segment: ${JSON.stringify(segment)}`);
  }
  return segment;
}

function localPathFromRel(root: string, rel: string): string {
  if (rel === '') return root;
  rel.split('/').forEach(sanitizeSegment);
  const abs = resolve(join(root, rel));
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`drive(local): path escapes root: ${rel}`);
  }
  return abs;
}

function relFromParentId(parentId: string | undefined | 'root'): string {
  if (!parentId || parentId === 'root') return '';
  return decodeLocalId(parentId);
}

const LOCAL_AUDIO_MIME: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/opus',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.webm': 'audio/webm',
};

function guessLocalMime(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return LOCAL_AUDIO_MIME[ext] ?? 'application/octet-stream';
}

function parseLocalRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, startStr, endStr] = m;
  let start: number;
  let end: number;
  if (startStr === '' && endStr !== '') {
    const n = Number(endStr);
    if (!Number.isFinite(n) || n <= 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else if (startStr !== '') {
    start = Number(startStr);
    end = endStr === '' ? size - 1 : Number(endStr);
  } else {
    return null;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end >= size || start > end) return null;
  return { start, end };
}

type CachedToken = { token: string; expiresAt: number };

let cached: CachedToken | null = null;
let refreshInFlight: Promise<CachedToken> | null = null;

function readEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`drive: missing required env ${name}`);
  return v;
}

async function refreshAccessToken(): Promise<CachedToken> {
  const clientId = readEnv('GOOGLE_CLIENT_ID');
  const clientSecret = readEnv('GOOGLE_CLIENT_SECRET');
  const refreshToken = readEnv('GOOGLE_REFRESH_TOKEN');
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`drive: token refresh failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  if (!data.access_token || !data.expires_in) {
    throw new Error('drive: token refresh response missing access_token/expires_in');
  }
  const expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;
  return { token: data.access_token, expiresAt };
}

async function getAccessToken(): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - REFRESH_SKEW_SECONDS > nowSec) {
    return cached.token;
  }
  if (refreshInFlight) {
    const t = await refreshInFlight;
    return t.token;
  }
  refreshInFlight = (async () => {
    try {
      const fresh = await refreshAccessToken();
      cached = fresh;
      return fresh;
    } finally {
      refreshInFlight = null;
    }
  })();
  const t = await refreshInFlight;
  return t.token;
}

export function _resetTokenCacheForTests(): void {
  cached = null;
  refreshInFlight = null;
}

async function driveError(res: Response, action: string): Promise<Error> {
  const text = await res.text().catch(() => '');
  return new Error(`drive: ${action} failed: ${res.status} ${text}`);
}

export async function getDriveFile(
  fileId: string,
  range?: string,
): Promise<{ status: number; headers: Headers; body: ReadableStream<Uint8Array> }> {
  const root = localRoot();
  if (root) return getLocalFile(root, fileId, range);
  const token = await getAccessToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (range) headers.Range = range;
  const url = `${FILES_BASE}/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetch(url, { headers });
  if (res.status >= 400) {
    throw await driveError(res, `getDriveFile(${fileId})`);
  }
  if (!res.body) {
    throw new Error(`drive: getDriveFile(${fileId}) returned no body`);
  }
  return { status: res.status, headers: res.headers, body: res.body };
}

async function getLocalFile(
  root: string,
  fileId: string,
  range?: string,
): Promise<{ status: number; headers: Headers; body: ReadableStream<Uint8Array> }> {
  const rel = decodeLocalId(fileId);
  const abs = localPathFromRel(root, rel);
  const s = await stat(abs);
  if (!s.isFile()) {
    throw new Error(`drive(local): not a file: ${rel}`);
  }
  const total = s.size;
  const headers = new Headers();
  headers.set('Content-Type', guessLocalMime(abs));
  headers.set('Accept-Ranges', 'bytes');
  const r = parseLocalRange(range, total);
  if (r) {
    const stream = createReadStream(abs, { start: r.start, end: r.end });
    const length = r.end - r.start + 1;
    headers.set('Content-Length', String(length));
    headers.set('Content-Range', `bytes ${r.start}-${r.end}/${total}`);
    return {
      status: 206,
      headers,
      body: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
    };
  }
  headers.set('Content-Length', String(total));
  return {
    status: 200,
    headers,
    body: Readable.toWeb(createReadStream(abs)) as ReadableStream<Uint8Array>,
  };
}

export async function createFolder(
  name: string,
  parentId?: string,
): Promise<{ id: string }> {
  const root = localRoot();
  if (root) {
    sanitizeSegment(name);
    const parentRel = relFromParentId(parentId);
    const childRel = parentRel === '' ? name : `${parentRel}/${name}`;
    const abs = localPathFromRel(root, childRel);
    await mkdir(abs, { recursive: true });
    return { id: encodeLocalId(childRel) };
  }
  const token = await getAccessToken();
  const metadata: { name: string; mimeType: string; parents?: string[] } = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) metadata.parents = [parentId];
  const res = await fetch(`${FILES_BASE}?fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
  });
  if (!res.ok) throw await driveError(res, `createFolder(${name})`);
  const data = (await res.json()) as { id: string };
  return { id: data.id };
}

export async function shareFolder(
  folderId: string,
  email: string,
  role: 'reader' | 'writer' | 'owner',
): Promise<void> {
  if (localRoot()) return;
  const token = await getAccessToken();
  const url =
    `${FILES_BASE}/${encodeURIComponent(folderId)}/permissions` +
    `?sendNotificationEmail=false`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'user', role, emailAddress: email }),
  });
  if (!res.ok) throw await driveError(res, `shareFolder(${folderId},${email})`);
}

export async function findFolderByName(
  name: string,
  parentId: string | 'root',
): Promise<{ id: string } | null> {
  const root = localRoot();
  if (root) return findLocalEntry(root, name, parentId, 'folder');
  const token = await getAccessToken();
  const escapedName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q =
    `mimeType = 'application/vnd.google-apps.folder' ` +
    `and name = '${escapedName}' ` +
    `and '${parentId}' in parents ` +
    `and trashed = false`;
  const url =
    `${FILES_BASE}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=10`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await driveError(res, `findFolderByName(${name})`);
  const data = (await res.json()) as { files: { id: string; name: string }[] };
  if (data.files.length === 0) return null;
  if (data.files.length > 1) {
    throw new Error(
      `drive: findFolderByName(${name}) found ${data.files.length} matches in parent ${parentId}; ` +
        `clean up duplicates manually before retrying`,
    );
  }
  return { id: data.files[0].id };
}

export async function findFileByName(
  name: string,
  parentId: string,
): Promise<{ id: string } | null> {
  const root = localRoot();
  if (root) return findLocalEntry(root, name, parentId, 'file');
  const token = await getAccessToken();
  const escapedName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q =
    `name = '${escapedName}' ` +
    `and '${parentId}' in parents ` +
    `and mimeType != 'application/vnd.google-apps.folder' ` +
    `and trashed = false`;
  const url =
    `${FILES_BASE}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=10`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await driveError(res, `findFileByName(${name})`);
  const data = (await res.json()) as { files: { id: string; name: string }[] };
  if (data.files.length === 0) return null;
  if (data.files.length > 1) {
    throw new Error(
      `drive: findFileByName(${name}) found ${data.files.length} matches in parent ${parentId}; ` +
        `clean up duplicates manually before retrying`,
    );
  }
  return { id: data.files[0].id };
}

export async function listFolder(
  parentFolderId: string,
): Promise<{ id: string; name: string }[]> {
  const root = localRoot();
  if (root) return listLocalFolder(root, parentFolderId);
  const token = await getAccessToken();
  const q = `'${parentFolderId}' in parents and trashed = false`;
  const all: { id: string; name: string }[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q,
      fields: 'nextPageToken,files(id,name)',
      pageSize: '1000',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const url = `${FILES_BASE}?${params.toString()}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw await driveError(res, `listFolder(${parentFolderId})`);
    const data = (await res.json()) as {
      nextPageToken?: string;
      files: { id: string; name: string }[];
    };
    all.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return all;
}

export async function deleteFile(fileId: string): Promise<void> {
  const root = localRoot();
  if (root) {
    const abs = localPathFromRel(root, decodeLocalId(fileId));
    await rm(abs, { recursive: true, force: true });
    return;
  }
  const token = await getAccessToken();
  const res = await fetch(`${FILES_BASE}/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    throw await driveError(res, `deleteFile(${fileId})`);
  }
}

export async function updateFile(
  fileId: string,
  mimeType: string,
  body: Buffer,
): Promise<{ id: string; size: number }> {
  const root = localRoot();
  if (root) {
    const rel = decodeLocalId(fileId);
    const abs = localPathFromRel(root, rel);
    await writeFile(abs, body);
    return { id: fileId, size: body.length };
  }
  const token = await getAccessToken();
  const url =
    `${UPLOAD_BASE}/${encodeURIComponent(fileId)}` +
    `?uploadType=media&fields=id,size`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': mimeType,
      'Content-Length': String(body.length),
    },
    body,
  });
  if (!res.ok) throw await driveError(res, `updateFile(${fileId})`);
  const data = (await res.json()) as { id: string; size?: string };
  return { id: data.id, size: data.size ? Number(data.size) : body.length };
}

export async function uploadFile(
  parentFolderId: string,
  name: string,
  mimeType: string,
  body: Buffer | ReadableStream<Uint8Array>,
): Promise<{ id: string; size: number }> {
  const root = localRoot();
  if (root) return uploadLocalFile(root, parentFolderId, name, body);
  if (Buffer.isBuffer(body) && body.length <= RESUMABLE_THRESHOLD) {
    return uploadMultipart(parentFolderId, name, mimeType, body);
  }
  return uploadResumable(parentFolderId, name, mimeType, body);
}

async function findLocalEntry(
  root: string,
  name: string,
  parentId: string | 'root',
  kind: 'file' | 'folder',
): Promise<{ id: string } | null> {
  sanitizeSegment(name);
  const parentRel = relFromParentId(parentId);
  const childRel = parentRel === '' ? name : `${parentRel}/${name}`;
  const abs = localPathFromRel(root, childRel);
  try {
    const s = await stat(abs);
    if (kind === 'folder' && !s.isDirectory()) return null;
    if (kind === 'file' && !s.isFile()) return null;
    return { id: encodeLocalId(childRel) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function listLocalFolder(
  root: string,
  parentFolderId: string,
): Promise<{ id: string; name: string }[]> {
  const parentRel = decodeLocalId(parentFolderId);
  const abs = localPathFromRel(root, parentRel);
  const entries = await readdir(abs, { withFileTypes: true });
  return entries.map((e) => ({
    id: encodeLocalId(parentRel === '' ? e.name : `${parentRel}/${e.name}`),
    name: e.name,
  }));
}

async function uploadLocalFile(
  root: string,
  parentFolderId: string,
  name: string,
  body: Buffer | ReadableStream<Uint8Array>,
): Promise<{ id: string; size: number }> {
  sanitizeSegment(name);
  const parentRel = decodeLocalId(parentFolderId);
  const parentAbs = localPathFromRel(root, parentRel);
  await mkdir(parentAbs, { recursive: true });
  const childRel = parentRel === '' ? name : `${parentRel}/${name}`;
  const abs = localPathFromRel(root, childRel);
  let size: number;
  if (Buffer.isBuffer(body)) {
    await writeFile(abs, body);
    size = body.length;
  } else {
    const ws = createWriteStream(abs);
    const rs = Readable.fromWeb(body as unknown as Parameters<typeof Readable.fromWeb>[0]);
    await pipeline(rs, ws);
    const s = await stat(abs);
    size = s.size;
  }
  return { id: encodeLocalId(childRel), size };
}

async function uploadMultipart(
  parentFolderId: string,
  name: string,
  mimeType: string,
  body: Buffer,
): Promise<{ id: string; size: number }> {
  const token = await getAccessToken();
  const boundary = `paperstem-${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({ name, parents: [parentFolderId] });
  const head =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const payload = Buffer.concat([Buffer.from(head, 'utf8'), body, Buffer.from(tail, 'utf8')]);
  const res = await fetch(`${UPLOAD_BASE}?uploadType=multipart&fields=id,size`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: payload,
  });
  if (!res.ok) throw await driveError(res, `uploadFile(${name}) multipart`);
  const data = (await res.json()) as { id: string; size?: string };
  return { id: data.id, size: data.size ? Number(data.size) : body.length };
}

async function uploadResumable(
  parentFolderId: string,
  name: string,
  mimeType: string,
  body: Buffer | ReadableStream<Uint8Array>,
): Promise<{ id: string; size: number }> {
  const token = await getAccessToken();
  const initRes = await fetch(`${UPLOAD_BASE}?uploadType=resumable&fields=id,size`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
    },
    body: JSON.stringify({ name, parents: [parentFolderId] }),
  });
  if (!initRes.ok) throw await driveError(initRes, `uploadFile(${name}) resumable init`);
  const sessionUrl = initRes.headers.get('location');
  if (!sessionUrl) {
    throw new Error(`drive: uploadFile(${name}) resumable init missing Location header`);
  }
  const uploadHeaders: Record<string, string> = { 'Content-Type': mimeType };
  if (Buffer.isBuffer(body)) {
    uploadHeaders['Content-Length'] = String(body.length);
  }
  const init: RequestInit & { duplex?: 'half' } = {
    method: 'PUT',
    headers: uploadHeaders,
    body: body as unknown as RequestInit['body'],
  };
  if (!Buffer.isBuffer(body)) init.duplex = 'half';
  const uploadRes = await fetch(sessionUrl, init);
  if (!uploadRes.ok) throw await driveError(uploadRes, `uploadFile(${name}) resumable PUT`);
  const data = (await uploadRes.json()) as { id: string; size?: string };
  const size = data.size
    ? Number(data.size)
    : Buffer.isBuffer(body)
      ? body.length
      : 0;
  return { id: data.id, size };
}
