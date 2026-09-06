import { config } from './config.js';
import { createPool } from './database/pool.js';
import { migrate } from './database/migrations.js';
const pool = createPool(config.databaseUrl);
try {
  await migrate(pool);
  console.log('Миграции применены.');
} finally {
  await pool.end();
}
