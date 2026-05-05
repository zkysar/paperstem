import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

const isProd = process.env.NODE_ENV === 'production';

export const SESSION_COOKIE_NAME = isProd
  ? '__Host-paperstem_session'
  : 'paperstem_session_dev';

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export function setSessionCookie(c: Context, sessionId: string): void {
  setCookie(c, SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function getSessionId(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE_NAME);
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: '/',
    secure: isProd,
    sameSite: 'Lax',
  });
}
