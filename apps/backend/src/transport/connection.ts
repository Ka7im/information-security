import { WebSocket } from 'ws';
import type pg from 'pg';
import type { ServerMessage } from '@app/shared';
import { AuthSession } from '../auth/session.js';
import { createAuthJournal } from '../auth/journal.js';
import { AdminSession } from '../users/admin-session.js';
import { RequestError, toResponseError } from '../protocol/errors.js';
import { parseRequest } from '../protocol/schemas.js';

export function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

interface ConnectionOptions {
  socket: WebSocket;
  admin: boolean;
  pool: pg.Pool;
  now: () => number;
  broadcastToAdmins: (message: ServerMessage) => void;
}

export function attachConnection({
  socket,
  admin,
  pool,
  now,
  broadcastToAdmins,
}: ConnectionOptions) {
  const journal = createAuthJournal(now, (clientEntry, serverEntry) => {
    send(socket, { type: 'auth.log', entry: clientEntry });
    broadcastToAdmins({ type: 'auth.log', entry: serverEntry });
  });
  const isConnected = () => socket.readyState === WebSocket.OPEN;
  const session = admin
    ? new AdminSession(pool, isConnected)
    : new AuthSession(pool, now, isConnected, journal.log);
  let busy = false;

  socket.on('error', () => {
    /* Состояние очищается обработчиком close. */
  });
  socket.on('close', () => session.clear());
  socket.on('message', async (raw) => {
    let id = '';
    let ownsBusy = false;
    let authRequest = false;
    try {
      const request = parseRequest(raw.toString());
      id = request.id;
      if (busy) throw new RequestError('BUSY', 'Дождитесь завершения предыдущего запроса.');
      busy = true;
      ownsBusy = true;
      authRequest = !admin && ['auth.challenge', 'auth.login'].includes(request.type);
      if (request.type === 'auth.challenge') journal.startAttempt(id);
      const data = await session.handle(request.type, request.payload);
      send(socket, { id, ok: true, data });
      if (admin && request.type === 'users.create') broadcastToAdmins({ type: 'users.changed' });
    } catch (error) {
      const responseError = toResponseError(error);
      if (authRequest) journal.log(6, `Ошибка ${responseError.code}: ${responseError.message}`);
      send(socket, { id, ok: false, error: responseError });
    } finally {
      // Отклонённый параллельный запрос не снимает блокировку текущего.
      if (ownsBusy) busy = false;
    }
  });
}
