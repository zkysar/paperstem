import { Buffer } from 'node:buffer';
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

type StorageModule = typeof import('./storage.js');
let storage: StorageModule;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'paperstem-storage-test-'));
  process.env.PAPERSTEM_AUDIO_ROOT = root;
  storage = await import('./storage.js');
});

afterEach(async () => {
  delete process.env.PAPERSTEM_AUDIO_ROOT;
  await rm(root, { recursive: true, force: true });
});

function encode(rel: string): string {
  return Buffer.from(rel, 'utf8').toString('base64url');
}

async function readBody(body: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const reader = body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

describe('createFolder', () => {
  it('creates a folder at the root and returns its encoded id', async () => {
    const { id } = await storage.createFolder('band-a');
    expect(id).toBe(encode('band-a'));
    const s = await stat(join(root, 'band-a'));
    expect(s.isDirectory()).toBe(true);
  });

  it('creates a nested folder under a parent id', async () => {
    const parent = await storage.createFolder('band-a');
    const { id } = await storage.createFolder('proj-1', parent.id);
    expect(id).toBe(encode('band-a/proj-1'));
    const s = await stat(join(root, 'band-a', 'proj-1'));
    expect(s.isDirectory()).toBe(true);
  });

  it("treats parentId 'root' as the storage root", async () => {
    const { id } = await storage.createFolder('top', 'root');
    expect(id).toBe(encode('top'));
  });

  it('rejects path-traversal segments', async () => {
    await expect(storage.createFolder('..')).rejects.toThrow(/invalid path segment/);
    await expect(storage.createFolder('a/b')).rejects.toThrow(/invalid path segment/);
  });

  it('rejects names containing control characters (NUL, newline, etc.)', async () => {
    await expect(storage.createFolder('a\0b')).rejects.toThrow(/invalid path segment/);
    await expect(storage.createFolder('a\nb')).rejects.toThrow(/invalid path segment/);
    await expect(storage.createFolder('a\rb')).rejects.toThrow(/invalid path segment/);
    await expect(storage.createFolder('a\x1bb')).rejects.toThrow(/invalid path segment/);
    await expect(storage.createFolder('a\x7fb')).rejects.toThrow(/invalid path segment/);
  });
});

describe('uploadFile', () => {
  it('uploads a Buffer body and returns id + size', async () => {
    const folder = await storage.createFolder('band-a');
    const body = Buffer.from('hello world', 'utf8');
    const { id, size } = await storage.uploadFile(folder.id, 'mix.mp3', 'audio/mpeg', body);
    expect(id).toBe(encode('band-a/mix.mp3'));
    expect(size).toBe(body.length);
    const onDisk = await readFile(join(root, 'band-a', 'mix.mp3'));
    expect(onDisk.equals(body)).toBe(true);
  });

  it('uploads a streaming body', async () => {
    const folder = await storage.createFolder('band-a');
    const body = Buffer.from('streamed content');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(body);
        controller.close();
      },
    });
    const { id, size } = await storage.uploadFile(folder.id, 'a.wav', 'audio/wav', stream);
    expect(id).toBe(encode('band-a/a.wav'));
    expect(size).toBe(body.length);
    const onDisk = await readFile(join(root, 'band-a', 'a.wav'));
    expect(onDisk.equals(body)).toBe(true);
  });

  // Strict contract: uploadFile does NOT silently mkdir the parent. If the
  // parent_folder_id points to a path that doesn't exist on disk (stale DB
  // state, volume restore drift, manually deleted folder), the upload must
  // fail loudly so callers can surface the inconsistency rather than write
  // orphan files into a re-created ghost directory.
  it('throws when the parent folder does not exist and does not create it', async () => {
    const ghostId = encode('does-not-exist');
    await expect(
      storage.uploadFile(ghostId, 'a.mp3', 'audio/mpeg', Buffer.from('x')),
    ).rejects.toThrow();
    await expect(stat(join(root, 'does-not-exist'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

describe('getFile', () => {
  it('returns the full file body with audio mime + Content-Length', async () => {
    const folder = await storage.createFolder('b');
    const body = Buffer.from('abcdefghij');
    const { id } = await storage.uploadFile(folder.id, 'song.mp3', 'audio/mpeg', body);
    const { status, headers, body: stream } = await storage.getFile(id);
    expect(status).toBe(200);
    expect(headers.get('Content-Type')).toBe('audio/mpeg');
    expect(headers.get('Content-Length')).toBe(String(body.length));
    expect(headers.get('Accept-Ranges')).toBe('bytes');
    const got = await readBody(stream);
    expect(got.equals(body)).toBe(true);
  });

  it('honors a Range header and returns 206 with the partial slice', async () => {
    const folder = await storage.createFolder('b');
    const body = Buffer.from('0123456789');
    const { id } = await storage.uploadFile(folder.id, 'a.mp3', 'audio/mpeg', body);
    const { status, headers, body: stream } = await storage.getFile(id, 'bytes=2-5');
    expect(status).toBe(206);
    expect(headers.get('Content-Range')).toBe(`bytes 2-5/${body.length}`);
    expect(headers.get('Content-Length')).toBe('4');
    const got = await readBody(stream);
    expect(got.toString('utf8')).toBe('2345');
  });

  it('throws StorageNotFoundError for a missing file', async () => {
    const missing = encode('band-a/nope.mp3');
    await expect(storage.getFile(missing)).rejects.toBeInstanceOf(
      storage.StorageNotFoundError,
    );
  });
});

describe('listFolder', () => {
  it('lists the contents of a folder with their ids', async () => {
    const folder = await storage.createFolder('b');
    await storage.uploadFile(folder.id, 'one.mp3', 'audio/mpeg', Buffer.from('1'));
    await storage.uploadFile(folder.id, 'two.mp3', 'audio/mpeg', Buffer.from('2'));
    await storage.createFolder('sub', folder.id);
    const entries = await storage.listFolder(folder.id);
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(['one.mp3', 'sub', 'two.mp3']);
    const oneEntry = entries.find((e) => e.name === 'one.mp3')!;
    expect(oneEntry.id).toBe(encode('b/one.mp3'));
  });
});

describe('findFolderByName / findFileByName', () => {
  it('returns the id when the entry exists with the right kind', async () => {
    const folder = await storage.createFolder('b');
    await storage.uploadFile(folder.id, 'song.mp3', 'audio/mpeg', Buffer.from('x'));
    const found = await storage.findFileByName('song.mp3', folder.id);
    expect(found?.id).toBe(encode('b/song.mp3'));
    const foundFolder = await storage.findFolderByName('b', 'root');
    expect(foundFolder?.id).toBe(encode('b'));
  });

  it('returns null when the entry is missing', async () => {
    expect(await storage.findFolderByName('nope', 'root')).toBeNull();
    const folder = await storage.createFolder('b');
    expect(await storage.findFileByName('nope.mp3', folder.id)).toBeNull();
  });

  it('returns null when the kind does not match', async () => {
    const folder = await storage.createFolder('b');
    expect(await storage.findFileByName('b', 'root')).toBeNull();
    await storage.uploadFile(folder.id, 'x.mp3', 'audio/mpeg', Buffer.from('1'));
    expect(await storage.findFolderByName('x.mp3', folder.id)).toBeNull();
  });
});

describe('renameItem', () => {
  it('renames a file in place', async () => {
    const folder = await storage.createFolder('b');
    const { id } = await storage.uploadFile(folder.id, 'old.mp3', 'audio/mpeg', Buffer.from('z'));
    await storage.renameItem(id, 'new.mp3');
    await expect(stat(join(root, 'b', 'new.mp3'))).resolves.toBeTruthy();
    await expect(stat(join(root, 'b', 'old.mp3'))).rejects.toThrow();
  });

  it('throws StorageNotFoundError when the source is missing', async () => {
    await expect(storage.renameItem(encode('nope'), 'x')).rejects.toBeInstanceOf(
      storage.StorageNotFoundError,
    );
  });
});

describe('renameAndRetype', () => {
  it('renames the file and returns the new id', async () => {
    const folder = await storage.createFolder('b');
    const { id } = await storage.uploadFile(folder.id, 'old.wav', 'audio/wav', Buffer.from('z'));
    const { id: newId } = await storage.renameAndRetype(id, 'new.mp3', 'audio/mpeg');
    expect(newId).toBe(encode('b/new.mp3'));
    await expect(stat(join(root, 'b', 'new.mp3'))).resolves.toBeTruthy();
  });
});

describe('trashItem / untrashItem', () => {
  it('trashItem moves the file to _trash/ and untrashItem restores it', async () => {
    const folder = await storage.createFolder('b');
    const { id } = await storage.uploadFile(folder.id, 'a.mp3', 'audio/mpeg', Buffer.from('x'));

    await storage.trashItem(id);
    await expect(stat(join(root, 'b', 'a.mp3'))).rejects.toThrow();
    await expect(stat(join(root, '_trash', id))).resolves.toBeTruthy();

    await storage.untrashItem(id);
    await expect(stat(join(root, 'b', 'a.mp3'))).resolves.toBeTruthy();
    await expect(stat(join(root, '_trash', id))).rejects.toThrow();
  });

  it('trashItem on a folder moves it (and its contents) to _trash/', async () => {
    const folder = await storage.createFolder('b');
    await storage.uploadFile(folder.id, 'a.mp3', 'audio/mpeg', Buffer.from('x'));

    await storage.trashItem(folder.id);
    await expect(stat(join(root, 'b'))).rejects.toThrow();
    await expect(stat(join(root, '_trash', folder.id, 'a.mp3'))).resolves.toBeTruthy();

    await storage.untrashItem(folder.id);
    await expect(stat(join(root, 'b', 'a.mp3'))).resolves.toBeTruthy();
  });

  it('untrashItem recreates the parent directory if it was removed', async () => {
    const band = await storage.createFolder('b');
    const project = await storage.createFolder('p', band.id);
    const { id } = await storage.uploadFile(project.id, 'a.mp3', 'audio/mpeg', Buffer.from('x'));

    await storage.trashItem(id);
    await storage.deleteFile(project.id); // remove the parent while file is in trash

    await storage.untrashItem(id);
    await expect(stat(join(root, 'b', 'p', 'a.mp3'))).resolves.toBeTruthy();
  });

  it('trashItem throws StorageNotFoundError when source does not exist', async () => {
    await expect(storage.trashItem(encode('does/not/exist'))).rejects.toThrow(
      storage.StorageNotFoundError,
    );
  });

  it('untrashItem throws StorageNotFoundError when nothing is in trash for that id', async () => {
    await expect(storage.untrashItem(encode('also/missing'))).rejects.toThrow(
      storage.StorageNotFoundError,
    );
  });

  it('listFolder hides the _trash directory at the root', async () => {
    const band = await storage.createFolder('b');
    const { id } = await storage.uploadFile(band.id, 'a.mp3', 'audio/mpeg', Buffer.from('x'));
    await storage.trashItem(id);

    const rootEntries = await storage.listFolder(encode(''));
    expect(rootEntries.map((e) => e.name)).toEqual(['b']);
  });
});

describe('deleteFile', () => {
  it('removes a file', async () => {
    const folder = await storage.createFolder('b');
    const { id } = await storage.uploadFile(folder.id, 'a.mp3', 'audio/mpeg', Buffer.from('x'));
    await storage.deleteFile(id);
    await expect(stat(join(root, 'b', 'a.mp3'))).rejects.toThrow();
  });

  it('does not throw when the file is already gone (rm force)', async () => {
    await expect(storage.deleteFile(encode('nope'))).resolves.toBeUndefined();
  });

  it('recursively removes a folder', async () => {
    const folder = await storage.createFolder('b');
    await storage.uploadFile(folder.id, 'a.mp3', 'audio/mpeg', Buffer.from('x'));
    await storage.deleteFile(folder.id);
    await expect(stat(join(root, 'b'))).rejects.toThrow();
  });
});

describe('updateFile', () => {
  it('overwrites the file with new bytes', async () => {
    const folder = await storage.createFolder('b');
    const { id } = await storage.uploadFile(folder.id, 'a.mp3', 'audio/mpeg', Buffer.from('old'));
    const newBody = Buffer.from('fresh contents');
    const res = await storage.updateFile(id, 'audio/mpeg', newBody);
    expect(res.id).toBe(id);
    expect(res.size).toBe(newBody.length);
    const onDisk = await readFile(join(root, 'b', 'a.mp3'));
    expect(onDisk.equals(newBody)).toBe(true);
  });
});

describe('environment guard', () => {
  it('throws when PAPERSTEM_AUDIO_ROOT is unset', async () => {
    delete process.env.PAPERSTEM_AUDIO_ROOT;
    await expect(storage.createFolder('x')).rejects.toThrow(/PAPERSTEM_AUDIO_ROOT/);
  });
});

describe('path-traversal hardening', () => {
  it('rejects ids whose decoded path escapes the root', async () => {
    // 'a/../../escape' base64url-encoded
    const bad = encode('../escape');
    await expect(storage.getFile(bad)).rejects.toThrow(/path escapes root|invalid path segment/);
  });

  // Ensure mkdir + write inside the root, not above it
  it('keeps writes contained even when given suspicious names', async () => {
    await mkdir(join(root, 'sibling'), { recursive: true });
    await writeFile(join(root, 'sibling', 'unrelated'), 'untouched');
    await expect(
      storage.createFolder('..', 'root'),
    ).rejects.toThrow(/invalid path segment/);
    const onDisk = await readFile(join(root, 'sibling', 'unrelated'));
    expect(onDisk.toString('utf8')).toBe('untouched');
  });
});
