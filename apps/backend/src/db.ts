import pg from 'pg';
import type { Profile, User, RsaParameters } from '@app/shared';
import { generateChallenge } from './crypto.js';
export const createPool = (connectionString: string) =>
  new pg.Pool({ connectionString, connectionTimeoutMillis: 5000 });
export async function migrate(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(746192)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await client.query('SELECT version FROM schema_migrations WHERE version = 1');
    if (!applied.rowCount) {
      await client.query(`CREATE TABLE users (
        id uuid PRIMARY KEY, login text NOT NULL UNIQUE, password_hash char(64) NOT NULL,
        telegram_login text NOT NULL, p text NOT NULL, q text NOT NULL, n text NOT NULL,
        phi text NOT NULL, e text NOT NULL, d text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      )`);
      await client.query('INSERT INTO schema_migrations(version) VALUES (1)');
    }
    const challengeMigration = await client.query(
      'SELECT version FROM schema_migrations WHERE version = 2',
    );
    if (!challengeMigration.rowCount) {
      await client.query(`CREATE TABLE auth_challenges (
        user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        t bytea NOT NULL CHECK (octet_length(t) = 16),
        created_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL
      )`);
      await client.query('INSERT INTO schema_migrations(version) VALUES (2)');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function getChallenge(pool: pg.Pool, login: string, now: () => number) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (
      await client.query<UserRow>('SELECT * FROM users WHERE login=$1 FOR UPDATE', [login])
    ).rows[0];
    if (!row) {
      await client.query('COMMIT');
      return undefined;
    }
    const timestamp = now();
    let challenge = (
      await client.query<{ t: Buffer; expires_at: Date }>(
        'SELECT t, expires_at FROM auth_challenges WHERE user_id=$1',
        [row.id],
      )
    ).rows[0];
    const generated = !challenge || challenge.expires_at.getTime() <= timestamp;
    if (generated) {
      challenge = { t: generateChallenge(), expires_at: new Date(timestamp + 24 * 60 * 60 * 1000) };
      await client.query(
        `INSERT INTO auth_challenges(user_id,t,created_at,expires_at) VALUES($1,$2,$3,$4)
        ON CONFLICT(user_id) DO UPDATE SET t=EXCLUDED.t, created_at=EXCLUDED.created_at, expires_at=EXCLUDED.expires_at`,
        [row.id, challenge.t, new Date(timestamp), challenge.expires_at],
      );
    }
    await client.query('COMMIT');
    return { userId: row.id, t: challenge!.t, expiresAt: challenge!.expires_at, generated };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export interface UserRow {
  id: string;
  login: string;
  password_hash: string;
  telegram_login: string;
  created_at: Date;
  p: string;
  q: string;
  n: string;
  phi: string;
  e: string;
  d: string;
}
export function profile(row: UserRow): Profile {
  return {
    id: row.id,
    login: row.login,
    telegramLogin: row.telegram_login,
    createdAt: row.created_at.toISOString(),
  };
}
export function user(row: UserRow): User {
  const rsa: RsaParameters = { p: row.p, q: row.q, n: row.n, phi: row.phi, e: row.e, d: row.d };
  return { ...profile(row), rsa };
}
