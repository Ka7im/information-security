import { useEffect, useState, type FormEvent } from 'react';
import type { User, RsaParameters } from '@app/shared';
import { useConnection } from '@app/ui/connection';
import { AuthJournal } from '@app/ui/AuthJournal';
function Rsa({ value }: { value: RsaParameters }) {
  const [copied, setCopied] = useState('');
  return (
    <details className="rsa">
      <summary>Параметры RSA · 2048 бит</summary>
      {Object.entries(value).map(([key, text]) => (
        <div className="parameter" key={key}>
          <div className="parameter-head">
            <b>{key === 'phi' ? 'φ(n)' : key}</b>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                void navigator.clipboard
                  .writeText(text)
                  .then(() => setCopied(key))
                  .catch(() => setCopied('error'));
              }}
            >
              {copied === key ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
          <code>{text}</code>
        </div>
      ))}
      {copied === 'error' && <p role="alert">Не удалось скопировать. Выделите значение вручную.</p>}
    </details>
  );
}
export default function App() {
  const { connection, connected, revision, logs, clearLogs } = useConnection('/ws/admin');
  const [users, setUsers] = useState<User[]>([]);
  const [rsa, setRsa] = useState<RsaParameters>();
  const [login, setLogin] = useState(''),
    [password, setPassword] = useState(''),
    [telegramLogin, setTelegram] = useState('');
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const [error, setError] = useState(''),
    [success, setSuccess] = useState('');
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
      setUsers((previous) => [created, ...previous.filter((u) => u.id !== created.id)]);
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
  return (
    <main>
      <header>
        <div>
          <div className="eyebrow">Информационная безопасность / Сервер</div>
          <h1>Управление пользователями</h1>
          <p>Учётные записи и параметры RSA в одном месте.</p>
        </div>
        <span role="status" className={`status ${connected ? 'online' : ''}`}>
          ● {connected ? 'Сервер подключён' : 'Переподключение…'}
        </span>
      </header>
      <div className="grid">
        <section className="panel">
          <h2>Новый пользователь</h2>
          <form onSubmit={submit}>
            <label>
              Логин
              <input
                required
                maxLength={64}
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                autoComplete="off"
                disabled={busy}
              />
            </label>
            <label>
              Пароль
              <input
                required
                type="password"
                maxLength={1024}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                disabled={busy}
              />
            </label>
            <label>
              Telegram-логин
              <input
                required
                maxLength={65}
                placeholder="@username"
                value={telegramLogin}
                onChange={(e) => setTelegram(e.target.value)}
                disabled={busy}
              />
            </label>
            <div className="actions">
              <button
                type="button"
                className="secondary"
                disabled={!connected || busy || loading}
                onClick={() => void generate()}
              >
                {rsa ? 'Сгенерировать заново' : 'Сгенерировать RSA'}
              </button>
            </div>
            {rsa && <Rsa value={rsa} />}
            <div className="actions">
              <button disabled={!connected || busy || loading || !rsa}>
                {busy ? 'Обработка…' : 'Добавить пользователя'}
              </button>
            </div>
          </form>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {success && (
            <p className="success" role="status">
              {success}
            </p>
          )}
        </section>
        <section className="panel">
          <h2>
            Пользователи <span className="muted">· {users.length}</span>
          </h2>
          {!users.length && (
            <div className="empty">
              <p>{loading ? 'Загрузка…' : 'Пользователей пока нет'}</p>
              <small>Добавьте первую учётную запись через форму.</small>
            </div>
          )}
          {users.map((u) => (
            <article className="user" key={u.id}>
              <div className="user-top">
                <div>
                  <strong>{u.login}</strong>
                  <p>@{u.telegramLogin}</p>
                </div>
                <small>{new Date(u.createdAt).toLocaleString('ru-RU')}</small>
              </div>
              <Rsa value={u.rsa} />
            </article>
          ))}
        </section>
      </div>
      <AuthJournal logs={logs} onClear={clearLogs} />
    </main>
  );
}
