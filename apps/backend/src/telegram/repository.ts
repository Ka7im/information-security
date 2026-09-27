import { randomInt } from 'node:crypto';
import type pg from 'pg';
import { RequestError } from '../protocol/errors.js';

export interface TelegramCode {
  code: string;
  created_at: Date;
  expires_at: Date;
}

export async function bindTelegram(
  pool: pg.Pool,
  username: string,
  userId: string,
  chatId: string,
) {
  const result = await pool.query(
    `UPDATE users SET telegram_user_id=$2, telegram_chat_id=$3
     WHERE lower(ltrim(telegram_login, '@'))=lower($1)
       AND (telegram_user_id IS NULL OR telegram_user_id=$2) RETURNING id`,
    [username, userId, chatId],
  );
  return result.rowCount ?? 0;
}

export async function getTelegramCode(pool: pg.Pool, userId: string, now: () => number) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user = (
      await client.query<{ telegram_chat_id: string | null }>(
        'SELECT telegram_chat_id FROM users WHERE id=$1 FOR UPDATE',
        [userId],
      )
    ).rows[0];
    if (!user?.telegram_chat_id)
      throw new RequestError(
        'TELEGRAM_NOT_LINKED',
        'Сначала запустите Telegram-бота командой /start с аккаунта, указанного при регистрации.',
      );
    const timestamp = now();
    const existing = (
      await client.query<TelegramCode>('SELECT * FROM telegram_codes WHERE user_id=$1', [userId])
    ).rows[0];
    const code =
      existing && existing.expires_at.getTime() > timestamp
        ? existing
        : {
            code: String(randomInt(100000, 1000000)),
            created_at: new Date(timestamp),
            expires_at: new Date(timestamp + 600000),
          };
    if (code !== existing)
      await client.query(
        `INSERT INTO telegram_codes(user_id,code,created_at,expires_at) VALUES($1,$2,$3,$4)
       ON CONFLICT(user_id) DO UPDATE SET code=EXCLUDED.code, created_at=EXCLUDED.created_at, expires_at=EXCLUDED.expires_at`,
        [userId, code.code, code.created_at, code.expires_at],
      );
    await client.query('COMMIT');
    return { ...code, chatId: user.telegram_chat_id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
