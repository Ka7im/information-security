import { randomUUID } from 'node:crypto';
import type { AuthLog } from '@app/shared';

export type AuthLogger = (step: number, message: string, serverDetail?: string) => void;

export function createAuthJournal(
  now: () => number,
  publish: (clientEntry: AuthLog, serverEntry: AuthLog) => void,
) {
  let attemptId = '';
  const log: AuthLogger = (step, message, serverDetail = '') => {
    const entry: AuthLog = {
      id: randomUUID(),
      attemptId,
      time: new Date(now()).toISOString(),
      side: 'server',
      step,
      message,
    };
    // t и H′ добавляются только в запись для серверных окон.
    publish(entry, { ...entry, message: message + serverDetail });
  };
  return {
    log,
    startAttempt: (id: string) => {
      attemptId = id;
    },
  };
}
