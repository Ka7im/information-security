import { config } from './config.js';
import { createPool } from './database/pool.js';
import { migrate } from './database/migrations.js';
import { createApplication } from './server.js';
import { TelegramBot } from './telegram/bot.js';
const pool = createPool(config.databaseUrl);
pool.on('error', () => console.error('Потеряно соединение с PostgreSQL.'));
await migrate(pool);
const bot = config.telegramBotToken
  ? new TelegramBot(config.telegramBotToken, pool, () => app.usersChanged())
  : undefined;
const app = createApplication(pool, config.origins, Date.now, bot);
bot?.start();
app.http.listen(config.port, '127.0.0.1', () =>
  console.log(`Backend: ws://127.0.0.1:${config.port}`),
);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await bot?.close();
  await app.close();
  await pool.end();
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
