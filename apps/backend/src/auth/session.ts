import type pg from 'pg';
import { RequestError } from '../protocol/errors.js';
import { challengePayload, proofPayload, emptyPayload } from '../protocol/schemas.js';
import { findUserById } from '../users/repository.js';
import { toProfile } from '../users/model.js';
import { getChallenge } from './challenge-repository.js';
import { hashChallenge, createProof, verifyProof } from './crypto.js';
import type { AuthLogger } from './journal.js';
import { getTelegramCode, type TelegramCode } from '../telegram/repository.js';
import { unavailableTelegram, type TelegramSender } from '../telegram/bot.js';

interface IssuedChallenge {
  userId: string;
  hash: string;
  expiresAt: number;
  telegramExpiresAt: number;
  telegramCreatedAt: number;
}

/** Авторизация и выданный challenge живут в пределах одного WebSocket. */
export class AuthSession {
  private userId?: string;
  private challenge?: IssuedChallenge;

  constructor(
    private pool: pg.Pool,
    private now: () => number,
    private isConnected: () => boolean,
    private log: AuthLogger,
    private telegram: TelegramSender = unavailableTelegram,
  ) {}

  clear() {
    this.userId = undefined;
    this.challenge = undefined;
  }

  async handle(type: string, payload: unknown) {
    switch (type) {
      case 'auth.challenge':
        return this.issueChallenge(payload);
      case 'auth.login':
        return this.login(payload);
      case 'auth.me':
        return this.currentProfile(payload);
      case 'auth.logout':
        emptyPayload.parse(payload);
        this.clear();
        return null;
      default:
        throw new RequestError('FORBIDDEN', 'Операция недоступна.');
    }
  }

  private async issueChallenge(payload: unknown) {
    this.clear();
    const { login } = challengePayload.parse(payload);
    this.log(1, `Получен логин: ${login}`);
    const result = await getChallenge(this.pool, login, this.now);
    if (!result)
      throw new RequestError('INVALID_CREDENTIALS', 'Пользователь с таким логином не найден.');
    const hash = hashChallenge(result.t);
    const expiresAt = result.expiresAt.toISOString();
    const telegram = await getTelegramCode(this.pool, result.userId, this.now);
    await this.telegram.sendCode(telegram.chatId, login, telegram.code, telegram.expires_at);
    const issued = {
      userId: result.userId,
      hash,
      expiresAt: result.expiresAt.getTime(),
      telegramExpiresAt: telegram.expires_at.getTime(),
      telegramCreatedAt: telegram.created_at.getTime(),
    };
    this.checkExpiration(issued);
    this.log(
      2,
      `${result.generated ? 'Сгенерировано' : 'Повторно используется'} t (128 бит), действует до ${expiresAt}.`,
      ` t = ${result.t.toString('hex')}`,
    );
    this.log(2, `Вычислено SHA-256(t) = ${hash}`);
    this.log(3, `Код отправлен в Telegram, действует до ${telegram.expires_at.toISOString()}.`);
    if (this.isConnected()) {
      this.challenge = issued;
    }
    this.log(3, `Отправка клиенту SHA-256(t) = ${hash}`);
    return { challengeHash: hash, expiresAt, telegramExpiresAt: telegram.expires_at.toISOString() };
  }

  private requireChallenge() {
    if (!this.challenge) throw new RequestError('CHALLENGE_REQUIRED', 'Сначала отправьте логин.');
    this.checkExpiration(this.challenge);
    return this.challenge;
  }

  private checkExpiration(challenge: IssuedChallenge) {
    if (this.now() >= challenge.expiresAt) {
      this.challenge = undefined;
      throw new RequestError('CHALLENGE_EXPIRED', 'Срок t истёк. Отправьте логин повторно.');
    }
    if (this.now() >= challenge.telegramExpiresAt) {
      this.challenge = undefined;
      throw new RequestError(
        'TELEGRAM_CODE_EXPIRED',
        'Срок Telegram-кода истёк. Запросите код повторно.',
      );
    }
  }

  private async login(payload: unknown) {
    this.userId = undefined;
    const { proof } = proofPayload.parse(payload);
    const challenge = this.requireChallenge();
    this.log(4, `Получено H = ${proof}`);
    const row = await findUserById(this.pool, challenge.userId);
    const code = (
      await this.pool.query<TelegramCode>('SELECT * FROM telegram_codes WHERE user_id=$1', [
        challenge.userId,
      ])
    ).rows[0];
    this.checkExpiration(challenge);
    if (
      !code ||
      code.created_at.getTime() !== challenge.telegramCreatedAt ||
      code.expires_at.getTime() !== challenge.telegramExpiresAt
    ) {
      this.challenge = undefined;
      throw new RequestError(
        'TELEGRAM_CODE_EXPIRED',
        'Telegram-код обновлён. Запросите код повторно.',
      );
    }
    const expected = createProof(row?.password_hash ?? '0'.repeat(64), challenge.hash, code.code);
    this.log(
      5,
      'Вычислено H′ = SHA-256(SHA-256(пароль из БД) + SHA-256(t) + SHA-256(tgМетка)).',
      ` H′ = ${expected}`,
    );
    const valid = verifyProof(proof, expected);
    // Запрос БД мог завершиться уже после истечения срока.
    this.checkExpiration(challenge);
    this.log(
      6,
      row && valid ? 'H′ = H. Вход выполнен, соединение авторизовано.' : 'H′ ≠ H. Вход отклонён.',
    );
    if (!row || !valid)
      throw new RequestError('INVALID_CREDENTIALS', 'Неверный пароль или Telegram-код.');
    this.challenge = undefined;
    if (this.isConnected()) this.userId = row.id;
    return toProfile(row);
  }

  private async currentProfile(payload: unknown) {
    emptyPayload.parse(payload);
    if (!this.userId) throw new RequestError('UNAUTHORIZED', 'Войдите в систему.');
    const row = await findUserById(this.pool, this.userId);
    if (!row) {
      this.userId = undefined;
      throw new RequestError('UNAUTHORIZED', 'Войдите в систему.');
    }
    return toProfile(row);
  }
}
