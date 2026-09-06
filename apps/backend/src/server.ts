import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import type pg from 'pg';
import type { RsaParameters, AuthLog } from '@app/shared';
import { generateRsa, hashPassword, hashChallenge, createProof, verifyProof } from './crypto.js';
import { profile, user, getChallenge, type UserRow } from './db.js';

const credentials = z
  .object({ login: z.string().trim().min(1).max(64), password: z.string().min(1).max(1024) })
  .strict();
const createUser = credentials.extend({
  telegramLogin: z
    .string()
    .trim()
    .transform((s) => s.replace(/^@/, ''))
    .pipe(z.string().min(1).max(64)),
});
const envelope = z
  .object({ id: z.string().min(1).max(100), type: z.string(), payload: z.unknown() })
  .strict();
class RequestError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function createApplication(pool: pg.Pool, origins: string[], now = Date.now) {
  const http = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const admins = new Set<WebSocket>();
  const send = (ws: WebSocket, message: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };
  http.on('upgrade', (req, socket, head) => {
    if (
      !origins.includes(req.headers.origin ?? '') ||
      !['/ws/admin', '/ws/client'].includes(req.url ?? '')
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const admin = req.url === '/ws/admin';
      if (admin) admins.add(ws);
      let draft: RsaParameters | undefined;
      let session: string | undefined;
      let challenge: { userId: string; hash: string; expiresAt: number } | undefined;
      let attemptId = '';
      const log = (step: number, message: string, serverDetail = '') => {
        const entry: AuthLog = {
          id: randomUUID(),
          attemptId,
          time: new Date(now()).toISOString(),
          side: 'server',
          step,
          message,
        };
        send(ws, { type: 'auth.log', entry });
        for (const connection of admins)
          send(connection, {
            type: 'auth.log',
            entry: { ...entry, message: message + serverDetail },
          });
      };
      let busy = false;
      ws.on('error', () => {
        /* Connection cleanup is handled by the close event. */
      });
      ws.on('close', () => {
        admins.delete(ws);
        draft = undefined;
        session = undefined;
        challenge = undefined;
      });
      ws.on('message', async (raw) => {
        let id = '';
        let ownsBusy = false;
        let authRequest = false;
        try {
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw.toString());
          } catch {
            throw new RequestError('INVALID_REQUEST', 'Некорректный JSON.');
          }
          const request = envelope.parse(parsed);
          id = request.id;
          if (busy) throw new RequestError('BUSY', 'Дождитесь завершения предыдущего запроса.');
          busy = true;
          ownsBusy = true;
          authRequest = !admin && ['auth.challenge', 'auth.login'].includes(request.type);
          if (request.type === 'auth.challenge') attemptId = id;
          const allowed = admin
            ? ['rsa.generate', 'users.create', 'users.list']
            : ['auth.challenge', 'auth.login', 'auth.me', 'auth.logout'];
          if (!allowed.includes(request.type))
            throw new RequestError('FORBIDDEN', 'Операция недоступна.');
          let data: unknown;
          switch (request.type) {
            case 'rsa.generate':
              z.object({}).strict().parse(request.payload);
              data = await generateRsa();
              if (ws.readyState === WebSocket.OPEN) draft = data as RsaParameters;
              break;
            case 'users.create': {
              const input = createUser.parse(request.payload);
              if (!draft)
                throw new RequestError('RSA_REQUIRED', 'Сначала сгенерируйте параметры RSA.');
              const r = draft;
              // A single INSERT atomically stores the complete profile and RSA parameters.
              const result = await pool.query<UserRow>(
                `INSERT INTO users (id,login,password_hash,telegram_login,p,q,n,phi,e,d)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
                [
                  randomUUID(),
                  input.login,
                  hashPassword(input.password),
                  input.telegramLogin,
                  r.p,
                  r.q,
                  r.n,
                  r.phi,
                  r.e,
                  r.d,
                ],
              );
              data = user(result.rows[0]);
              draft = undefined;
              send(ws, { id, ok: true, data });
              for (const connection of admins) send(connection, { type: 'users.changed' });
              return;
            }
            case 'users.list': {
              z.object({}).strict().parse(request.payload);
              data = (
                await pool.query<UserRow>('SELECT * FROM users ORDER BY created_at DESC, id')
              ).rows.map(user);
              break;
            }
            case 'auth.challenge': {
              session = undefined;
              challenge = undefined;
              const input = z
                .object({ login: credentials.shape.login })
                .strict()
                .parse(request.payload);
              log(1, `Получен логин: ${input.login}`);
              const result = await getChallenge(pool, input.login, now);
              if (!result)
                throw new RequestError(
                  'INVALID_CREDENTIALS',
                  'Пользователь с таким логином не найден.',
                );
              const hash = hashChallenge(result.t);
              log(
                2,
                `${result.generated ? 'Сгенерировано' : 'Повторно используется'} t (128 бит), действует до ${result.expiresAt.toISOString()}.`,
                ` t = ${result.t.toString('hex')}`,
              );
              log(2, `Вычислено SHA-256(t) = ${hash}`);
              if (ws.readyState === WebSocket.OPEN)
                challenge = { userId: result.userId, hash, expiresAt: result.expiresAt.getTime() };
              data = { challengeHash: hash, expiresAt: result.expiresAt.toISOString() };
              log(3, `Отправка клиенту SHA-256(t) = ${hash}`);
              break;
            }
            case 'auth.login': {
              session = undefined;
              const input = z
                .object({ proof: z.string().regex(/^[0-9a-f]{64}$/) })
                .strict()
                .parse(request.payload);
              if (!challenge)
                throw new RequestError('CHALLENGE_REQUIRED', 'Сначала отправьте логин.');
              if (now() >= challenge.expiresAt) {
                challenge = undefined;
                throw new RequestError(
                  'CHALLENGE_EXPIRED',
                  'Срок t истёк. Отправьте логин повторно.',
                );
              }
              log(4, `Получено H = ${input.proof}`);
              const row = (
                await pool.query<UserRow>('SELECT * FROM users WHERE id=$1', [challenge.userId])
              ).rows[0];
              const expected = createProof(row?.password_hash ?? '0'.repeat(64), challenge.hash);
              log(
                5,
                'Вычислено H′ = SHA-256(SHA-256(пароль из БД) + SHA-256(t)).',
                ` H′ = ${expected}`,
              );
              const valid = verifyProof(input.proof, expected);
              if (now() >= challenge.expiresAt) {
                challenge = undefined;
                throw new RequestError(
                  'CHALLENGE_EXPIRED',
                  'Срок t истёк. Отправьте логин повторно.',
                );
              }
              log(
                6,
                row && valid
                  ? 'H′ = H. Вход выполнен, соединение авторизовано.'
                  : 'H′ ≠ H. Вход отклонён.',
              );
              if (!row || !valid)
                throw new RequestError('INVALID_CREDENTIALS', 'Неверный логин или пароль.');
              if (ws.readyState === WebSocket.OPEN) session = row.id;
              data = profile(row);
              break;
            }
            case 'auth.me': {
              z.object({}).strict().parse(request.payload);
              if (!session) throw new RequestError('UNAUTHORIZED', 'Войдите в систему.');
              const row = (await pool.query<UserRow>('SELECT * FROM users WHERE id=$1', [session]))
                .rows[0];
              if (!row) {
                session = undefined;
                throw new RequestError('UNAUTHORIZED', 'Войдите в систему.');
              }
              data = profile(row);
              break;
            }
            case 'auth.logout':
              z.object({}).strict().parse(request.payload);
              session = undefined;
              challenge = undefined;
              data = null;
              break;
          }
          send(ws, { id, ok: true, data });
        } catch (error) {
          let code = 'DATABASE_ERROR',
            message = 'Не удалось выполнить операцию. Попробуйте ещё раз.';
          if (error instanceof RequestError) {
            code = error.code;
            message = error.message;
          } else if (error instanceof z.ZodError) {
            code = 'INVALID_REQUEST';
            message = 'Проверьте заполнение полей и формат запроса.';
          } else if ((error as { code?: string }).code === '23505') {
            code = 'LOGIN_EXISTS';
            message = 'Этот логин уже занят.';
          }
          if (authRequest) log(6, `Ошибка ${code}: ${message}`);
          send(ws, { id, ok: false, error: { code, message } });
        } finally {
          if (ownsBusy) busy = false;
        }
      });
    });
  });
  return {
    http,
    close: async () => {
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
