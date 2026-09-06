import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type pg from 'pg';
import type { ServerMessage } from '@app/shared';
import { attachConnection, send } from './transport/connection.js';

/** Создаёт транспорт; операции и состояние соединений находятся в отдельных модулях. */
export function createApplication(pool: pg.Pool, origins: string[], now = Date.now) {
  const http = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const admins = new Set<WebSocket>();
  const broadcastToAdmins = (message: ServerMessage) => {
    for (const socket of admins) send(socket, message);
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
      ws.on('close', () => admins.delete(ws));
      attachConnection({ socket: ws, admin, pool, now, broadcastToAdmins });
    });
  });

  return {
    http,
    close: async () => {
      for (const socket of wss.clients) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
