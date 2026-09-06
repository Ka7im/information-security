import { useState } from 'react';
import type { RsaParameters as RsaValues } from '@app/shared';
export function RsaParameters({ value }: { value: RsaValues }) {
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
