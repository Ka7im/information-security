import { generateRsa } from '../src/users/rsa.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword,
  verifyPassword,
  generateChallenge,
  hashChallenge,
  createProof,
  verifyProof,
} from '../src/auth/crypto.js';
import { createClientProof } from '../../client/src/crypto.js';
test('Challenge size and browser/server proof agreement', async () => {
  assert.equal(generateChallenge().length, 16);
  const hash = hashChallenge(Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex'));
  assert.equal(hash, 'be45cb2605bf36bebde684841a28f0fd43c69850a3dce5fedba69928ee3a8991');
  for (const password of ['abc', 'пароль', ' пароль ']) {
    const expected = createProof(hashPassword(password), hash);
    assert.equal(await createClientProof(password, hash), expected);
    assert.equal(verifyProof(expected, expected), true);
    assert.equal(verifyProof('ff', expected), false);
    assert.equal(verifyProof('z'.repeat(64), expected), false);
    assert.equal(verifyProof('0'.repeat(64), expected), false);
  }
});
test('SHA-256 and exact password comparison', () => {
  assert.equal(
    hashPassword('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  assert.ok(verifyPassword('пароль ', hashPassword('пароль ')));
  assert.ok(!verifyPassword('пароль', hashPassword('пароль ')));
});
test('RSA uses valid 2048-bit parameters', async () => {
  const r = await generateRsa();
  const p = BigInt(r.p),
    q = BigInt(r.q),
    n = BigInt(r.n),
    e = BigInt(r.e),
    d = BigInt(r.d);
  const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
  assert.notEqual(p, q);
  assert.equal(n, p * q);
  assert.equal(n.toString(2).length, 2048);
  assert.equal(BigInt(r.phi), (p - 1n) * (q - 1n));
  assert.equal(e, 65537n);
  assert.equal((e * d) % (((p - 1n) * (q - 1n)) / gcd(p - 1n, q - 1n)), 1n);
});
