import { test } from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import { TelegramBot } from '../src/telegram/bot.js';

test('Telegram delivery sends code privately and sanitizes API failures', async () => {
  const calls: { url: string; payload: Record<string, unknown>; signal?: AbortSignal | null }[] =
    [];
  let mode = 'success';
  const bot = new TelegramBot(
    'secret-token',
    {} as pg.Pool,
    () => {},
    async (url, init) => {
      calls.push({
        url: String(url),
        payload: JSON.parse(init!.body as string),
        signal: init?.signal,
      });
      if (mode === 'timeout') throw new DOMException('secret-token', 'TimeoutError');
      if (mode === 'network') throw new Error('https://api.telegram.org/botsecret-token');
      return new Response(JSON.stringify({ ok: mode === 'success', result: {} }), {
        status: mode === 'http' ? 403 : 200,
      });
    },
  );
  const expiry = new Date('2026-09-27T12:10:00Z');
  await bot.sendCode('123', 'alice', '123456', expiry);
  assert.equal(calls[0].payload.chat_id, '123');
  assert.ok(String(calls[0].payload.text).includes('123456'));
  assert.ok(String(calls[0].payload.text).includes(expiry.toISOString()));
  assert.ok(calls[0].signal);
  for (mode of ['api', 'http', 'timeout', 'network']) {
    await assert.rejects(
      () => bot.sendCode('123', 'alice', '123456', expiry),
      (error: unknown) => {
        assert.equal((error as { code: string }).code, 'TELEGRAM_UNAVAILABLE');
        assert.ok(!String(error).includes('secret-token'));
        return true;
      },
    );
  }
  await bot.close();
  assert.equal(calls[0].signal!.aborted, true);
});

test('Polling confirms processed updates and stops on shutdown', async () => {
  const requests: { method: string; payload: Record<string, unknown> }[] = [];
  let reachedPoll: () => void = () => {};
  const polling = new Promise<void>((resolve) => {
    reachedPoll = resolve;
  });
  const bot = new TelegramBot(
    'test',
    {} as pg.Pool,
    () => {},
    async (url, init) => {
      const method = String(url).split('/').at(-1)!;
      const payload = JSON.parse(init!.body as string);
      requests.push({ method, payload });
      if (method === 'getMe')
        return new Response(JSON.stringify({ ok: true, result: { username: 'test_bot' } }));
      if (payload.offset === 0)
        return new Response(JSON.stringify({ ok: true, result: [{ update_id: 42 }] }));
      reachedPoll();
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(new Error('Stopped')), { once: true });
      });
    },
  );
  bot.start();
  await polling;
  await bot.close();
  assert.equal(requests.at(-1)!.payload.offset, 43);
});

test('An undeliverable /start reply does not block following updates', async () => {
  const bot = new TelegramBot(
    'test',
    {} as pg.Pool,
    () => {},
    async () => {
      return new Response(JSON.stringify({ ok: false }), { status: 403 });
    },
  );
  // Нет username: обращение к БД не требуется, проверяем ошибку ответа в чат.
  await bot.handleUpdate({
    update_id: 1,
    message: { text: '/start', chat: { id: 123, type: 'private' } },
  });
  await bot.handleUpdate({ update_id: 2 });
  await bot.close();
});
