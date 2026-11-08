export interface RsaPublicKey {
  n: string;
  e: string;
}
export interface SignedHash {
  hash: string;
  signature: string;
}
export interface DhOffer extends SignedHash {
  exchangeId: string;
  A: string;
  g: string;
  p: string;
  serverKey: RsaPublicKey;
}

export function integer(value: string): bigint {
  if (!/^[1-9][0-9]{0,616}$/.test(value)) throw new Error('Некорректное большое число.');
  return BigInt(value);
}
export function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  base %= modulus;
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * base) % modulus;
    base = (base * base) % modulus;
    exponent >>= 1n;
  }
  return result;
}
export function validateRsa(key: RsaPublicKey) {
  const n = integer(key.n);
  if (n.toString(2).length !== 2048 || n % 2n !== 1n || key.e !== '65537')
    throw new Error('Ожидается открытый ключ RSA-2048 с e=65537.');
}
export function validateShare(value: string, p: bigint) {
  const x = integer(value);
  if (x < 2n || x >= p - 1n || modPow(x, (p - 1n) / 2n, p) !== 1n)
    throw new Error('Недопустимый открытый параметр DH.');
  return x;
}
export function secret128(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[0] |= 128;
  return BigInt('0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''));
}
export async function hashText(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
export const offerText = (offer: Pick<DhOffer, 'A' | 'g' | 'p'>) =>
  JSON.stringify([offer.A, offer.g, offer.p]);
export async function signText(value: string, key: { n: string; d: string }): Promise<SignedHash> {
  const hash = await hashText(value);
  return { hash, signature: String(modPow(BigInt('0x' + hash), integer(key.d), integer(key.n))) };
}
export async function verifyText(value: string, signed: SignedHash, key: RsaPublicKey) {
  try {
    validateRsa(key);
    const hash = await hashText(value);
    const signature = integer(signed.signature);
    return (
      hash === signed.hash &&
      signature < BigInt(key.n) &&
      modPow(signature, BigInt(key.e), BigInt(key.n)) === BigInt('0x' + hash)
    );
  } catch {
    return false;
  }
}
