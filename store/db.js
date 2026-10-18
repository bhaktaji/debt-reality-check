/**
 * store/db.js
 * SQLite persistence: WAL, foreign keys, indexes, migrations, integer paise.
 *
 * Driver: better-sqlite3 when it loads, otherwise the built-in node:sqlite. Both are
 * wrapped behind one tiny interface so the rest of the app does not care.
 *
 * Privacy (F-13, task section 11):
 *  - rows are keyed by a pseudonymised HMAC id, never a raw phone number;
 *  - money is INTEGER paise;
 *  - free-text expense descriptions are dropped unless DRC_STORE_DESCRIPTIONS=true;
 *  - the event log records kinds and timestamps only, never message bodies.
 */

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate, currentVersion } from './migrations.js';
import { resolveSecret, pseudonymise, minimiseDescription } from './pseudonym.js';
import { purgeInactive, deleteAllFor } from './retention.js';

const require = createRequire(import.meta.url);

/** Normalise JS values into what SQLite drivers accept. */
function normalise(args) {
  return args.map((v) => {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
}

/** Unified wrapper over better-sqlite3 / node:sqlite. */
class Sqlite {
  constructor(db, driver) {
    this.db = db;
    this.driver = driver;
  }

  exec(sql) {
    this.db.exec(sql);
    return this;
  }

  /** Write a pragma, or read one when `options` asks for a simple value. */
  pragma(statement, options) {
    if (typeof this.db.pragma === 'function') {
      return this.db.pragma(statement, options);
    }
    // node:sqlite has no pragma() helper, so emulate it with prepare/exec so that both
    // drivers behave identically for reads and writes.
    const isRead = !statement.includes('=');
    if (!isRead) {
      this.db.exec(`PRAGMA ${statement}`);
      return undefined;
    }
    const row = this.db.prepare(`PRAGMA ${statement}`).get();
    if (!row) return undefined;
    const value = Object.values(row)[0];
    return options?.simple ? value : [row];
  }

  prepare(sql) {
    const stmt = this.db.prepare(sql);
    return {
      run: (...args) => {
        const r = stmt.run(...normalise(args));
        return { changes: Number(r?.changes ?? 0), lastInsertRowid: Number(r?.lastInsertRowid ?? 0) };
      },
      get: (...args) => stmt.get(...normalise(args)),
      all: (...args) => stmt.all(...normalise(args)),
    };
  }

  /**
   * Run `fn` inside a transaction, with nesting.
   *
   * A nested call uses a SAVEPOINT instead of a second BEGIN, so a repository method that
   * opens its own transaction (debts.replaceAll does) can safely be composed inside
   * another one. An outer rollback still undoes the inner work.
   */
  transaction(fn) {
    const depth = this.txDepth ?? 0;
    const savepoint = `drc_sp_${depth}`;

    this.db.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${savepoint}`);
    this.txDepth = depth + 1;

    try {
      const out = fn();
      this.db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
      return out;
    } catch (err) {
      try {
        if (depth === 0) this.db.exec('ROLLBACK');
        else {
          this.db.exec(`ROLLBACK TO ${savepoint}`);
          this.db.exec(`RELEASE ${savepoint}`);
        }
      } catch {
        /* the transaction is already gone */
      }
      throw err;
    } finally {
      this.txDepth = depth;
    }
  }

  close() {
    this.db.close();
  }
}

/** Load a SQLite driver. Returns a constructor-ish factory. */
/** The drivers we know how to use, in preference order. Loaded lazily. */
export const SQLITE_CANDIDATES = [
  { name: 'better-sqlite3', load: () => require('better-sqlite3') },
  { name: 'node:sqlite', load: () => require('node:sqlite').DatabaseSync },
];

/**
 * Load a SQLite driver, proving it works rather than assuming it.
 *
 * A plain `require('better-sqlite3')` is NOT a valid test: it loads its native binding
 * lazily, so a Node ABI mismatch only surfaces when a database is actually opened. Doing
 * the require alone meant an ABI-mismatched native module won the race and the built-in
 * fallback never ran. So every candidate is probed with a real in-memory database.
 *
 * Set DRC_DB_DRIVER to force one ("better-sqlite3" or "node:sqlite").
 *
 * @param {object} [env]          environment to read DRC_DB_DRIVER from
 * @param {Array}  [candidates]   override for tests
 */
export function loadDriver(env = process.env, candidates = SQLITE_CANDIDATES) {
  const forced = env.DRC_DB_DRIVER;
  const toTry = forced ? candidates.filter((c) => c.name === forced) : candidates;
  if (forced && toTry.length === 0) {
    throw new Error(
      `DRC_DB_DRIVER="${forced}" is not a known driver. Use one of: ${candidates.map((c) => c.name).join(', ')}.`,
    );
  }

  const failures = [];
  for (const candidate of toTry) {
    try {
      const Ctor = candidate.load();
      const probe = new Ctor(':memory:'); // this is what actually loads the native binding
      probe.close();
      return { name: candidate.name, create: (path) => new Ctor(path), failures };
    } catch (err) {
      failures.push({ name: candidate.name, message: String(err?.message ?? err) });
    }
  }

  throw new Error(explainDriverFailure(failures, candidates));
}

/** Build the "no driver worked" message, with a fix for the common ABI case. */
export function explainDriverFailure(failures, candidates = SQLITE_CANDIDATES) {
  const detail = failures.map((f) => `  - ${f.name}: ${f.message.split('\n')[0]}`).join('\n');
  const abiMismatch = failures.some((f) => /NODE_MODULE_VERSION/.test(f.message));
  const header = `No usable SQLite driver on Node ${process.version}. Tried:\n${detail}`;

  if (abiMismatch) {
    return (
      `${header}\n\n` +
      'better-sqlite3 was built for a different Node version than the one you are running.\n' +
      'Pick one of these:\n' +
      '  1. Run on the version it was built for (this project targets Node 22).\n' +
      '  2. Rebuild it for your Node: npm rebuild better-sqlite3\n' +
      '  3. Use the built-in driver instead: set DRC_DB_DRIVER=node:sqlite in .env'
    );
  }
  return `${header}\n\nAvailable drivers: ${candidates.map((c) => c.name).join(', ')}.`;
}

export function rupeesToPaise(rupees) {
  if (rupees === null || rupees === undefined || rupees === '') return null;
  const n = Number(rupees);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function paiseToRupees(paise) {
  if (paise === null || paise === undefined) return null;
  return Number(paise) / 100;
}

export function aprToBp(apr) {
  if (apr === null || apr === undefined || apr === '') return null;
  const n = Number(apr);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function bpToApr(bp) {
  if (bp === null || bp === undefined) return null;
  return Number(bp) / 100;
}

/**
 * Open (and migrate) the database.
 *
 * @param {{path?:string, secret?:string, storeDescriptions?:boolean, env?:object}} [options]
 */
export function openDatabase(options = {}) {
  const env = options.env || process.env;
  const path = options.path || env.DRC_DB_PATH || 'data/debt_reality.sqlite';
  const secret = options.secret || resolveSecret(env);
  const storeDescriptions = options.storeDescriptions ?? env.DRC_STORE_DESCRIPTIONS === 'true';

  if (path !== ':memory:') {
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch {
      /* directory already exists */
    }
  }

  const driver = loadDriver(env);
  const db = new Sqlite(driver.create(path), driver.name);

  // Pragmas: durability + integrity + concurrency (F-20).
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');

  const applied = migrate(db);

  return makeStore({ db, path, secret, storeDescriptions, driver: driver.name, applied });
}

/** Build the repository surface. */
function makeStore(ctx) {
  const { db, path, secret, storeDescriptions } = ctx;

  const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

  const ensureUser = (userId) => {
    db.prepare('INSERT OR IGNORE INTO users (id) VALUES (?)').run(userId);
    db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(nowIso(), userId);
  };

  const api = {
    driver: ctx.driver,
    path,
    migrationsApplied: ctx.applied,
    raw: db,

    /** Pseudonymise a raw channel id. The raw value is not retained. */
    pseudonymise: (rawId) => pseudonymise(rawId, secret),

    close: () => db.close(),
    schemaVersion: () => currentVersion(db),

    users: {
      ensure: ensureUser,
      get(userId) {
        const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        if (!row) return null;
        return { ...row, incomeHistory: JSON.parse(row.income_history_json || '[]'), state: JSON.parse(row.state_json || '{}') };
      },
      /** Whitelisted column update - no dynamic column names from user input (F-20). */
      update(userId, fields) {
        const COLS = new Set([
          'currency', 'net_income_paise', 'core_expenses_paise', 'rent_paise', 'liquid_reserves_paise',
          'earners', 'dependents', 'family_help', 'income_history_json', 'state_json',
        ]);
        const keys = Object.keys(fields).filter((k) => COLS.has(k));
        if (!keys.length) return;
        const sql = `UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`;
        db.prepare(sql).run(...keys.map((k) => fields[k]), nowIso(), userId);
      },
      touch: (userId) => db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(nowIso(), userId),
      count: () => db.prepare('SELECT COUNT(*) AS c FROM users').get()?.c ?? 0,
    },

    debts: {
      list(userId) {
        return db.prepare('SELECT * FROM debts WHERE user_id = ? ORDER BY id').all(userId).map((r) => ({
          id: r.id,
          name: r.name,
          type: r.type,
          secured: r.secured === null ? null : r.secured === 1,
          balance: paiseToRupees(r.balance_paise) ?? 0,
          minPayment: paiseToRupees(r.min_payment_paise) ?? 0,
          apr: bpToApr(r.apr_bp),
          creditLimit: paiseToRupees(r.credit_limit_paise),
          quote: r.quote_json ? JSON.parse(r.quote_json) : null,
        }));
      },
      /** Replace the whole debt set for a user inside one transaction. */
      replaceAll(userId, debts = []) {
        return db.transaction(() => {
          db.prepare('DELETE FROM debts WHERE user_id = ?').run(userId);
          const ins = db.prepare(
            `INSERT INTO debts (user_id, name, type, secured, balance_paise, min_payment_paise, apr_bp, credit_limit_paise, quote_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          for (const d of debts) {
            ins.run(
              userId,
              d.name || 'Debt',
              d.type ?? null,
              d.secured === null || d.secured === undefined ? null : d.secured ? 1 : 0,
              rupeesToPaise(d.balance) ?? 0,
              rupeesToPaise(d.minPayment) ?? 0,
              aprToBp(d.apr),
              rupeesToPaise(d.creditLimit),
              d.quote ? JSON.stringify(d.quote) : null,
            );
          }
        });
      },
    },

    expenses: {
      /** @param {{amount:number, category:string, isEssential:(boolean|null), description?:string, createdAt?:string}} e */
      add(userId, e) {
        ensureUser(userId);
        const description = storeDescriptions ? minimiseDescription(e.description) : null;
        const r = db.prepare(
          `INSERT INTO expenses (user_id, amount_paise, category, is_essential, description, created_at)
           VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
        ).run(
          userId,
          rupeesToPaise(e.amount) ?? 0,
          e.category || 'Uncategorised',
          e.isEssential === null || e.isEssential === undefined ? null : e.isEssential ? 1 : 0,
          description,
          e.createdAt ? String(e.createdAt) : null,
        );
        return r.lastInsertRowid;
      },
      listSince(userId, sinceIso) {
        return db.prepare('SELECT * FROM expenses WHERE user_id = ? AND created_at >= ? ORDER BY created_at').all(userId, sinceIso).map(mapExpense);
      },
      listAll(userId) {
        return db.prepare('SELECT * FROM expenses WHERE user_id = ? ORDER BY created_at').all(userId).map(mapExpense);
      },
      /** Local-time "today", fixing the UTC/local bug (F-19). */
      today(userId) {
        return db.prepare(
          `SELECT * FROM expenses
            WHERE user_id = ? AND date(created_at, 'localtime') = date('now', 'localtime')
            ORDER BY created_at`,
        ).all(userId).map(mapExpense);
      },
      deleteAll: (userId) => db.prepare('DELETE FROM expenses WHERE user_id = ?').run(userId),
    },

    audits: {
      record(userId, diagnostic, payload = null) {
        ensureUser(userId);
        const r = db.prepare(
          `INSERT INTO audits (user_id, tier, foir_bp, dcf_paise, runway_centimonths, debt_paise, payload_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          userId,
          diagnostic.tier,
          aprToBp(diagnostic.metrics?.foir),
          rupeesToPaise(diagnostic.metrics?.dcf),
          Number.isFinite(diagnostic.metrics?.er) ? Math.round(diagnostic.metrics.er * 100) : null,
          rupeesToPaise(diagnostic.metrics?.totalBalance),
          payload ? JSON.stringify(payload) : null,
        );
        return r.lastInsertRowid;
      },
      list(userId, limit = 50) {
        return db.prepare('SELECT * FROM audits WHERE user_id = ? ORDER BY taken_at DESC, id DESC LIMIT ?').all(userId, limit).map((r) => ({
          id: r.id,
          takenAt: r.taken_at,
          tier: r.tier,
          foir: bpToApr(r.foir_bp),
          dcf: paiseToRupees(r.dcf_paise),
          runway: r.runway_centimonths === null ? null : r.runway_centimonths / 100,
          debt: paiseToRupees(r.debt_paise),
        }));
      },
      latest(userId) {
        return this.list(userId, 1)[0] ?? null;
      },
      /** Tier movement between the two most recent audits. */
      trend(userId, limit = 20) {
        const rows = this.list(userId, limit);
        const chronological = [...rows].reverse();
        return chronological.map((row, i) => ({
          ...row,
          previousTier: i > 0 ? chronological[i - 1].tier : null,
          tierChange: i > 0 ? row.tier - chronological[i - 1].tier : 0,
        }));
      },
    },

    consent: {
      record(userId, { noticeVersion, purpose, retentionDays }) {
        ensureUser(userId);
        return db.prepare(
          'INSERT INTO consent (user_id, notice_version, purpose, retention_days) VALUES (?, ?, ?, ?)',
        ).run(userId, noticeVersion, purpose, retentionDays).lastInsertRowid;
      },
      latest(userId) {
        const r = db.prepare('SELECT * FROM consent WHERE user_id = ? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1').get(userId);
        return r ? { id: r.id, noticeVersion: r.notice_version, purpose: r.purpose, retentionDays: r.retention_days, grantedAt: r.granted_at } : null;
      },
      hasConsent(userId) {
        return Boolean(this.latest(userId));
      },
      revoke(userId) {
        return db.prepare("UPDATE consent SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL").run(userId);
      },
    },

    events: {
      /** Kinds and timestamps only. Message bodies are never stored (task section 11). */
      log(userId, kind) {
        return db.prepare('INSERT INTO events (user_id, kind) VALUES (?, ?)').run(userId, kind).lastInsertRowid;
      },
      recent(userId, limit = 20) {
        return db.prepare('SELECT kind, created_at FROM events WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit);
      },
      count: () => db.prepare('SELECT COUNT(*) AS c FROM events').get()?.c ?? 0,
    },

    /** Retention + erasure (task section 11). */
    retention: {
      purgeInactive: (days = 90) => purgeInactive(db, days),
      deleteAllFor: (userId) => deleteAllFor(db, userId),
    },

    /** Raw SQL helper for CLI/reporting. */
    query: (sql, ...args) => db.prepare(sql).all(...args),

    /** Store an expense description at all? Opt-in only. */
    storesDescriptions: storeDescriptions,
  };

  return api;
}

function mapExpense(r) {
  return {
    id: r.id,
    amount: paiseToRupees(r.amount_paise) ?? 0,
    category: r.category,
    isEssential: r.is_essential === null ? null : r.is_essential === 1,
    description: r.description,
    createdAt: r.created_at,
  };
}

export default { openDatabase, loadDriver, rupeesToPaise, paiseToRupees, aprToBp, bpToApr };
