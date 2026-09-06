import dotenv from 'dotenv';
import { resolve } from 'node:path';
dotenv.config({ path: [resolve('.env'), resolve('../../.env')], quiet: true });
export const config = {
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgresql://security:local_security_password@127.0.0.1:55432/security',
  port: Number(process.env.PORT ?? 3000),
  origins: (
    process.env.ALLOWED_ORIGINS ??
    'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5174,http://localhost:5174'
  ).split(','),
};
