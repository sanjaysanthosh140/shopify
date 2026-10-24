/*
 * One-time Windows/Neon fallback for environments where Prisma's Rust
 * migration engine cannot complete the TLS handshake but the pg adapter can.
 * The migration remains a normal Prisma migration and is recorded in the
 * Prisma migrations table after the SQL succeeds.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
require('dotenv/config');

const migrationName = '20261024180000_add_orders_and_webhooks';
const migrationPath = path.join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  migrationName,
  'migration.sql',
);

async function main() {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const checksum = crypto.createHash('sha256').update(sql).digest('hex');
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  await client.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1',
      [migrationName],
    );
    if (existing.rowCount) {
      await client.query('ROLLBACK');
      console.log(`Migration already recorded: ${migrationName}`);
      return;
    }

    const table = await client.query(
      `SELECT to_regclass('"Order"') AS table_name`,
    );
    if (table.rows[0]?.table_name) {
      throw new Error('Order table exists but the migration is not recorded');
    }

    await client.query(sql);
    await client.query(
      `INSERT INTO "_prisma_migrations"
        (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES ($1, $2, NOW(), $3, NULL, NULL, NOW(), 1)`,
      [crypto.randomUUID(), checksum, migrationName],
    );
    await client.query('COMMIT');
    console.log(`Applied and recorded migration: ${migrationName}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
