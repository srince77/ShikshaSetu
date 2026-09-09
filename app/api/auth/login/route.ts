/**
 * POST /api/auth/login — verify email + password, sign the caller in.
 *
 * Body: `{ email: string, password: string }`. Returns the same generic
 * "invalid email or password" message whether the email is unregistered or
 * the password is wrong — the login route must not double as an email
 * enumeration oracle.
 */
import { verifyPassword } from '@/lib/auth/password';
import { createAuthSession, sessionCookieHeader } from '@/lib/auth/session';
import { findUserByEmail } from '@/lib/auth/users';

export const runtime = 'nodejs';

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('invalid JSON body', 400);
  }
  if (typeof body !== 'object' || body === null) {
    return jsonError('request body must be a JSON object', 400);
  }
  const { email, password } = body as { email?: unknown; password?: unknown };
  if (typeof email !== 'string' || typeof password !== 'string' || email === '' || password === '') {
    return jsonError('email and password are required', 400);
  }

  const user = await findUserByEmail(email);
  const valid = user ? await verifyPassword(user.passwordHash, password) : false;
  if (!user || !valid) {
    return jsonError('invalid email or password', 401);
  }

  const session = await createAuthSession(user.id);
  return Response.json(
    { user: { id: user.id, email: user.email, displayName: user.displayName } },
    { status: 200, headers: { 'Set-Cookie': sessionCookieHeader(session) } },
  );
}
