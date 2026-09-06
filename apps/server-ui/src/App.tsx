import { AuthJournal } from '@app/ui/AuthJournal';
import { useUserManagement } from './hooks/useUserManagement';
import { CreateUserForm } from './components/CreateUserForm';
import { UserList } from './components/UserList';
export default function App() {
  const management = useUserManagement();
  const { connected, users, loading, logs, clearLogs } = management;
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
        <CreateUserForm {...management} />
        <UserList users={users} loading={loading} />
      </div>
      <AuthJournal logs={logs} onClear={clearLogs} />
    </main>
  );
}
