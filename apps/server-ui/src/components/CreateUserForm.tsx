import type { UserManagementController } from '../hooks/useUserManagement';
import { RsaParameters } from './RsaParameters';
type CreateUserFormProps = Omit<UserManagementController, 'users' | 'logs' | 'clearLogs'>;
export function CreateUserForm({
  connected,
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
}: CreateUserFormProps) {
  return (
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
        {rsa && <RsaParameters value={rsa} />}
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
  );
}
