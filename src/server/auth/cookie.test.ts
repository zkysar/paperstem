import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

async function freshImport() {
  vi.resetModules();
  return await import('./cookie.js');
}

function makeContext() {
  const headers = new Headers();
  return {
    res: {
      headers: {
        append(name: string, value: string) {
          headers.append(name, value);
        },
      },
    },
    req: {
      raw: {
        headers,
      },
    },
    header(name: string, value: string) {
      headers.append(name, value);
    },
    _headers: headers,
  } as unknown as Parameters<
    typeof import('./cookie.js')['setSessionCookie']
  >[0] & { _headers: Headers };
}

afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe('cookie module — dev', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  it('uses the dev cookie name without __Host- prefix', async () => {
    const mod = await freshImport();
    expect(mod.SESSION_COOKIE_NAME).toBe('paperstem_session_dev');
  });

  it('sets the cookie without Secure flag and with HttpOnly + SameSite=Lax', async () => {
    const mod = await freshImport();
    const c = makeContext();
    mod.setSessionCookie(c, 'abc123');
    const setCookie = c._headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('paperstem_session_dev=abc123');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).not.toContain('Secure');
  });
});

describe('cookie module — prod', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
  });

  it('uses the __Host- prefixed cookie name', async () => {
    const mod = await freshImport();
    expect(mod.SESSION_COOKIE_NAME).toBe('__Host-paperstem_session');
  });

  it('sets the cookie with Secure + HttpOnly + SameSite=Lax + Path=/', async () => {
    const mod = await freshImport();
    const c = makeContext();
    mod.setSessionCookie(c, 'abc123');
    const setCookie = c._headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('__Host-paperstem_session=abc123');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
  });
});
