import { z } from 'zod';
import { RequestError } from './errors.js';

const login = z.string().trim().min(1).max(64);
export const emptyPayload = z.object({}).strict();
export const challengePayload = z.object({ login }).strict();
export const proofPayload = z.object({ proof: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
export const createUserPayload = z
  .object({
    login,
    password: z.string().min(1).max(1024),
    telegramLogin: z
      .string()
      .trim()
      .transform((value) => value.replace(/^@/, ''))
      .pipe(z.string().min(1).max(64)),
  })
  .strict();

const envelope = z
  .object({
    id: z.string().min(1).max(100),
    type: z.string(),
    payload: z.unknown(),
  })
  .strict();

export function parseRequest(raw: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RequestError('INVALID_REQUEST', 'Некорректный JSON.');
  }
  return envelope.parse(parsed);
}
