export interface Profile {
  id: string;
  login: string;
  telegramLogin: string;
  createdAt: string;
}
export interface RsaParameters {
  p: string;
  q: string;
  n: string;
  phi: string;
  e: string;
  d: string;
}
export interface User extends Profile {
  rsa: RsaParameters;
}
export interface Challenge {
  challengeHash: string;
  expiresAt: string;
}
export interface AuthLog {
  id: string;
  attemptId: string;
  time: string;
  side: 'client' | 'server';
  step: number;
  message: string;
}
export interface Operations {
  'rsa.generate': { input: Record<string, never>; output: RsaParameters };
  'users.create': {
    input: { login: string; password: string; telegramLogin: string };
    output: User;
  };
  'users.list': { input: Record<string, never>; output: User[] };
  'auth.challenge': { input: { login: string }; output: Challenge };
  'auth.login': { input: { proof: string }; output: Profile };
  'auth.me': { input: Record<string, never>; output: Profile };
  'auth.logout': { input: Record<string, never>; output: null };
}
export type Operation = keyof Operations;
export type Request = {
  [K in Operation]: { id: string; type: K; payload: Operations[K]['input'] };
}[Operation];
export type Response =
  | { id: string; ok: true; data: unknown }
  | { id: string; ok: false; error: { code: string; message: string } };
export type ServerMessage =
  Response | { type: 'users.changed' } | { type: 'auth.log'; entry: AuthLog };
