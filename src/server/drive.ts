const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FILES_BASE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3/files';
const REFRESH_SKEW_SECONDS = 30;
const RESUMABLE_THRESHOLD = 5 * 1024 * 1024;

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

export async function createFolder(
  name: string,
  parentId?: string,
): Promise<{ id: string }> {
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
  if (Buffer.isBuffer(body) && body.length <= RESUMABLE_THRESHOLD) {
    return uploadMultipart(parentFolderId, name, mimeType, body);
  }
  return uploadResumable(parentFolderId, name, mimeType, body);
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
