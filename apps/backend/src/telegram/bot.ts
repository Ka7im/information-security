import type pg from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { RequestError } from '../protocol/errors.js';
import { bindTelegram } from './repository.js';

export interface TelegramSender {
  sendCode(chatId: string, login: string, code: string, expiresAt: Date): Promise<void>;
}

export const unavailableTelegram: TelegramSender = {
  async sendCode() {
    throw new RequestError(
      'TELEGRAM_UNAVAILABLE',
      'Telegram-бот не настроен. Обратитесь к администратору.',
    );
  },
};

export interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    from?: { id: number; username?: string; is_bot?: boolean };
    chat: { id: number; type: string };
  };
}

export class TelegramBot implements TelegramSender {
  private abort = new AbortController();
  private task?: Promise<void>;
  constructor(
    private token: string,
    private pool: pg.Pool,
    private changed: () => void,
    private fetcher: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, payload: object, timeout = 10000): Promise<T> {
    try {
      const response = await this.fetcher(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(timeout)]),
      });
      const data = (await response.json()) as { ok: boolean; result: T };
      if (!response.ok || !data.ok) throw new Error('Telegram request failed');
      return data.result;
    } catch {
      throw new RequestError(
        'TELEGRAM_UNAVAILABLE',
        'Не удалось связаться с Telegram. Проверьте, что бот запущен и не заблокирован, затем повторите запрос.',
      );
    }
  }

  async sendCode(chatId: string, login: string, code: string, expiresAt: Date) {
    await this.call('sendMessage', {
      chat_id: chatId,
      text: `Код для входа в ${login}: ${code}\nДействует до ${expiresAt.toISOString()}. Повторная отправка не продлевает срок.`,
    });
  }

  async handleUpdate(update: TelegramUpdate) {
    const message = update.message;
    if (
      !message ||
      message.chat.type !== 'private' ||
      message.from?.is_bot ||
      !/^\/start(?:@\w+)?(?:\s|$)/.test(message.text ?? '')
    )
      return;
    let text = 'Установите username в настройках Telegram и повторите /start.';
    if (message.from?.username) {
      const count = await bindTelegram(
        this.pool,
        message.from.username,
        String(message.from.id),
        String(message.chat.id),
      );
      text = count
        ? 'Telegram привязан. Теперь запросите код в клиенте приложения.'
        : 'Нет доступной учётной записи с вашим Telegram username. Проверьте его при регистрации и повторите /start. Уже привязанный аккаунт другого владельца заменить нельзя.';
      if (count) this.changed();
    }
    try {
      await this.call('sendMessage', { chat_id: String(message.chat.id), text });
    } catch {
      // Привязка уже сохранена. Заблокировавший бота пользователь не должен
      // останавливать обработку команд остальных пользователей.
      console.error('Не удалось отправить ответ на /start. Пользователь может повторить команду.');
    }
  }

  start() {
    if (!this.task) this.task = this.poll();
  }

  private async poll() {
    let offset = 0;
    let identified = false;
    while (!this.abort.signal.aborted) {
      try {
        if (!identified) {
          const me = await this.call<{ username: string }>('getMe', {});
          console.log(
            `Telegram: https://t.me/${me.username} — выполните /start после создания пользователя.`,
          );
          identified = true;
        }
        const updates = await this.call<TelegramUpdate[]>(
          'getUpdates',
          { offset, timeout: 25, allowed_updates: ['message'] },
          30000,
        );
        for (const update of updates) {
          await this.handleUpdate(update);
          offset = update.update_id + 1;
        }
      } catch {
        if (this.abort.signal.aborted) break;
        console.error('Telegram временно недоступен; повтор через 5 секунд.');
        await delay(5000, undefined, { signal: this.abort.signal }).catch(() => {});
      }
    }
  }

  async close() {
    this.abort.abort();
    await this.task;
  }
}
