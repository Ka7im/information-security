import {
  integer,
  modPow,
  offerText,
  secret128,
  signText,
  validateShare,
  verifyText,
  type DhOffer,
} from '@app/shared';

export async function generateClientRsa() {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const decimal = (value: string) =>
    String(
      BigInt(
        '0x' +
          Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
            c.charCodeAt(0).toString(16).padStart(2, '0'),
          ).join(''),
      ),
    );
  return { n: decimal(jwk.n!), e: decimal(jwk.e!), d: decimal(jwk.d!) };
}

export async function answerOffer(offer: DhOffer, key: { n: string; d: string }) {
  if (!(await verifyText(offerText(offer), offer, offer.serverKey)))
    throw new Error('Подпись сервера неверна. Обмен прекращён.');
  const p = integer(offer.p);
  if (p.toString(2).length !== 2048 || p % 2n !== 1n || offer.g !== '4')
    throw new Error('Недопустимые параметры группы DH.');
  validateShare(offer.g, p);
  const A = validateShare(offer.A, p);
  const b = secret128();
  const B = String(modPow(4n, b, p));
  const K = String(modPow(A, b, p));
  return { K, payload: { exchangeId: offer.exchangeId, B, ...(await signText(B, key)) } };
}
