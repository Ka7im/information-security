import { createHash, generateKeyPair, timingSafeEqual, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import type { RsaParameters } from '@app/shared';
const generate = promisify(generateKeyPair);
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
export async function generateRsa(): Promise<RsaParameters> {
  const { privateKey } = await generate('rsa', { modulusLength: 2048, publicExponent: 65537 });
  const key = privateKey.export({ format: 'jwk' });
  const integer = (s: string | undefined) =>
    BigInt('0x' + Buffer.from(s!, 'base64url').toString('hex'));
  const p = integer(key.p),
    q = integer(key.q);
  return {
    p: String(p),
    q: String(q),
    n: String(integer(key.n)),
    phi: String((p - 1n) * (q - 1n)),
    e: String(integer(key.e)),
    d: String(integer(key.d)),
  };
}
