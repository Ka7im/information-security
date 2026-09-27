import type pg from 'pg';
export async function migrate(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(746192)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await client.query('SELECT version FROM schema_migrations WHERE version = 1');
    if (!applied.rowCount) {
      await client.query(`CREATE TABLE users (
        id uuid PRIMARY KEY, login text NOT NULL UNIQUE, password_hash char(64) NOT NULL,
        telegram_login text NOT NULL, p text NOT NULL, q text NOT NULL, n text NOT NULL,
        phi text NOT NULL, e text NOT NULL, d text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      )`);
      await client.query('INSERT INTO schema_migrations(version) VALUES (1)');
    }
    const challengeMigration = await client.query(
      'SELECT version FROM schema_migrations WHERE version = 2',
    );
    if (!challengeMigration.rowCount) {
      await client.query(`CREATE TABLE auth_challenges (
        user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        t bytea NOT NULL CHECK (octet_length(t) = 16),
        created_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL
      )`);
      await client.query('INSERT INTO schema_migrations(version) VALUES (2)');
    }
    const telegramMigration = await client.query(
      'SELECT version FROM schema_migrations WHERE version = 3',
    );
    if (!telegramMigration.rowCount) {
      await client.query(`ALTER TABLE users ADD COLUMN telegram_chat_id text, ADD COLUMN telegram_user_id text;
        CREATE TABLE telegram_codes (
          user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          code char(6) NOT NULL CHECK (code ~ '^[1-9][0-9]{5}$'),
          created_at timestamptz NOT NULL,
          expires_at timestamptz NOT NULL
        )`);
      await client.query('INSERT INTO schema_migrations(version) VALUES (3)');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
