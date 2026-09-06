import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthLog } from '@app/shared';
import { Connection } from '../transport/Connection';

const MAX_LOG_ENTRIES = 500;

export function useConnection(path: string) {
  const ref = useRef<Connection | null>(null);
  const [connected, setConnected] = useState(false);
  const [revision, setRevision] = useState(0);
  const [logs, setLogs] = useState<AuthLog[]>([]);
  const appendLog = useCallback((entry: AuthLog) => {
    setLogs((previous) => [...previous, entry].slice(-MAX_LOG_ENTRIES));
  }, []);
  useEffect(() => {
    const connection = new Connection(
      path,
      setConnected,
      () => setRevision((n) => n + 1),
      appendLog,
    );
    ref.current = connection;
    return () => {
      connection.close();
      ref.current = null;
    };
  }, [path, appendLog]);
  return { connection: ref, connected, revision, logs, appendLog, clearLogs: () => setLogs([]) };
}
