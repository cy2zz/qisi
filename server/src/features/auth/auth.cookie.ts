import type { CookieOptions } from 'express';

export const AUTH_COOKIE_NAME = 'qisi_user';

const LONG_LIVED_COOKIE_MS = 400 * 24 * 60 * 60 * 1000;

export function authCookieOptions(isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    maxAge: LONG_LIVED_COOKIE_MS,
    path: '/',
    sameSite: 'lax',
    secure: isProduction,
  };
}

export function readCookie(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) {
    return undefined;
  }

  for (const pair of cookieHeader.split(';')) {
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex < 0 || pair.slice(0, separatorIndex).trim() !== name) {
      continue;
    }

    try {
      return decodeURIComponent(pair.slice(separatorIndex + 1).trim());
    } catch {
      return undefined;
    }
  }

  return undefined;
}
