import { useEffect, useState, type FormEvent } from 'react';
import type { User, RsaParameters } from '@app/shared';
import { useConnection } from '@app/ui/connection';
export function useUserManagement() {
  const { connection, connected, revision, logs, clearLogs } = useConnection('/ws/admin');
  const [users, setUsers] = useState<User[]>([]);
  const [rsa, setRsa] = useState<RsaParameters>();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [telegramLogin, setTelegram] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  useEffect(() => {
    if (!connected) {
      setRsa(undefined);
      setPassword('');
      return;
    }
    let active = true;
    setLoading(true);
    connection
      .current!.request('users.list', {})
      .then((data) => {
        if (active) setUsers(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [connected, revision, connection]);
  async function generate() {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      setRsa(await connection.current!.request('rsa.generate', {}));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const created = await connection.current!.request('users.create', {
        login,
        password,
        telegramLogin,
      });
      setUsers((previous) => [created, ...previous.filter((user) => user.id !== created.id)]);
      setLogin('');
      setPassword('');
      setTelegram('');
      setRsa(undefined);
      setSuccess('Пользователь добавлен.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return {
    connected,
    logs,
    clearLogs,
    users,
    rsa,
    login,
    setLogin,
    password,
    setPassword,
    telegramLogin,
    setTelegram,
    busy,
    loading,
    error,
    success,
    generate,
    submit,
  };
}
export type UserManagementController = ReturnType<typeof useUserManagement>;
