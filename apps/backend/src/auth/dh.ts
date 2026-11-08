import { generatePrime, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  hashText,
  modPow,
  offerText,
  secret128,
  signText,
  validateRsa,
  validateShare,
  verifyText,
  type RsaPublicKey,
} from '@app/shared';
import { RequestError } from '../protocol/errors.js';
import type { AuthLogger } from './journal.js';

let group: Promise<bigint> | undefined;
export function dhPrime() {
  group ??= new Promise<bigint>((resolve, reject) => {
    generatePrime(2048, { safe: true, bigint: true }, (error, prime) => {
      if (error) {
        group = undefined;
        reject(error);
      } else resolve(prime);
    });
  });
  return group;
}
const decimal = z.string().regex(/^[1-9][0-9]{0,616}$/);
const initPayload = z
  .object({ clientKey: z.object({ n: decimal, e: z.literal('65537') }).strict() })
  .strict();
const completePayload = z
  .object({
    exchangeId: z.string().uuid(),
    B: decimal,
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    signature: decimal,
  })
  .strict();

export class DhSession {
  private pending?: { exchangeId: string; a: bigint; p: bigint; clientKey: RsaPublicKey };
  private generation = 0;
  private key?: string;
  constructor(
    private log: AuthLogger,
    private prime = dhPrime,
  ) {}
  clear() {
    this.generation++;
    this.pending = undefined;
    this.key = undefined;
  }
  async init(payload: unknown, serverKey: RsaPublicKey & { d: string }) {
    this.clear();
    const generation = this.generation;
    const { clientKey } = initPayload.parse(payload);
    try {
      validateRsa(clientKey);
    } catch {
      throw new RequestError('INVALID_REQUEST', 'Некорректный RSA-ключ клиента.');
    }
    const p = await this.prime();
    const a = secret128();
    const offer = {
      exchangeId: randomUUID(),
      A: String(modPow(4n, a, p)),
      g: '4',
      p: String(p),
      serverKey: { n: serverKey.n, e: serverKey.e },
    };
    const signed = await signText(offerText(offer), serverKey);
    if (generation !== this.generation) throw new RequestError('DH_CANCELLED', 'Обмен отменён.');
    this.pending = { exchangeId: offer.exchangeId, a, p, clientKey };
    this.log(
      7,
      `DH: A = g^a mod p = ${offer.A}; g = 4; p = ${p}; SHA-256(AGP) = ${signed.hash}; подпись сервера = ${signed.signature}`,
    );
    return { ...offer, ...signed };
  }
  async complete(payload: unknown) {
    const pending = this.pending;
    this.pending = undefined;
    const generation = this.generation;
    const data = completePayload.parse(payload);
    if (!pending || pending.exchangeId !== data.exchangeId)
      throw new RequestError('DH_REQUIRED', 'Начните новый обмен DH.');
    if (!(await verifyText(data.B, data, pending.clientKey))) {
      this.log(9, 'DH: подпись клиента неверна. Обмен прекращён.');
      throw new RequestError('DH_SIGNATURE_INVALID', 'Подпись клиента неверна.');
    }
    let B: bigint;
    try {
      B = validateShare(data.B, pending.p);
    } catch {
      throw new RequestError('INVALID_REQUEST', 'Недопустимый параметр B.');
    }
    const key = String(modPow(B, pending.a, pending.p));
    const keyHash = await hashText(key);
    if (generation !== this.generation) throw new RequestError('DH_CANCELLED', 'Обмен отменён.');
    this.key = key;
    this.log(
      9,
      `DH: B = ${data.B}; SHA-256(B) = ${data.hash}; подпись клиента = ${data.signature}. Подпись верна.`,
    );
    this.log(
      10,
      `DH: сервер вычислил K = B^a mod p; SHA-256(K) = ${keyHash}.`,
      ` K сервера = ${this.key}`,
    );
    return { keyHash };
  }
}
