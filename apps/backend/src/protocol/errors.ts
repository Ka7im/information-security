import { z } from 'zod';

export class RequestError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function toResponseError(error: unknown): { code: string; message: string } {
  if (error instanceof RequestError) return { code: error.code, message: error.message };
  if (error instanceof z.ZodError) {
    return { code: 'INVALID_REQUEST', message: 'Проверьте заполнение полей и формат запроса.' };
  }
  if ((error as { code?: string } | null)?.code === '23505') {
    return { code: 'LOGIN_EXISTS', message: 'Этот логин уже занят.' };
  }
  return { code: 'DATABASE_ERROR', message: 'Не удалось выполнить операцию. Попробуйте ещё раз.' };
}
