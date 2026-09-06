import { config } from './config.js';
import { createPool, migrate } from './db.js';
import { createApplication } from './server.js';
const pool = createPool(config.databaseUrl);
pool.on('error', () => console.error('Потеряно соединение с PostgreSQL.'));
await migrate(pool);
const app = createApplication(pool, config.origins);
app.http.listen(config.port, '127.0.0.1', () =>
  console.log(`Backend: ws://127.0.0.1:${config.port}`),
);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await app.close();
  await pool.end();
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
