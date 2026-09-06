import type { User } from '@app/shared';
import { RsaParameters } from './RsaParameters';
export function UserList({ users, loading }: { users: User[]; loading: boolean }) {
  return (
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
      {users.map((user) => (
        <article className="user" key={user.id}>
          <div className="user-top">
            <div>
              <strong>{user.login}</strong>
              <p>@{user.telegramLogin}</p>
            </div>
            <small>{new Date(user.createdAt).toLocaleString('ru-RU')}</small>
          </div>
          <RsaParameters value={user.rsa} />
        </article>
      ))}
    </section>
  );
}
