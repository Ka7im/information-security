import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import type { Operation, Operations } from '@app/shared';
import { config } from '../src/config.js';
import { createPool, migrate } from '../src/db.js';
import { createApplication } from '../src/server.js';
import { hashPassword, createProof } from '../src/crypto.js';
import type { AuthLog } from '@app/shared';
test('PostgreSQL and WebSocket lifecycle', { timeout: 30000 }, async () => {
  const pool = createPool(config.databaseUrl);
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  await pool.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(config.databaseUrl);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const db = createPool(url.toString());
  let now = Date.now();
  const app = createApplication(db, ['http://localhost:5173', 'http://localhost:5174'], () => now);
  const sockets: WebSocket[] = [];
  try {
    await migrate(db);
    await migrate(db);
    app.http.listen(0, '127.0.0.1');
    await once(app.http, 'listening');
    const port = (app.http.address() as AddressInfo).port;
    async function connect(path: string) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/${path}`, {
        origin: 'http://localhost:5173',
      });
      sockets.push(ws);
      await once(ws, 'open');
      return ws;
    }
    function request<K extends Operation>(
      ws: WebSocket,
      type: K,
      payload: unknown = {},
    ): Promise<{
      id: string;
      ok: boolean;
      data: Operations[K]['output'];
      error: { code: string; message: string };
    }> {
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.off('message', listener);
          reject(new Error('Response timeout'));
        }, 5000);
        const listener = (raw: Buffer) => {
          const msg = JSON.parse(raw.toString());
          if (msg.id === id) {
            clearTimeout(timer);
            ws.off('message', listener);
            resolve(msg);
          }
        };
        ws.on('message', listener);
        ws.send(JSON.stringify({ id, type, payload }));
      });
    }
    const admin = await connect('admin'),
      client = await connect('client');
    const clientLogs: AuthLog[] = [],
      adminLogs: AuthLog[] = [];
    for (const [socket, logs] of [
      [client, clientLogs],
      [admin, adminLogs],
    ] as const) {
      socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.type === 'auth.log') logs.push(message.entry);
      });
    }
    async function login(password: string) {
      const challenge = await request(client, 'auth.challenge', { login: 'alice' });
      return request(client, 'auth.login', {
        proof: createProof(hashPassword(password), challenge.data.challengeHash),
      });
    }
    assert.equal((await request(client, 'auth.me')).error.code, 'UNAUTHORIZED');
    assert.equal((await request(client, 'users.list')).error.code, 'FORBIDDEN');
    assert.equal(
      (
        await request(admin, 'users.create', {
          login: 'alice',
          password: 'abc',
          telegramLogin: '@alice',
        })
      ).error.code,
      'RSA_REQUIRED',
    );
    assert.equal((await request(admin, 'rsa.generate')).ok, true);
    const created = await request(admin, 'users.create', {
      login: 'alice',
      password: 'abc',
      telegramLogin: '@alice',
    });
    assert.equal(created.ok, true);
    assert.equal(created.data.telegramLogin, 'alice');
    assert.equal('password_hash' in created.data, false);
    await request(admin, 'rsa.generate');
    assert.equal(
      (
        await request(admin, 'users.create', {
          login: 'alice',
          password: 'other',
          telegramLogin: 'alice',
        })
      ).error.code,
      'LOGIN_EXISTS',
    );
    assert.equal(
      (
        await request(admin, 'users.create', {
          login: 'bob',
          password: 'abc',
          telegramLogin: 'bob',
        })
      ).ok,
      true,
    );
    assert.equal((await request(admin, 'users.list')).data.length, 2);
    assert.equal(
      (await db.query('SELECT password_hash FROM users WHERE login=$1', ['alice'])).rows[0]
        .password_hash,
      hashPassword('abc'),
    );
    assert.equal((await login('bad')).error.code, 'INVALID_CREDENTIALS');
    const logged = await login('abc');
    assert.deepEqual(Object.keys(logged.data).sort(), [
      'createdAt',
      'id',
      'login',
      'telegramLogin',
    ]);
    assert.equal((await request(client, 'auth.me')).data.login, 'alice');
    await request(client, 'auth.logout');
    assert.equal((await request(client, 'auth.me')).error.code, 'UNAUTHORIZED');
    const malformed = once(client, 'message');
    client.send('{');
    assert.equal(JSON.parse((await malformed)[0].toString()).error.code, 'INVALID_REQUEST');
    assert.equal(
      (await request(client, 'auth.login', { login: 'alice', password: 123 })).error.code,
      'INVALID_REQUEST',
    );
    assert.equal(
      (await request(client, 'auth.login', { login: 'alice', password: 'abc' })).error.code,
      'INVALID_REQUEST',
    );
    assert.equal(
      (await request(client, 'auth.login', { proof: '0'.repeat(64) })).error.code,
      'CHALLENGE_REQUIRED',
    );
    assert.equal(
      (await request(client, 'auth.challenge', { login: 'missing' })).error.code,
      'INVALID_CREDENTIALS',
    );
    const second = await connect('client');
    const [firstChallenge, secondChallenge] = await Promise.all([
      request(client, 'auth.challenge', { login: 'alice' }),
      request(second, 'auth.challenge', { login: 'alice' }),
    ]);
    assert.deepEqual(firstChallenge.data, secondChallenge.data);
    const bobChallenge = await request(second, 'auth.challenge', { login: 'bob' });
    assert.notEqual(firstChallenge.data.challengeHash, bobChallenge.data.challengeHash);
    assert.equal(
      (
        await request(second, 'auth.login', {
          proof: createProof(hashPassword('abc'), firstChallenge.data.challengeHash),
        })
      ).error.code,
      'INVALID_CREDENTIALS',
    );
    now = Date.parse(firstChallenge.data.expiresAt);
    assert.equal(
      (
        await request(client, 'auth.login', {
          proof: createProof(hashPassword('abc'), firstChallenge.data.challengeHash),
        })
      ).error.code,
      'CHALLENGE_EXPIRED',
    );
    const renewed = await request(client, 'auth.challenge', { login: 'alice' });
    assert.notEqual(renewed.data.challengeHash, firstChallenge.data.challengeHash);
    assert.equal(Date.parse(renewed.data.expiresAt), now + 86400000);
    assert.equal(
      (await request(client, 'auth.login', { proof: 'bad' })).error.code,
      'INVALID_REQUEST',
    );
    await login('abc');
    assert.ok(clientLogs.some((entry) => entry.step === 5));
    assert.ok(!clientLogs.some((entry) => /(?:t|H′) = [0-9a-f]{32}/.test(entry.message)));
    assert.ok(!JSON.stringify([...clientLogs, ...adminLogs]).includes(hashPassword('abc')));
    await request(admin, 'users.list');
    assert.ok(adminLogs.some((entry) => entry.message.includes(' t = ')));
    assert.ok(adminLogs.some((entry) => entry.message.includes(' H′ = ')));
    const restarted = createApplication(db, ['http://localhost:5173'], () => now);
    restarted.http.listen(0, '127.0.0.1');
    await once(restarted.http, 'listening');
    try {
      const ws = new WebSocket(
        `ws://127.0.0.1:${(restarted.http.address() as AddressInfo).port}/ws/client`,
        { origin: 'http://localhost:5173' },
      );
      sockets.push(ws);
      await once(ws, 'open');
      const persisted = await request(ws, 'auth.challenge', { login: 'alice' });
      assert.deepEqual(persisted.data, renewed.data);
    } finally {
      await restarted.close();
    }
    client.close();
    await once(client, 'close');
    assert.equal((await request(await connect('client'), 'auth.me')).error.code, 'UNAUTHORIZED');
    await db.query('ALTER TABLE users RENAME TO users_unavailable');
    assert.equal((await request(admin, 'users.list')).error.code, 'DATABASE_ERROR');
    await db.query('ALTER TABLE users_unavailable RENAME TO users');
    assert.equal((await request(admin, 'users.list')).data.length, 2);
  } finally {
    sockets.forEach((ws) => ws.terminate());
    await app.close();
    await db.end();
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  }
});
