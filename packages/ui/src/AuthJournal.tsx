import type { AuthLog } from '@app/shared';

export function AuthJournal({ logs, onClear }: { logs: AuthLog[]; onClear: () => void }) {
  return (
    <section className="panel auth-journal">
      <div className="parameter-head">
        <h2>Журнал авторизации</h2>
        <button type="button" className="secondary" onClick={onClear}>
          Очистить
        </button>
      </div>
      <div role="log" aria-live="polite" aria-label="Этапы авторизации">
        {!logs.length && <p className="muted">Здесь появятся этапы входа.</p>}
        {logs.map((entry) => (
          <article key={entry.id}>
            <small>
              {new Date(entry.time).toLocaleTimeString('ru-RU')} ·{' '}
              {entry.side === 'client' ? 'Клиент' : 'Сервер'} · Этап {entry.step} · Попытка{' '}
              {entry.attemptId}
            </small>
            <p>{entry.message}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
