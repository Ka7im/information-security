import type { AuthController } from '../hooks/useAuth';
type LoginFormProps = Pick<
  AuthController,
  | 'login'
  | 'setLogin'
  | 'password'
  | 'setPassword'
  | 'telegramCode'
  | 'setTelegramCode'
  | 'resend'
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
  telegramCode,
  setTelegramCode,
  resend,
  challenge,
  busy,
  connected,
  submit,
  changeLogin,
}: LoginFormProps) {
  return (
    <form onSubmit={submit}>
      <h2>Добро пожаловать</h2>
      <p>
        {challenge?.telegramRequired === false
          ? 'Проверка Telegram отключена на сервере. Для входа введите пароль.'
          : 'Если проверка Telegram включена, перед входом отправьте /start боту с аккаунта, указанного при регистрации. Ссылку на бота выдаёт администратор.'}
      </p>
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
          {challenge.telegramRequired && (
            <>
              <label>
                Код из Telegram
                <input
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  value={telegramCode}
                  onChange={(e) => setTelegramCode(e.target.value)}
                  disabled={busy}
                />
              </label>
              <p>
                Код действует до {new Date(challenge.telegramExpiresAt!).toLocaleString('ru-RU')}.
                Повторная отправка не продлевает срок.
              </p>
            </>
          )}
        </>
      )}
      <div className="actions">
        <button disabled={!connected || busy}>
          {busy ? 'Обработка…' : challenge ? 'Войти' : 'Продолжить'}
        </button>
        {challenge?.telegramRequired && (
          <button
            type="button"
            className="secondary"
            disabled={busy || !connected}
            onClick={resend}
          >
            Отправить код повторно
          </button>
        )}
        {challenge && (
          <button type="button" className="secondary" disabled={busy} onClick={changeLogin}>
            Сменить логин
          </button>
        )}
      </div>
    </form>
  );
}
