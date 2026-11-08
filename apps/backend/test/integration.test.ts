import { answerOffer, generateClientRsa } from '../../client/src/dh.js';
import { hashText } from '@app/shared';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import type { Operation, Operations } from '@app/shared';
import { config } from '../src/config.js';
import { createPool } from '../src/database/pool.js';
import { migrate } from '../src/database/migrations.js';
import { createApplication } from '../src/server.js';
import { hashPassword, createProof } from '../src/auth/crypto.js';
import type { AuthLog } from '@app/shared';
import { TelegramBot, unavailableTelegram, type TelegramSender } from '../src/telegram/bot.js';
import { RequestError } from '../src/protocol/errors.js';
test('PostgreSQL and WebSocket lifecycle', { timeout: 300000 }, async () => {
  const pool = createPool(config.databaseUrl);
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  await pool.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(config.databaseUrl);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const db = createPool(url.toString());
  let now = Date.now();
  const deliveries: { chatId: string; login: string; code: string; expiresAt: Date }[] = [];
  let failDelivery = false;
  let deliveryAdvance = 0;
  const telegram: TelegramSender = {
    async sendCode(chatId, login, code, expiresAt) {
      if (failDelivery) throw new RequestError('TELEGRAM_UNAVAILABLE', 'Telegram unavailable');
      deliveries.push({ chatId, login, code, expiresAt });
      now += deliveryAdvance;
    },
  };
  const lastCode = (login = 'alice') =>
    [...deliveries].reverse().find((item) => item.login === login)!.code;
  const app = createApplication(
    db,
    ['http://localhost:5173', 'http://localhost:5174'],
    () => now,
    telegram,
  );
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
        const timer = setTimeout(
          () => {
            ws.off('message', listener);
            reject(new Error('Response timeout'));
          },
          type === 'dh.init' ? 240000 : 5000,
        );
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
        proof: createProof(hashPassword(password), challenge.data.challengeHash, lastCode()),
      });
    }
    assert.equal((await request(client, 'dh.init', {})).error.code, 'UNAUTHORIZED');
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
    assert.equal(created.data.telegramLinked, false);
    // Password-only mode works without a Telegram binding or bot transport.
    const offline = createApplication(
      db,
      ['http://localhost:5173'],
      () => now,
      {
        async sendCode() {
          throw new Error('Telegram must not be contacted');
        },
      },
      false,
    );
    offline.http.listen(0, '127.0.0.1');
    await once(offline.http, 'listening');
    const offlineClient = new WebSocket(
      `ws://127.0.0.1:${(offline.http.address() as AddressInfo).port}/ws/client`,
      { origin: 'http://localhost:5173' },
    );
    sockets.push(offlineClient);
    try {
      await once(offlineClient, 'open');
      const challenge = await request(offlineClient, 'auth.challenge', { login: 'alice' });
      assert.equal(challenge.ok, true);
      assert.equal(challenge.data.telegramRequired, false);
      assert.equal(challenge.data.telegramExpiresAt, null);
      assert.equal(
        (await db.query('SELECT * FROM telegram_codes WHERE user_id=$1', [created.data.id]))
          .rowCount,
        0,
      );
      assert.equal(
        (
          await request(offlineClient, 'auth.login', {
            proof: createProof(hashPassword('bad'), challenge.data.challengeHash),
          })
        ).error.code,
        'INVALID_CREDENTIALS',
      );
      assert.equal(
        (
          await request(offlineClient, 'auth.login', {
            proof: createProof(hashPassword('abc'), challenge.data.challengeHash),
          })
        ).ok,
        true,
      );
      const key = await generateClientRsa();
      const offer = await request(offlineClient, 'dh.init', { clientKey: { n: key.n, e: key.e } });
      const answer = await answerOffer(offer.data, key);
      assert.equal(
        (await request(offlineClient, 'dh.complete', answer.payload)).data.keyHash,
        await hashText(answer.K),
      );
      await request(offlineClient, 'auth.logout');
      assert.equal((await request(offlineClient, 'auth.me')).error.code, 'UNAUTHORIZED');
      const expired = await request(offlineClient, 'auth.challenge', { login: 'alice' });
      const savedNow = now;
      now = Date.parse(expired.data.expiresAt);
      assert.equal(
        (
          await request(offlineClient, 'auth.login', {
            proof: createProof(hashPassword('abc'), expired.data.challengeHash),
          })
        ).error.code,
        'CHALLENGE_EXPIRED',
      );
      now = savedNow;
    } finally {
      offlineClient.terminate();
      await offline.close();
    }

    assert.equal(
      (await request(client, 'auth.challenge', { login: 'alice' })).error.code,
      'TELEGRAM_NOT_LINKED',
    );
    let changed = 0;
    const replies: { text: string }[] = [];
    const bot = new TelegramBot(
      'test-token',
      db,
      () => {
        changed++;
        app.usersChanged();
      },
      async (_url, init) => {
        replies.push(JSON.parse(init!.body as string));
        return new Response(JSON.stringify({ ok: true, result: {} }));
      },
    );
    const start = (username: string | undefined, id = 101, type = 'private') =>
      bot.handleUpdate({
        update_id: 1,
        message: { text: '/start', from: { id, username }, chat: { id, type } },
      });
    await start('alice', 101, 'group');
    assert.equal(changed, 0);
    await start(undefined);
    await start('missing');
    assert.equal(changed, 0);
    assert.equal(replies.length, 2);
    await start('ALICE');
    await start('alice');
    await start('bob', 102);
    assert.equal(changed, 3);
    await start('alice', 999);
    assert.equal(changed, 3);
    assert.equal(
      (await db.query("SELECT telegram_chat_id FROM users WHERE login='alice'")).rows[0]
        .telegram_chat_id,
      '101',
    );
    assert.ok((await request(admin, 'users.list')).data.every((user) => user.telegramLinked));
    await bot.close();
    await assert.rejects(() => unavailableTelegram.sendCode('101', 'alice', '123456', new Date()), {
      code: 'TELEGRAM_UNAVAILABLE',
    });
    failDelivery = true;
    assert.equal(
      (await request(client, 'auth.challenge', { login: 'alice' })).error.code,
      'TELEGRAM_UNAVAILABLE',
    );
    assert.equal(
      (await request(client, 'auth.login', { proof: '0'.repeat(64) })).error.code,
      'CHALLENGE_REQUIRED',
    );
    const storedBeforeRetry = (
      await db.query('SELECT code FROM telegram_codes WHERE user_id=$1', [created.data.id])
    ).rows[0].code;
    failDelivery = false;
    assert.equal(
      (await db.query('SELECT password_hash FROM users WHERE login=$1', ['alice'])).rows[0]
        .password_hash,
      hashPassword('abc'),
    );
    assert.equal((await login('bad')).error.code, 'INVALID_CREDENTIALS');
    const logged = await login('abc');
    assert.equal(lastCode(), storedBeforeRetry);
    assert.equal(deliveries.at(-1)!.chatId, '101');
    assert.match(lastCode(), /^[1-9][0-9]{5}$/);
    assert.deepEqual(Object.keys(logged.data).sort(), [
      'createdAt',
      'id',
      'login',
      'telegramLogin',
    ]);
    assert.equal((await request(client, 'auth.me')).data.login, 'alice');
    const rsaClient = await generateClientRsa();
    const dhInput = { clientKey: { n: rsaClient.n, e: rsaClient.e } };
    const dhOffer = await request(client, 'dh.init', dhInput);
    assert.equal(dhOffer.ok, true);
    assert.equal(dhOffer.data.serverKey.n, created.data.rsa.n);
    const dhAnswer = await answerOffer(dhOffer.data, rsaClient);
    const dhResult = await request(client, 'dh.complete', dhAnswer.payload);
    assert.equal(dhResult.ok, true);
    assert.equal(dhResult.data.keyHash, await hashText(dhAnswer.K));
    assert.equal(
      (await request(client, 'dh.complete', dhAnswer.payload)).error.code,
      'DH_REQUIRED',
    );
    const oldOffer = await request(client, 'dh.init', dhInput);
    const oldAnswer = await answerOffer(oldOffer.data, rsaClient);
    const newOffer = await request(client, 'dh.init', dhInput);
    assert.notEqual(oldOffer.data.exchangeId, newOffer.data.exchangeId);
    assert.equal(
      (await request(client, 'dh.complete', oldAnswer.payload)).error.code,
      'DH_REQUIRED',
    );
    assert.ok(!JSON.stringify(clientLogs).includes(dhAnswer.K));
    await request(admin, 'users.list');
    assert.ok(JSON.stringify(adminLogs).includes(dhAnswer.K));
    await request(client, 'auth.logout');
    assert.equal(
      (await request(client, 'dh.complete', dhAnswer.payload)).error.code,
      'UNAUTHORIZED',
    );
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
    await db.query('DELETE FROM telegram_codes WHERE user_id=$1', [created.data.id]);
    const [firstChallenge, secondChallenge] = await Promise.all([
      request(client, 'auth.challenge', { login: 'alice' }),
      request(second, 'auth.challenge', { login: 'alice' }),
    ]);
    assert.deepEqual(firstChallenge.data, secondChallenge.data);
    assert.deepEqual(Object.keys(firstChallenge.data).sort(), [
      'challengeHash',
      'expiresAt',
      'telegramExpiresAt',
      'telegramRequired',
    ]);
    assert.equal(Date.parse(firstChallenge.data.telegramExpiresAt!), now + 600000);
    const initialCode = lastCode();
    const initialProof = createProof(
      hashPassword('abc'),
      firstChallenge.data.challengeHash,
      initialCode,
    );
    assert.equal(
      (
        await request(client, 'auth.login', {
          proof: hashPassword(hashPassword('abc') + firstChallenge.data.challengeHash),
        })
      ).error.code,
      'INVALID_CREDENTIALS',
    );
    assert.equal(
      (
        await request(client, 'auth.login', {
          proof: createProof(
            hashPassword('abc'),
            firstChallenge.data.challengeHash,
            initialCode === '123456' ? '654321' : '123456',
          ),
        })
      ).error.code,
      'INVALID_CREDENTIALS',
    );
    now += 599999;
    assert.equal((await request(client, 'auth.login', { proof: initialProof })).ok, true);
    assert.equal(
      (await request(client, 'auth.login', { proof: initialProof })).error.code,
      'CHALLENGE_REQUIRED',
    );
    const reused = await request(client, 'auth.challenge', { login: 'alice' });
    assert.deepEqual(reused.data, firstChallenge.data);
    assert.equal(lastCode(), initialCode);
    now++;
    assert.equal(
      (await request(client, 'auth.login', { proof: initialProof })).error.code,
      'TELEGRAM_CODE_EXPIRED',
    );
    const nextCode = await request(client, 'auth.challenge', { login: 'alice' });
    assert.equal(nextCode.data.challengeHash, firstChallenge.data.challengeHash);
    assert.equal(Date.parse(nextCode.data.telegramExpiresAt!), now + 600000);
    assert.equal(
      (await request(second, 'auth.login', { proof: initialProof })).error.code,
      'TELEGRAM_CODE_EXPIRED',
    );
    deliveryAdvance = 600000;
    assert.equal(
      (await request(client, 'auth.challenge', { login: 'alice' })).error.code,
      'TELEGRAM_CODE_EXPIRED',
    );
    assert.equal(
      (await request(client, 'auth.login', { proof: initialProof })).error.code,
      'CHALLENGE_REQUIRED',
    );
    deliveryAdvance = 0;
    await request(client, 'auth.challenge', { login: 'alice' });
    const bobChallenge = await request(second, 'auth.challenge', { login: 'bob' });
    assert.notEqual(firstChallenge.data.challengeHash, bobChallenge.data.challengeHash);
    assert.equal(
      (
        await request(second, 'auth.login', {
          proof: createProof(hashPassword('abc'), firstChallenge.data.challengeHash, lastCode()),
        })
      ).error.code,
      'INVALID_CREDENTIALS',
    );
    now = Date.parse(firstChallenge.data.expiresAt);
    assert.equal(
      (
        await request(client, 'auth.login', {
          proof: createProof(hashPassword('abc'), firstChallenge.data.challengeHash, lastCode()),
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
    assert.ok(!JSON.stringify([...clientLogs, ...adminLogs]).includes(hashPassword(lastCode())));
    assert.ok(
      ![...clientLogs, ...adminLogs].some((entry) =>
        new RegExp(`\\b${lastCode()}\\b`).test(entry.message),
      ),
    );
    await request(admin, 'users.list');
    assert.ok(adminLogs.some((entry) => entry.message.includes(' t = ')));
    assert.ok(adminLogs.some((entry) => entry.message.includes(' H′ = ')));
    const restarted = createApplication(db, ['http://localhost:5173'], () => now, telegram);
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
