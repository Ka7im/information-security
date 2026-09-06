import pg from 'pg';
export const createPool = (connectionString: string) =>
  new pg.Pool({ connectionString, connectionTimeoutMillis: 5000 });
