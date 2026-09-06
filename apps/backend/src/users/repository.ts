import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Operations, RsaParameters } from '@app/shared';
import type { UserRow } from './model.js';

export async function findUserById(pool: pg.Pool, id: string) {
  return (await pool.query<UserRow>('SELECT * FROM users WHERE id=$1', [id])).rows[0];
}

export async function listUsers(pool: pg.Pool) {
  return (await pool.query<UserRow>('SELECT * FROM users ORDER BY created_at DESC, id')).rows;
}

export async function insertUser(
  pool: pg.Pool,
  input: Omit<Operations['users.create']['input'], 'password'>,
  passwordHash: string,
  rsa: RsaParameters,
) {
  // Профиль, хеш пароля и RSA сохраняются атомарно одним INSERT.
  const result = await pool.query<UserRow>(
    `INSERT INTO users (id,login,password_hash,telegram_login,p,q,n,phi,e,d)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      randomUUID(),
      input.login,
      passwordHash,
      input.telegramLogin,
      rsa.p,
      rsa.q,
      rsa.n,
      rsa.phi,
      rsa.e,
      rsa.d,
    ],
  );
  return result.rows[0];
}
