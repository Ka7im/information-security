import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Profile, Challenge } from '@app/shared';
import { useConnection } from '@app/ui/connection';
import { createClientProof } from '../crypto';
export function useAuth() {
  const { connection, connected, logs, appendLog, clearLogs } = useConnection('/ws/client');
  const [challenge, setChallenge] = useState<Challenge>();
  const attempt = useRef('');
  // Изменение поколения отменяет применение результатов к уже сброшенной форме.
  const generation = useRef(0);
  const [profile, setProfile] = useState<Profile>();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
  function changeLogin() {
    generation.current++;
    setChallenge(undefined);
    setPassword('');
    setError('');
  }
  return {
    connected,
    logs,
    clearLogs,
    profile,
    challenge,
    login,
    setLogin,
    password,
    setPassword,
    error,
    busy,
    submit,
    logout,
    changeLogin,
  };
}
export type AuthController = ReturnType<typeof useAuth>;
