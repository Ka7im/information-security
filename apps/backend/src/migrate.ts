import { config } from './config.js';
import { createPool, migrate } from './db.js';
const pool = createPool(config.databaseUrl);
try {
  await migrate(pool);
  console.log('Миграции применены.');
} finally {
  await pool.end();
}
