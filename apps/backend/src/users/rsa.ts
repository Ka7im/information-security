import { generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';
import type { RsaParameters } from '@app/shared';
const generate = promisify(generateKeyPair);
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
