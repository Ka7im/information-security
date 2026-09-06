import type { Profile, User, RsaParameters } from '@app/shared';
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
export function toProfile(row: UserRow): Profile {
  return {
    id: row.id,
    login: row.login,
    telegramLogin: row.telegram_login,
    createdAt: row.created_at.toISOString(),
  };
}
export function toUser(row: UserRow): User {
  const rsa: RsaParameters = { p: row.p, q: row.q, n: row.n, phi: row.phi, e: row.e, d: row.d };
  return { ...toProfile(row), rsa };
}
