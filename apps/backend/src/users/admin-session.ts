import type pg from 'pg';
import type { RsaParameters } from '@app/shared';
import { hashPassword } from '../auth/crypto.js';
import { RequestError } from '../protocol/errors.js';
import { createUserPayload, emptyPayload } from '../protocol/schemas.js';
import { generateRsa } from './rsa.js';
import { insertUser, listUsers } from './repository.js';
import { toUser } from './model.js';

/** Черновик RSA принадлежит одному соединению администратора. */
export class AdminSession {
  private draft?: RsaParameters;

  constructor(
    private pool: pg.Pool,
    private isConnected: () => boolean,
  ) {}

  clear() {
    this.draft = undefined;
  }

  async handle(type: string, payload: unknown) {
    switch (type) {
      case 'rsa.generate':
        return this.generate(payload);
      case 'users.create':
        return this.createUser(payload);
      case 'users.list':
        emptyPayload.parse(payload);
        return (await listUsers(this.pool)).map(toUser);
      default:
        throw new RequestError('FORBIDDEN', 'Операция недоступна.');
    }
  }

  private async generate(payload: unknown) {
    emptyPayload.parse(payload);
    const rsa = await generateRsa();
    if (this.isConnected()) this.draft = rsa;
    return rsa;
  }

  private async createUser(payload: unknown) {
    const input = createUserPayload.parse(payload);
    if (!this.draft) throw new RequestError('RSA_REQUIRED', 'Сначала сгенерируйте параметры RSA.');
    const row = await insertUser(this.pool, input, hashPassword(input.password), this.draft);
    this.clear();
    return toUser(row);
  }
}
