// Migration runner wrapping knex.migrate's built-in API.
// Replaces the vendored @umonaca/umzug wrapper (fork of umzug/umzug 2.x
// plus the knex-migrate CLI) with a direct dependency on knex's own
// migration engine, which is already the standard for Knex-based apps.

const { join } = require('path');
const { readdirSync } = require('fs');
const knex = require('knex');
const knexfile = require('./knexfile');

function getMigrationsDir() {
  return join(__dirname, 'migrations');
}

function getKnexInstance() {
  const env = process.env.KNEX_ENV || process.env.NODE_ENV || 'upgrade';
  const config = Object.assign({}, knexfile[env]);
  if (config.client === 'sqlite3') {
    config.useNullAsDefault = true;
  }
  config.pool = { max: 10, min: 0, idleTimeoutMillis: 1000 };
  return knex(config);
}

/**
 * Find a migration filename by prefix (e.g. '20210213233544' matches
 * '20210213233544_fill_va_uuid.js'), matching the umzug fork's behaviour.
 */
function findMigrationFile(migrationDir, prefix) {
  const files = readdirSync(migrationDir).filter(
    (f) => /^\d+_.+\.js$/.test(f)
  );
  const match = files.find((f) => f.startsWith(prefix));
  if (!match) {
    throw new Error(
      `Migration matching "${prefix}" not found in ${migrationDir}`
    );
  }
  return match;
}

/**
 * @param {string} command - 'up' or 'skipAll'
 * @param {object} [flags]
 * @param {object} [flags.to] - Only run up to / skip up to this migration
 *                               (prefix matched by startsWith)
 * @param {function} [progress] - Callback({action, migration}) per migration
 */
async function knexMigrate(command, flags, progress) {
  flags = flags || {};
  progress = progress || function () {};

  const migrationDir = getMigrationsDir();
  const db = getKnexInstance();

  // Config for knex.migrate: the directory is required; the table name is
  // already picked up from the knexfile env's migrations.tableName.
  const migrateConfig = { directory: migrationDir };

  try {
    if (command === 'up') {
      if (flags.to) {
        // Run pending migrations one by one until we reach the target.
        const targetFile = findMigrationFile(migrationDir, flags.to);
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const [, log] = await db.migrate.up(migrateConfig);
          if (log.length === 0) break; // No more pending
          progress({ action: 'migrate', migration: join(migrationDir, log[0]) });
          if (log[0] === targetFile) break;
        }
      } else {
        const [, log] = await db.migrate.latest(migrateConfig);
        for (const name of log) {
          progress({ action: 'migrate', migration: join(migrationDir, name) });
        }
      }
    } else if (command === 'skipAll') {
      // Mark migrations as executed without actually running them.
      const tableName =
        (db.client.config.migrations && db.client.config.migrations.tableName) ||
        'knex_migrations';

      const [completed, pending] = await db.migrate.list(migrateConfig);
      const completedNames = completed.map((m) => m.name);
      const pendingFiles = pending.map((m) => m.file);

      let toSkip = [];
      if (flags.to) {
        const targetFile = findMigrationFile(migrationDir, flags.to);
        const idx = pendingFiles.indexOf(targetFile);
        if (idx !== -1) {
          toSkip = pendingFiles.slice(0, idx + 1);
        }
        // If target is already completed, nothing to skip.
      } else {
        toSkip = pendingFiles;
      }

      if (toSkip.length > 0) {
        const batchNo = await db(tableName)
          .max('batch as max_batch')
          .then((r) => (r[0].max_batch || 0) + 1);
        const now = new Date();
        for (const name of toSkip) {
          await db(tableName).insert({
            name,
            batch: batchNo,
            migration_time: now,
          });
        }
      }
    }
  } finally {
    db.destroy();
  }
}

module.exports = knexMigrate;
module.exports.default = knexMigrate;