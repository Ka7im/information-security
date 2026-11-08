import { hashText } from '@app/shared';
import { generateClientRsa, answerOffer } from '../dh';
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
  const clientRsa = useRef<Awaited<ReturnType<typeof generateClientRsa>> | undefined>(undefined);
  const [sessionKey, setSessionKey] = useState('');
  const [dhStatus, setDhStatus] = useState('');
  const [profile, setProfile] = useState<Profile>();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [telegramCode, setTelegramCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!connected) {
      clientRsa.current = undefined;
      setBusy(false);
      setSessionKey('');
      setDhStatus('');
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
        setError('Срок подтверждения истёк. Начните вход повторно.');
      },
      Math.max(
        0,
        Math.min(
          Date.parse(challenge.expiresAt),
          challenge.telegramExpiresAt ? Date.parse(challenge.telegramExpiresAt) : Infinity,
        ) - Date.now(),
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
  async function exchange() {
    const currentGeneration = generation.current;
    const transport = connection.current!;
    const active = () =>
      generation.current === currentGeneration && transport.socket?.readyState === WebSocket.OPEN;
    setBusy(true);
    setError('');
    setSessionKey('');
    setDhStatus('Генерация ключей и обмен DH… Первый запуск может занять несколько минут.');
    try {
      const key = clientRsa.current ?? (await generateClientRsa());
      if (!active()) return;
      clientRsa.current = key;
      log(7, 'RSA-2048 клиента готов. Серверу передаётся только открытый ключ.');
      const offer = await transport.request('dh.init', { clientKey: { n: key.n, e: key.e } });
      if (!active()) return;
      const answer = await answerOffer(offer, key);
      if (!active()) return;
      log(
        8,
        `Подпись AGP верна. B = g^b mod p = ${answer.payload.B}; SHA-256(B) = ${answer.payload.hash}; подпись клиента = ${answer.payload.signature}`,
      );
      const result = await transport.request('dh.complete', answer.payload);
      const keyHash = await hashText(answer.K);
      if (!active()) return;
      if (result.keyHash !== keyHash) throw new Error('Ключи клиента и сервера не совпали.');
      setSessionKey(answer.K);
      setDhStatus('Подписи проверены. Ключи клиента и сервера совпадают.');
      log(10, `K клиента = A^b mod p = ${answer.K}; SHA-256(K) = ${keyHash}. Ключи совпадают.`);
    } catch (e) {
      if (!active()) return;
      const message = (e as Error).message;
      setError(message);
      setDhStatus('Обмен DH не завершён.');
      log(10, message);
    } finally {
      if (generation.current === currentGeneration) setBusy(false);
    }
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
          `Получено SHA-256(t) = ${received.challengeHash}; действует до ${received.expiresAt}. ` +
            (received.telegramRequired
              ? `Код отправлен в Telegram, действует до ${received.telegramExpiresAt}.`
              : 'Проверка Telegram отключена сервером.'),
        );
      } else {
        if (!crypto.subtle)
          throw new Error('Для вычисления SHA-256 откройте клиент через localhost или HTTPS.');
        if (challenge.telegramRequired && !/^[0-9]{6}$/.test(telegramCode))
          throw new Error('Введите шестизначный код из Telegram.');
        log(
          4,
          challenge.telegramRequired
            ? 'Вычисление H = SHA-256(SHA-256(пароль) + SHA-256(t) + SHA-256(tgМетка)).'
            : 'Вычисление H = SHA-256(SHA-256(пароль) + SHA-256(t)).',
        );
        const proof = await createClientProof(
          password,
          challenge.challengeHash,
          challenge.telegramRequired ? telegramCode : undefined,
        );
        setPassword('');
        setTelegramCode('');
        if (generation.current !== currentGeneration) return;
        log(4, `Вычислено и отправляется H = ${proof}`);
        const result = await transport.request('auth.login', { proof });
        if (generation.current !== currentGeneration) return;
        setProfile(result);
        setChallenge(undefined);
        log(6, 'Сервер подтвердил вход. Соединение авторизовано.');
        await exchange();
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
      generation.current++;
      clientRsa.current = undefined;
      setSessionKey('');
      setDhStatus('');
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
    exchange,
    sessionKey,
    dhStatus,
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
