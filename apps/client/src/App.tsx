import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Profile, Challenge } from '@app/shared';
import { useConnection } from '@app/ui/connection';
import { AuthJournal } from '@app/ui/AuthJournal';
import { createClientProof } from './crypto';
export default function App() {
  const { connection, connected, logs, appendLog, clearLogs } = useConnection('/ws/client');
  const [challenge, setChallenge] = useState<Challenge>();
  const attempt = useRef('');
  const generation = useRef(0);
  const [profile, setProfile] = useState<Profile>();
  const [login, setLogin] = useState(''),
    [password, setPassword] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!connected) {
      setProfile(undefined);
      setPassword('');
      setChallenge(undefined);
      generation.current++;
    }
  }, [connected]);
  useEffect(() => {
    if (!challenge) return;
    const timer = setTimeout(
      () => {
        generation.current++;
        setChallenge(undefined);
        setPassword('');
        setError('Срок t истёк. Отправьте логин повторно.');
      },
      Math.max(0, Date.parse(challenge.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [challenge]);
  function log(step: number, message: string) {
    appendLog({
      id: crypto.randomUUID(),
      attemptId: attempt.current,
      time: new Date().toISOString(),
      side: 'client',
      step,
      message,
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const currentGeneration = generation.current;
    const transport = connection.current!;
    try {
      if (!challenge) {
        attempt.current = crypto.randomUUID();
        log(1, `Отправка логина: ${login.trim()}`);
        const received = await transport.request('auth.challenge', { login }, attempt.current);
        if (generation.current !== currentGeneration) return;
        setChallenge(received);
        log(
          3,
          `Получено SHA-256(t) = ${received.challengeHash}; действует до ${received.expiresAt}`,
        );
      } else {
        if (!crypto.subtle)
          throw new Error('Для вычисления SHA-256 откройте клиент через localhost или HTTPS.');
        log(4, 'Вычисление SHA-256(пароль), затем H = SHA-256(SHA-256(пароль) + SHA-256(t)).');
        const proof = await createClientProof(password, challenge.challengeHash);
        setPassword('');
        if (generation.current !== currentGeneration) return;
        log(4, `Вычислено и отправляется H = ${proof}`);
        const result = await transport.request('auth.login', { proof });
        if (generation.current !== currentGeneration) return;
        setProfile(result);
        setChallenge(undefined);
        log(6, 'Сервер подтвердил вход. Соединение авторизовано.');
      }
    } catch (e) {
      if (generation.current !== currentGeneration) return;
      const failure = e as Error & { code?: string };
      setError(failure.message);
      log(6, failure.message);
      if (['CHALLENGE_EXPIRED', 'CHALLENGE_REQUIRED'].includes(failure.code ?? ''))
        setChallenge(undefined);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    setError('');
    try {
      await connection.current!.request('auth.logout', {});
      setProfile(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="client">
      <header>
        <div className="eyebrow">Информационная безопасность / Клиент</div>
        <h1>{profile ? 'Ваш профиль' : 'Вход в систему'}</h1>
        <p>
          {profile
            ? 'Вы вошли в свою учётную запись.'
            : 'Используйте учётную запись, созданную на сервере.'}
        </p>
        <span role="status" className={`status ${connected ? 'online' : ''}`}>
          ●{' '}
          {connected
            ? profile
              ? 'Вход выполнен'
              : 'Подключено к серверу'
            : 'Переподключение… После подключения войдите снова.'}
        </span>
      </header>
      <section className="panel">
        {profile ? (
          <>
            <div className="profile-row">
              <span>Логин</span>
              <strong>{profile.login}</strong>
            </div>
            <div className="profile-row">
              <span>Telegram</span>
              <strong>@{profile.telegramLogin}</strong>
            </div>
            <div className="actions">
              <button
                className="secondary"
                disabled={busy || !connected}
                onClick={() => void logout()}
              >
                Выйти
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <h2>Добро пожаловать</h2>
            <label>
              Логин
              <input
                required
                maxLength={64}
                autoComplete="username"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                disabled={busy || !!challenge}
              />
            </label>
            {challenge && (
              <>
                <p className="challenge-value">
                  SHA-256(t): <code>{challenge.challengeHash}</code>
                  <br />
                  Действует до {new Date(challenge.expiresAt).toLocaleString('ru-RU')}
                </p>
                <label>
                  Пароль
                  <input
                    required
                    type="password"
                    maxLength={1024}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                  />
                </label>
              </>
            )}
            <div className="actions">
              <button disabled={!connected || busy}>
                {busy ? 'Обработка…' : challenge ? 'Войти' : 'Получить SHA-256(t)'}
              </button>
              {challenge && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    generation.current++;
                    setChallenge(undefined);
                    setPassword('');
                    setError('');
                  }}
                >
                  Сменить логин
                </button>
              )}
            </div>
          </form>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </section>
      <AuthJournal logs={logs} onClear={clearLogs} />
    </main>
  );
}
