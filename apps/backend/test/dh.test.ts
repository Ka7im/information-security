import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDiffieHellman } from 'node:crypto';
import {
  hashText,
  modPow,
  offerText,
  secret128,
  signText,
  validateShare,
  verifyText,
} from '@app/shared';
import { DhSession } from '../src/auth/dh.js';
import { generateRsa } from '../src/users/rsa.js';
import { answerOffer, generateClientRsa } from '../../client/src/dh.js';

const p = BigInt('0x' + getDiffieHellman('modp14').getPrime('hex'));
test('DH signatures, browser agreement, tampering and lifecycle', async () => {
  const server = await generateRsa();
  const client = await generateClientRsa();
  const clientKey = { n: client.n, e: client.e };
  const logs: string[] = [];
  const session = new DhSession(
    (_step, message, detail = '') => logs.push(message + detail),
    async () => p,
  );
  for (let i = 0; i < 20; i++) assert.equal(secret128().toString(2).length, 128);
  assert.equal(modPow(5n, 6n, 23n), 8n);
  const offer = await session.init({ clientKey }, server);
  assert.ok(await verifyText(offerText(offer), offer, server));
  for (const field of ['A', 'g', 'p'] as const) {
    await assert.rejects(
      answerOffer({ ...offer, [field]: String(BigInt(offer[field]) + 1n) }, client),
    );
  }
  await assert.rejects(answerOffer({ ...offer, hash: '0'.repeat(64) }, client));
  await assert.rejects(answerOffer({ ...offer, signature: '1' }, client));
  await assert.rejects(answerOffer({ ...offer, serverKey: clientKey }, client));
  const answer = await answerOffer(offer, client);
  assert.equal((await session.complete(answer.payload)).keyHash, await hashText(answer.K));
  assert.ok(logs.some((line) => line.includes(`K сервера = ${answer.K}`)));
  await assert.rejects(session.complete(answer.payload), { code: 'DH_REQUIRED' });
  for (const tamper of ['B', 'hash', 'signature', 'key']) {
    const next = await session.init({ clientKey }, server);
    const response = await answerOffer(next, client);
    if (tamper === 'B') response.payload.B = String(BigInt(response.payload.B) + 1n);
    if (tamper === 'hash') response.payload.hash = '0'.repeat(64);
    if (tamper === 'signature') response.payload.signature = '1';
    if (tamper === 'key')
      Object.assign(response.payload, await signText(response.payload.B, server));
    await assert.rejects(session.complete(response.payload), { code: 'DH_SIGNATURE_INVALID' });
    await assert.rejects(session.complete(response.payload), { code: 'DH_REQUIRED' });
  }
  const old = await answerOffer(await session.init({ clientKey }, server), client);
  const other = new DhSession(
    () => {},
    async () => p,
  );
  await other.init({ clientKey }, server);
  await assert.rejects(other.complete(old.payload), { code: 'DH_REQUIRED' });
  session.clear();
  await assert.rejects(session.complete(old.payload), { code: 'DH_REQUIRED' });
  const init = session.init({ clientKey }, server);
  session.clear();
  await assert.rejects(init, { code: 'DH_CANCELLED' });
  for (const value of ['0', '1', String(p - 1n), String(p), '-1', '01', '9'.repeat(618)])
    assert.throws(() => validateShare(value, p));
});
