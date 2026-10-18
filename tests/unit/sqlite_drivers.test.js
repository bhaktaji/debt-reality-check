import { describe, it, expect } from 'vitest';
import { openDatabase, loadDriver, explainDriverFailure, SQLITE_CANDIDATES } from '../../store/db.js';
import { diagnoseProfile } from '../../core/profile.js';
import { profileFromStore, fieldsFromProfile } from '../../store/mappers.js';
import { ARCHETYPE_BY_ID } from '../fixtures/archetypes.js';

/**
 * SQLite driver selection.
 *
 * `better-sqlite3` loads its native binding lazily, so a plain `require()` succeeds even
 * when the binary was built for a different Node ABI. Detection therefore has to open a
 * real database. That bug shipped once - it made an ABI-mismatched native module win the
 * race and the built-in fallback never ran - so it is covered here, and the built-in
 * driver is exercised on every run rather than only on machines where the native one fails.
 */

const SECRET = 'driver-test-secret-1234567890';

describe('driver detection', () => {
  it('returns a driver that can actually open a database', () => {
    const driver = loadDriver({});
    expect(['better-sqlite3', 'node:sqlite']).toContain(driver.name);
    const db = driver.create(':memory:');
    db.exec('CREATE TABLE t (a INTEGER)');
    db.prepare('INSERT INTO t VALUES (?)').run(7);
    expect(db.prepare('SELECT a FROM t').get().a).toBe(7);
    db.close();
  });

  it('prefers the native driver when it works', () => {
    // On a machine where better-sqlite3 loads, it must win: it is the faster path.
    const driver = loadDriver({});
    if (driver.name === 'better-sqlite3') {
      expect(driver.name).toBe('better-sqlite3');
    } else {
      // Otherwise the built-in must be the one that came back.
      expect(driver.name).toBe('node:sqlite');
    }
  });

  it('honours a forced driver', () => {
    expect(loadDriver({ DRC_DB_DRIVER: 'node:sqlite' }).name).toBe('node:sqlite');
  });

  it('explains itself when the forced driver is not a real one', () => {
    expect(() => loadDriver({ DRC_DB_DRIVER: 'mysql' })).toThrow(/not a known driver/);
  });

  it('explains an ABI mismatch in plain terms rather than a raw dump', () => {
    // This is the exact failure Aakash hit: better-sqlite3 built for Node 22 (ABI 127)
    // while running Node 24 (ABI 137).
    const broken = [
      {
        name: 'better-sqlite3',
        load: () => {
          throw new Error(
            "The module '\\\\?\\C:\\...\\better_sqlite3.node' was compiled against a different Node.js version using\n" +
              'NODE_MODULE_VERSION 127. This version of Node.js requires\n' +
              'NODE_MODULE_VERSION 137.',
          );
        },
      },
      { name: 'node:sqlite', load: () => { throw new Error('also broken'); } },
    ];

    let message = '';
    try {
      loadDriver({}, broken);
    } catch (err) {
      message = err.message;
    }

    expect(message).toMatch(/No usable SQLite driver on Node v/);
    expect(message).toMatch(/built for a different Node version/);
    expect(message).toMatch(/npm rebuild better-sqlite3/);
    expect(message).toMatch(/DRC_DB_DRIVER=node:sqlite/);
    // It should not dump the whole multi-line native stack at the reader.
    expect(message.split('\n').length).toBeLessThan(14);
  });

  it('falls through to the next candidate when the first one is broken', () => {
    // This is the regression guard for the original bug: a broken native module must not
    // stop the built-in driver from being selected.
    const candidates = [
      { name: 'better-sqlite3', load: () => { throw new Error('NODE_MODULE_VERSION 127 vs 137'); } },
      ...SQLITE_CANDIDATES.filter((c) => c.name === 'node:sqlite'),
    ];
    const driver = loadDriver({}, candidates);
    expect(driver.name).toBe('node:sqlite');
    expect(driver.failures).toHaveLength(1);
    expect(driver.failures[0].name).toBe('better-sqlite3');
  });

  it('reports a non-ABI failure without the ABI advice', () => {
    const message = explainDriverFailure([{ name: 'x', message: 'file is not a database' }], [{ name: 'x' }]);
    expect(message).toMatch(/file is not a database/);
    expect(message).not.toMatch(/npm rebuild/);
  });
});

describe('the built-in driver runs the whole lifecycle', () => {
  const builtIn = { DRC_DB_DRIVER: 'node:sqlite' };

  it('migrates, stores and reads back an integer-paise profile', () => {
    const store = openDatabase({ path: ':memory:', secret: SECRET, env: builtIn });
    expect(store.driver).toBe('node:sqlite');
    expect(store.schemaVersion()).toBe(1);

    const profile = ARCHETYPE_BY_ID.B.profile;
    const uid = store.pseudonymise('driver:B');
    store.users.ensure(uid);
    store.users.update(uid, fieldsFromProfile(profile));
    store.debts.replaceAll(uid, profile.debts);

    const back = profileFromStore(store.users.get(uid), store.debts.list(uid));
    expect(back.netIncome).toBe(profile.netIncome);
    expect(back.debts).toHaveLength(2);
    expect(diagnoseProfile(back).tier).toBe(diagnoseProfile(profile).tier);
    store.close();
  });

  it('reports the same pragmas as the native driver', () => {
    const store = openDatabase({ path: ':memory:', secret: SECRET, env: builtIn });
    expect(store.raw.pragma('journal_mode', { simple: true })).toBe('memory'); // :memory: cannot use WAL
    expect(store.raw.pragma('foreign_keys', { simple: true })).toBe(1);
    store.close();
  });

  it('runs transactions, including nested ones, and rolls them back on failure', () => {
    const store = openDatabase({ path: ':memory:', secret: SECRET, env: builtIn });
    const uid = store.pseudonymise('driver:tx');
    store.users.ensure(uid);

    // debts.replaceAll opens its own transaction, so this is a nested transaction.
    expect(() =>
      store.raw.transaction(() => {
        store.debts.replaceAll(uid, [{ name: 'a', type: 'installment', secured: false, balance: 100, minPayment: 10, apr: 10 }]);
        expect(store.debts.list(uid)).toHaveLength(1); // visible inside
        throw new Error('boom');
      }),
    ).toThrow('boom');

    expect(store.debts.list(uid)).toHaveLength(0); // the outer rollback undid the inner work
    store.close();
  });

  it('commits a nested transaction when nothing throws', () => {
    const store = openDatabase({ path: ':memory:', secret: SECRET, env: builtIn });
    const uid = store.pseudonymise('driver:tx2');
    store.users.ensure(uid);

    store.raw.transaction(() => {
      store.debts.replaceAll(uid, [{ name: 'a', type: 'installment', secured: false, balance: 100, minPayment: 10, apr: 10 }]);
      store.raw.transaction(() => {
        store.expenses.add(uid, { amount: 50, category: 'Groceries', isEssential: true });
      });
    });

    expect(store.debts.list(uid)).toHaveLength(1);
    expect(store.expenses.listAll(uid)).toHaveLength(1);
    store.close();
  });

  it('cascades an erasure', () => {
    const store = openDatabase({ path: ':memory:', secret: SECRET, env: builtIn });
    const uid = store.pseudonymise('driver:erase');
    store.users.ensure(uid);
    store.expenses.add(uid, { amount: 100, category: 'Groceries', isEssential: true });
    store.audits.record(uid, diagnoseProfile(ARCHETYPE_BY_ID.C.profile));

    const counts = store.retention.deleteAllFor(uid);
    expect(counts.users).toBe(1);
    expect(counts.expenses).toBe(1);
    expect(store.users.get(uid)).toBeNull();
    store.close();
  });

  it('keeps free-text descriptions out of storage by default', () => {
    const store = openDatabase({ path: ':memory:', secret: SECRET, env: builtIn });
    const uid = store.pseudonymise('driver:desc');
    store.expenses.add(uid, { amount: 400, category: 'Health', isEssential: true, description: 'medicine for Asha' });
    expect(store.expenses.today(uid)[0].description).toBeNull();
    store.close();
  });
});

describe('both drivers agree', () => {
  it('produces identical query results for the same operations', () => {
    const run = (env) => {
      const store = openDatabase({ path: ':memory:', secret: SECRET, env });
      const uid = store.pseudonymise('driver:same');
      store.users.ensure(uid);
      store.users.update(uid, fieldsFromProfile(ARCHETYPE_BY_ID.C.profile));
      store.debts.replaceAll(uid, ARCHETYPE_BY_ID.C.profile.debts);
      store.expenses.add(uid, { amount: 1234.56, category: 'Health', isEssential: true });
      store.audits.record(uid, diagnoseProfile(ARCHETYPE_BY_ID.C.profile));

      const snapshot = {
        driver: store.driver,
        user: store.users.get(uid).net_income_paise,
        debts: store.debts.list(uid).map((d) => [d.name, d.balance, d.apr, d.creditLimit]),
        expenses: store.expenses.today(uid).map((e) => [e.amount, e.category, e.isEssential]),
        audit: store.audits.list(uid).map((a) => [a.tier, a.foir, a.runway]),
        events: store.events.recent(uid).length,
      };
      store.close();
      return snapshot;
    };

    const native = run({}); // whatever the machine prefers
    const builtIn = run({ DRC_DB_DRIVER: 'node:sqlite' });

    expect(builtIn.user).toBe(native.user);
    expect(builtIn.debts).toEqual(native.debts);
    expect(builtIn.expenses).toEqual(native.expenses);
    expect(builtIn.audit).toEqual(native.audit);
    expect(builtIn.events).toBe(native.events);
  });
});
