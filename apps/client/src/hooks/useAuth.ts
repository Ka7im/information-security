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
  const [telegramCode, setTelegramCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!connected) {
      setProfile(undefined);
      setPassword('');
      setTelegramCode('');
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
        setTelegramCode('');
        setError('Срок подтверждения истёк. Запросите код повторно.');
      },
      Math.max(
        0,
        Math.min(Date.parse(challenge.expiresAt), Date.parse(challenge.telegramExpiresAt)) -
          Date.now(),
      ),
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
  async function submit(event: FormEvent, resend = false) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const currentGeneration = generation.current;
    const transport = connection.current!;
    try {
      if (!challenge || resend) {
        setChallenge(undefined);
        setTelegramCode('');
        setPassword('');
        attempt.current = crypto.randomUUID();
        log(1, `Отправка логина: ${login.trim()}`);
        const received = await transport.request('auth.challenge', { login }, attempt.current);
        if (generation.current !== currentGeneration) return;
        setChallenge(received);
        log(
          3,
          `Получено SHA-256(t) = ${received.challengeHash}; действует до ${received.expiresAt}. Код отправлен в Telegram, действует до ${received.telegramExpiresAt}.`,
        );
      } else {
        if (!crypto.subtle)
          throw new Error('Для вычисления SHA-256 откройте клиент через localhost или HTTPS.');
        if (!/^[0-9]{6}$/.test(telegramCode))
          throw new Error('Введите шестизначный код из Telegram.');
        log(4, 'Вычисление H = SHA-256(SHA-256(пароль) + SHA-256(t) + SHA-256(tgМетка)).');
        const proof = await createClientProof(password, challenge.challengeHash, telegramCode);
        setPassword('');
        setTelegramCode('');
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
      if (
        ['CHALLENGE_EXPIRED', 'CHALLENGE_REQUIRED', 'TELEGRAM_CODE_EXPIRED'].includes(
          failure.code ?? '',
        )
      ) {
        setChallenge(undefined);
        setPassword('');
        setTelegramCode('');
      }
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
    setTelegramCode('');
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
    telegramCode,
    setTelegramCode,
    resend: (event: FormEvent) => submit(event, true),
    error,
    busy,
    submit,
    logout,
    changeLogin,
  };
}
export type AuthController = ReturnType<typeof useAuth>;
