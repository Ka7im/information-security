import { AuthJournal } from '@app/ui/AuthJournal';
import { useAuth } from './hooks/useAuth';
import { LoginForm } from './components/LoginForm';
import { ProfileCard } from './components/ProfileCard';
export default function App() {
  const auth = useAuth();
  const { profile, connected, busy, error, logs, clearLogs } = auth;
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
          <ProfileCard profile={profile} disabled={busy || !connected} onLogout={auth.logout} />
        ) : (
          <LoginForm {...auth} />
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </section>
      {profile && (
        <section className="panel">
          <h2>Диффи — Хеллман с ЭЦП</h2>
          <p role="status">{auth.dhStatus}</p>
          {auth.sessionKey && (
            <p style={{ overflowWrap: 'anywhere' }}>K клиента = {auth.sessionKey}</p>
          )}
          <button disabled={busy || !connected} onClick={() => void auth.exchange()}>
            Повторить обмен DH
          </button>
        </section>
      )}
      <AuthJournal logs={logs} onClear={clearLogs} />
    </main>
  );
}
