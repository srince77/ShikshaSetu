/**
 * POST /api/auth/register — create a user account and sign the caller in.
 *
 * Body: `{ email: string, password: string, displayName?: string }`.
 * No email verification, no OAuth, no password reset in v1 (see
 * lib/auth/password.ts).
 */
import { hashPassword } from '@/lib/auth/password';
import { createAuthSession, sessionCookieHeader } from '@/lib/auth/session';
import { EmailAlreadyRegisteredError, createUser } from '@/lib/auth/users';

export const runtime = 'nodejs';

const MIN_PASSWORD_LENGTH = 8;
const MAX_EMAIL_LENGTH = 320;
const MAX_DISPLAY_NAME_LENGTH = 120;

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
  const { email, password, displayName } = body as {
    email?: unknown;
    password?: unknown;
    displayName?: unknown;
  };
  if (typeof email !== 'string' || email.trim() === '' || email.length > MAX_EMAIL_LENGTH) {
    return jsonError('email is required', 400);
  }
  if (!email.includes('@')) {
    return jsonError('email must be a valid email address', 400);
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return jsonError(`password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400);
  }
  if (displayName !== undefined) {
    if (typeof displayName !== 'string' || displayName.length > MAX_DISPLAY_NAME_LENGTH) {
      return jsonError('displayName must be a string', 400);
    }
  }

  const passwordHash = await hashPassword(password);
  let user;
  try {
    user = await createUser(email, passwordHash, displayName as string | undefined);
  } catch (error) {
    if (error instanceof EmailAlreadyRegisteredError) {
      return jsonError('an account with this email already exists', 409);
    }
    throw error;
  }

  const session = await createAuthSession(user.id);
  return Response.json(
    { user: { id: user.id, email: user.email, displayName: user.displayName } },
    { status: 201, headers: { 'Set-Cookie': sessionCookieHeader(session) } },
  );
}
