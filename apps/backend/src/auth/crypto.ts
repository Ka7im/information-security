import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';

export const hashPassword = (password: string): string =>
  createHash('sha256').update(password, 'utf8').digest('hex');

export const generateChallenge = () => randomBytes(16);

export const hashChallenge = (t: Buffer): string => createHash('sha256').update(t).digest('hex');

export const createProof = (passwordHash: string, challengeHash: string): string =>
  hashPassword(passwordHash + challengeHash);

export function verifyProof(proof: string, expected: string): boolean {
  return (
    /^[0-9a-f]{64}$/.test(proof) &&
    /^[0-9a-f]{64}$/.test(expected) &&
    timingSafeEqual(Buffer.from(proof, 'hex'), Buffer.from(expected, 'hex'))
  );
}

export function verifyPassword(password: string, hash: string): boolean {
  const actual = Buffer.from(hashPassword(password), 'hex');
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
