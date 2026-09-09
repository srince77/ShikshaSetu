/** POST /api/auth/logout — revoke the caller's session and clear the cookie. */
import { SESSION_COOKIE_NAME, clearSessionCookieHeader, revokeAuthSession } from '@/lib/auth/session';

export const runtime = 'nodejs';

function readCookie(headers: Headers, name: string): string | undefined {
  const encoded = headers.get('cookie');
  if (!encoded) return undefined;
  for (const item of encoded.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export async function POST(req: Request): Promise<Response> {
  const cookieValue = readCookie(req.headers, SESSION_COOKIE_NAME);
  await revokeAuthSession(cookieValue);
  return Response.json({ ok: true }, { status: 200, headers: { 'Set-Cookie': clearSessionCookieHeader() } });
}
