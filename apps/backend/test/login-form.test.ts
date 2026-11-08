import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoginForm } from '../../client/src/components/LoginForm.js';

test('Login form requires a Telegram code only when the server requests it', () => {
  const noop = () => {};
  const props = {
    login: 'alice',
    setLogin: noop,
    password: '',
    setPassword: noop,
    telegramCode: '',
    setTelegramCode: noop,
    resend: async () => {},
    busy: false,
    connected: true,
    submit: async () => {},
    changeLogin: noop,
  };
  for (const telegramRequired of [false, true]) {
    const html = renderToStaticMarkup(
      createElement(LoginForm, {
        ...props,
        challenge: {
          challengeHash: 'a'.repeat(64),
          expiresAt: '2030-01-01T00:00:00Z',
          telegramRequired,
          telegramExpiresAt: telegramRequired ? '2030-01-01T00:00:00Z' : null,
        },
      }),
    );
    assert.ok(html.includes('type="password"'));
    assert.equal(html.includes('autoComplete="one-time-code"'), telegramRequired);
    assert.equal(html.includes('Отправить код повторно'), telegramRequired);
    assert.equal(html.includes('Проверка Telegram отключена'), !telegramRequired);
    assert.ok(!html.includes('Invalid Date'));
  }
});
