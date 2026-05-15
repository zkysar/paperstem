import { Buffer } from 'node:buffer';
import {
  createReadStream,
  createWriteStream,
} from 'node:fs';
import {
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const AUDIO_ROOT_ENV = 'PAPERSTEM_AUDIO_ROOT';
export const ROOT_ID = '';

function audioRoot(): string {
  const v = process.env[AUDIO_ROOT_ENV];
  if (!v || !v.trim()) {
    throw new Error(`storage: ${AUDIO_ROOT_ENV} is not set`);
  }
  return resolve(v);
}

export function encodeId(rel: string): string {
  return Buffer.from(rel, 'utf8').toString('base64url');
}

export function decodeId(id: string): string {
  return Buffer.from(id, 'base64url').toString('utf8');
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

function sanitizeSegment(segment: string): string {
  if (
    !segment ||
    segment === '.' ||
    segment === '..' ||
    segment.includes('/') ||
    segment.includes('\\') ||
    CONTROL_CHAR_RE.test(segment)
  ) {
    throw new Error(`storage: invalid path segment: ${JSON.stringify(segment)}`);
  }
  return segment;
}

function pathFromRel(root: string, rel: string): string {
  if (rel === '') return root;
  rel.split('/').forEach(sanitizeSegment);
  const abs = resolve(join(root, rel));
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`storage: path escapes root: ${rel}`);
  }
  return abs;
}

function relFromParentId(parentId: string | undefined | 'root'): string {
  if (!parentId || parentId === 'root') return '';
  return decodeId(parentId);
}

const AUDIO_MIME: Record<string, string> = {
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

function guessMime(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return AUDIO_MIME[ext] ?? 'application/octet-stream';
}

function parseRange(
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

export class StorageNotFoundError extends Error {
  constructor(public readonly fileId: string) {
    super(`storage: file ${fileId} not found`);
    this.name = 'StorageNotFoundError';
  }
}

async function statOrNotFound(abs: string, fileId: string) {
  try {
    return await stat(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new StorageNotFoundError(fileId);
    }
    throw err;
  }
}

export async function renameItem(
  fileId: string,
  name: string,
): Promise<{ id: string }> {
  sanitizeSegment(name);
  const root = audioRoot();
  const oldRel = decodeId(fileId);
  const oldAbs = pathFromRel(root, oldRel);
  const lastSlash = oldRel.lastIndexOf('/');
  const newRel = lastSlash === -1 ? name : `${oldRel.slice(0, lastSlash)}/${name}`;
  const newAbs = pathFromRel(root, newRel);
  if (oldAbs === newAbs) return { id: fileId };
  try {
    await rename(oldAbs, newAbs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new StorageNotFoundError(fileId);
    }
    throw err;
  }
  return { id: encodeId(newRel) };
}

export async function renameAndRetype(
  fileId: string,
  newName: string,
  _mimeType: string,
): Promise<{ id: string }> {
  sanitizeSegment(newName);
  const root = audioRoot();
  const oldRel = decodeId(fileId);
  const oldAbs = pathFromRel(root, oldRel);
  const lastSlash = oldRel.lastIndexOf('/');
  const newRel = lastSlash === -1 ? newName : `${oldRel.slice(0, lastSlash)}/${newName}`;
  const newAbs = pathFromRel(root, newRel);
  if (oldAbs !== newAbs) {
    try {
      await rename(oldAbs, newAbs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new StorageNotFoundError(fileId);
      }
      throw err;
    }
  }
  return { id: encodeId(newRel) };
}

// Reserved top-level directory holding trashed files/folders. The entry name
// inside it is the original encoded id, so untrashItem can move it back
// without needing a separate manifest.
const TRASH_DIR = '_trash';

function trashSlot(root: string, fileId: string): string {
  return resolve(join(root, TRASH_DIR, fileId));
}

export async function trashItem(fileId: string): Promise<void> {
  const root = audioRoot();
  const srcAbs = pathFromRel(root, decodeId(fileId));
  const dstAbs = trashSlot(root, fileId);
  await mkdir(join(root, TRASH_DIR), { recursive: true });
  try {
    await rename(srcAbs, dstAbs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new StorageNotFoundError(fileId);
    throw err;
  }
}

export async function untrashItem(fileId: string): Promise<void> {
  const root = audioRoot();
  const rel = decodeId(fileId);
  const srcAbs = trashSlot(root, fileId);
  const dstAbs = pathFromRel(root, rel);
  const lastSlash = rel.lastIndexOf('/');
  if (lastSlash !== -1) {
    await mkdir(pathFromRel(root, rel.slice(0, lastSlash)), { recursive: true });
  }
  try {
    await rename(srcAbs, dstAbs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new StorageNotFoundError(fileId);
    throw err;
  }
}

export async function getFile(
  fileId: string,
  range?: string,
): Promise<{ status: number; headers: Headers; body: ReadableStream<Uint8Array> }> {
  const root = audioRoot();
  const rel = decodeId(fileId);
  const abs = pathFromRel(root, rel);
  const s = await statOrNotFound(abs, fileId);
  if (!s.isFile()) {
    throw new Error(`storage: not a file: ${rel}`);
  }
  const total = s.size;
  const headers = new Headers();
  headers.set('Content-Type', guessMime(abs));
  headers.set('Accept-Ranges', 'bytes');
  const r = parseRange(range, total);
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
  sanitizeSegment(name);
  const root = audioRoot();
  const parentRel = relFromParentId(parentId);
  const childRel = parentRel === '' ? name : `${parentRel}/${name}`;
  const abs = pathFromRel(root, childRel);
  await mkdir(abs, { recursive: true });
  return { id: encodeId(childRel) };
}

export async function findFolderByName(
  name: string,
  parentId: string | 'root',
): Promise<{ id: string } | null> {
  return findEntry(name, parentId, 'folder');
}

export async function findFileByName(
  name: string,
  parentId: string,
): Promise<{ id: string } | null> {
  return findEntry(name, parentId, 'file');
}

async function findEntry(
  name: string,
  parentId: string | 'root',
  kind: 'file' | 'folder',
): Promise<{ id: string } | null> {
  sanitizeSegment(name);
  const root = audioRoot();
  const parentRel = relFromParentId(parentId);
  const childRel = parentRel === '' ? name : `${parentRel}/${name}`;
  const abs = pathFromRel(root, childRel);
  try {
    const s = await stat(abs);
    if (kind === 'folder' && !s.isDirectory()) return null;
    if (kind === 'file' && !s.isFile()) return null;
    return { id: encodeId(childRel) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function listFolder(
  parentFolderId: string,
): Promise<{ id: string; name: string }[]> {
  const root = audioRoot();
  const parentRel = decodeId(parentFolderId);
  const abs = pathFromRel(root, parentRel);
  const entries = await readdir(abs, { withFileTypes: true });
  // Hide reserved entries (currently just _trash) when listing the root.
  const visible =
    parentRel === '' ? entries.filter((e) => e.name !== TRASH_DIR) : entries;
  return visible.map((e) => ({
    id: encodeId(parentRel === '' ? e.name : `${parentRel}/${e.name}`),
    name: e.name,
  }));
}

export async function deleteFile(fileId: string): Promise<void> {
  const root = audioRoot();
  const abs = pathFromRel(root, decodeId(fileId));
  await rm(abs, { recursive: true, force: true });
}

export async function updateFile(
  fileId: string,
  _mimeType: string,
  body: Buffer,
): Promise<{ id: string; size: number }> {
  const root = audioRoot();
  const rel = decodeId(fileId);
  const abs = pathFromRel(root, rel);
  await writeFile(abs, body);
  return { id: fileId, size: body.length };
}

export async function uploadFile(
  parentFolderId: string,
  name: string,
  _mimeType: string,
  body: Buffer | ReadableStream<Uint8Array>,
): Promise<{ id: string; size: number }> {
  sanitizeSegment(name);
  const root = audioRoot();
  const parentRel = decodeId(parentFolderId);
  const childRel = parentRel === '' ? name : `${parentRel}/${name}`;
  const abs = pathFromRel(root, childRel);
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
  return { id: encodeId(childRel), size };
}
