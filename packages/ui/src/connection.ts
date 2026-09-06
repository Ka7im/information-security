import { useEffect, useRef, useState } from 'react';
import type { Operation, Operations, ServerMessage, AuthLog } from '@app/shared';
export class Connection {
  socket?: WebSocket;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private pending = new Map<
    string,
    {
      resolve: (data: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    private path: string,
    private status: (connected: boolean) => void,
    private changed: () => void,
    private logged: (entry: AuthLog) => void = () => {},
  ) {
    this.connect();
  }
  private connect() {
    const ws = new WebSocket(
      `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${this.path}`,
    );
    this.socket = ws;
    ws.onopen = () => this.status(true);
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as ServerMessage;
      if ('type' in message) {
        if (message.type === 'users.changed') this.changed();
        else this.logged(message.entry);
        return;
      }
      const item = this.pending.get(message.id);
      if (!item) return;
      clearTimeout(item.timer);
      this.pending.delete(message.id);
      if (message.ok) item.resolve(message.data);
      else
        item.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
    };
    ws.onclose = () => {
      this.status(false);
      for (const item of this.pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error('Соединение потеряно. Подключитесь и повторите операцию.'));
      }
      this.pending.clear();
      if (!this.stopped) this.timer = setTimeout(() => this.connect(), 1500);
    };
    ws.onerror = () => ws.close();
  }
  request<K extends Operation>(
    type: K,
    payload: Operations[K]['input'],
    id: string = crypto.randomUUID(),
  ): Promise<Operations[K]['output']> {
    if (this.socket?.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error('Нет подключения к серверу.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            'Сервер не ответил вовремя. Повторите запрос; при создании пользователя сначала проверьте список.',
          ),
        );
      }, 30000);
      this.pending.set(id, {
        resolve: (data) => resolve(data as Operations[K]['output']),
        reject,
        timer,
      });
      this.socket!.send(JSON.stringify({ id, type, payload }));
    });
  }
  close() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.socket?.close();
  }
}
export function useConnection(path: string) {
  const ref = useRef<Connection | null>(null);
  const [connected, setConnected] = useState(false);
  const [revision, setRevision] = useState(0);
  const [logs, setLogs] = useState<AuthLog[]>([]);
  const appendLog = (entry: AuthLog) => setLogs((previous) => [...previous, entry].slice(-500));
  useEffect(() => {
    const connection = new Connection(
      path,
      setConnected,
      () => setRevision((n) => n + 1),
      (entry) => setLogs((previous) => [...previous, entry].slice(-500)),
    );
    ref.current = connection;
    return () => {
      connection.close();
      ref.current = null;
    };
  }, [path]);
  return { connection: ref, connected, revision, logs, appendLog, clearLogs: () => setLogs([]) };
}
