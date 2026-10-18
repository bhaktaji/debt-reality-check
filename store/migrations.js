/**
 * store/migrations.js
 * Ordered, idempotent schema migrations.
 *
 * Money is stored as INTEGER paise. Rates are stored as basis points (apr_bp = APR% x 100).
 * Runway is stored as centimonths (months x 100) so ordering and trend charts stay exact.
 *
 * Free-text expense descriptions are NOT stored by default (see store/db.js,
 * DRC_STORE_DESCRIPTIONS). Everything else is numeric or a controlled vocabulary.
 */

export const MIGRATIONS = [
  {
    version: 1,
    name: 'initial schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id                   TEXT PRIMARY KEY,
          currency             TEXT NOT NULL DEFAULT 'INR',
          net_income_paise     INTEGER,
          core_expenses_paise  INTEGER,
          rent_paise           INTEGER,
          liquid_reserves_paise INTEGER,
          earners              INTEGER,
          dependents           INTEGER,
          family_help          INTEGER,
          income_history_json  TEXT,
          state_json           TEXT,
          created_at           TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
          last_seen_at         TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS debts (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name               TEXT NOT NULL,
          type               TEXT,
          secured            INTEGER,
          balance_paise      INTEGER NOT NULL DEFAULT 0,
          min_payment_paise  INTEGER NOT NULL DEFAULT 0,
          apr_bp             INTEGER,
          credit_limit_paise INTEGER,
          quote_json         TEXT,
          created_at         TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_debts_user ON debts(user_id);

        CREATE TABLE IF NOT EXISTS expenses (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          amount_paise  INTEGER NOT NULL,
          category      TEXT NOT NULL,
          is_essential  INTEGER,
          description   TEXT,
          created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_exp_user_time ON expenses(user_id, created_at);

        CREATE TABLE IF NOT EXISTS audits (
          id                   INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          taken_at             TEXT NOT NULL DEFAULT (datetime('now')),
          tier                 INTEGER,
          foir_bp              INTEGER,
          dcf_paise            INTEGER,
          runway_centimonths   INTEGER,
          debt_paise           INTEGER,
          payload_json         TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_audits_user_time ON audits(user_id, taken_at);

        CREATE TABLE IF NOT EXISTS consent (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          notice_version  TEXT NOT NULL,
          purpose         TEXT NOT NULL,
          retention_days  INTEGER NOT NULL,
          granted_at      TEXT NOT NULL DEFAULT (datetime('now')),
          revoked_at      TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_consent_user ON consent(user_id);

        -- Event log: kinds and timestamps only. Message bodies are never written here.
        CREATE TABLE IF NOT EXISTS events (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id     TEXT,
          kind        TEXT NOT NULL,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_events_user_time ON events(user_id, created_at);
      `);
    },
  },
];

/** Create the migrations bookkeeping table. */
function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/** Apply every migration newer than the recorded version. Returns applied versions. */
export function migrate(db, migrations = MIGRATIONS) {
  ensureMigrationsTable(db);
  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get();
  const current = row?.v ?? 0;
  const applied = [];

  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (m.version <= current) continue;
    db.exec('BEGIN');
    try {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
      db.exec('COMMIT');
      applied.push(m.version);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${m.version} (${m.name}) failed: ${err.message}`);
    }
  }
  return applied;
}

export function currentVersion(db) {
  ensureMigrationsTable(db);
  return db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get()?.v ?? 0;
}

export default { MIGRATIONS, migrate, currentVersion };
