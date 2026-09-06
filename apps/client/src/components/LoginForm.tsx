import type { AuthController } from '../hooks/useAuth';
type LoginFormProps = Pick<
  AuthController,
  | 'login'
  | 'setLogin'
  | 'password'
  | 'setPassword'
  | 'challenge'
  | 'busy'
  | 'connected'
  | 'submit'
  | 'changeLogin'
>;
export function LoginForm({
  login,
  setLogin,
  password,
  setPassword,
  challenge,
  busy,
  connected,
  submit,
  changeLogin,
}: LoginFormProps) {
  return (
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
          <button type="button" className="secondary" disabled={busy} onClick={changeLogin}>
            Сменить логин
          </button>
        )}
      </div>
    </form>
  );
}
