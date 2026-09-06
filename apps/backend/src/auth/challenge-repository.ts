import type pg from 'pg';
import { generateChallenge } from './crypto.js';
import type { UserRow } from '../users/model.js';
const CHALLENGE_LIFETIME_MS = 24 * 60 * 60 * 1000;

interface ChallengeRow {
  t: Buffer;
  expires_at: Date;
}

export async function getChallenge(pool: pg.Pool, login: string, now: () => number) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Блокируем пользователя: запись challenge при первом входе ещё может отсутствовать.
    const row = (
      await client.query<UserRow>('SELECT * FROM users WHERE login=$1 FOR UPDATE', [login])
    ).rows[0];
    if (!row) {
      await client.query('COMMIT');
      return undefined;
    }
    const timestamp = now();
    const existing = (
      await client.query<ChallengeRow>(
        'SELECT t, expires_at FROM auth_challenges WHERE user_id=$1',
        [row.id],
      )
    ).rows[0];
    const generated = !existing || existing.expires_at.getTime() <= timestamp;
    const challenge: ChallengeRow = generated
      ? { t: generateChallenge(), expires_at: new Date(timestamp + CHALLENGE_LIFETIME_MS) }
      : existing;
    if (generated) {
      await client.query(
        `INSERT INTO auth_challenges(user_id,t,created_at,expires_at) VALUES($1,$2,$3,$4)
        ON CONFLICT(user_id) DO UPDATE SET t=EXCLUDED.t, created_at=EXCLUDED.created_at, expires_at=EXCLUDED.expires_at`,
        [row.id, challenge.t, new Date(timestamp), challenge.expires_at],
      );
    }
    await client.query('COMMIT');
    return { userId: row.id, t: challenge.t, expiresAt: challenge.expires_at, generated };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
