/**
 * `users` row access for the v1 email + password auth flow (migration
 * 0005_auth.sql). Deliberately thin: no profile fields beyond `displayName`,
 * no email verification state.
 */
import { randomUUID } from 'node:crypto';

import { getPool } from '@/db/client';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string | null;
  createdAt: number;
}

interface UserRow extends Record<string, unknown> {
  id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  created_at: Date | string;
}

function toEpochMillis(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function toUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    createdAt: toEpochMillis(row.created_at),
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** A registration attempted an email address already in use. */
export class EmailAlreadyRegisteredError extends Error {
  override readonly name = 'EmailAlreadyRegisteredError';
}

export async function createUser(
  email: string,
  passwordHash: string,
  displayName?: string,
): Promise<UserRecord> {
  const id = randomUUID();
  try {
    const result = await getPool().query<UserRow>(
      `INSERT INTO users (id, email, password_hash, display_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, password_hash, display_name, created_at`,
      [id, normalizeEmail(email), passwordHash, displayName?.trim() || null],
    );
    return toUser(result.rows[0]!);
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505') {
      throw new EmailAlreadyRegisteredError(`email ${JSON.stringify(email)} is already registered`);
    }
    throw error;
  }
}

export async function findUserByEmail(email: string): Promise<UserRecord | undefined> {
  const result = await getPool().query<UserRow>(
    `SELECT id, email, password_hash, display_name, created_at
       FROM users
      WHERE email = $1`,
    [normalizeEmail(email)],
  );
  return result.rows[0] ? toUser(result.rows[0]) : undefined;
}

export async function findUserById(id: string): Promise<UserRecord | undefined> {
  const result = await getPool().query<UserRow>(
    `SELECT id, email, password_hash, display_name, created_at
       FROM users
      WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? toUser(result.rows[0]) : undefined;
}
