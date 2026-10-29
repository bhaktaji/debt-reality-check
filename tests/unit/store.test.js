import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, rupeesToPaise, paiseToRupees, aprToBp, bpToApr } from '../../store/db.js';
import { profileFromStore, fieldsFromProfile } from '../../store/mappers.js';
import { pseudonymise, minimiseDescription, resolveSecret, MissingSecretError } from '../../store/pseudonym.js';
import { ARCHETYPE_BY_ID } from '../fixtures/archetypes.js';
import { diagnoseProfile } from '../../core/profile.js';

const SECRET = 'unit-test-secret-value-1234567890';
let dir;
let store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drc-test-'));
  store = openDatabase({ path: join(dir, 'test.sqlite'), secret: SECRET, storeDescriptions: false });
});

afterEach(() => {
  store?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('schema and pragmas (F-20)', () => {
  it('applies migrations once and reports the version', () => {
    expect(store.migrationsApplied).toEqual([1, 2]);
    expect(store.schemaVersion()).toBe(2);
    // Re-opening must not re-apply.
    const again = openDatabase({ path: join(dir, 'test.sqlite'), secret: SECRET });
    expect(again.migrationsApplied).toEqual([]);
    again.close();
  });

  it('enables WAL and foreign keys', () => {
    expect(store.raw.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(store.raw.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('creates the expected tables and indexes', () => {
    const tables = store.query("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);
    for (const t of ['users', 'debts', 'expenses', 'audits', 'consent', 'events', 'schema_migrations']) {
      expect(tables, t).toContain(t);
    }
    const indexes = store.query("SELECT name FROM sqlite_master WHERE type='index'").map((r) => r.name);
    expect(indexes).toContain('idx_exp_user_time');
    expect(indexes).toContain('idx_audits_user_time');
  });
});

describe('money is stored as integer paise', () => {
  it('converts both ways', () => {
    expect(rupeesToPaise(60000)).toBe(6000000);
    expect(paiseToRupees(6000000)).toBe(60000);
    expect(aprToBp(42.5)).toBe(4250);
    expect(bpToApr(4250)).toBe(42.5);
  });

  it('stores paise as integers, never floats', () => {
    const uid = store.pseudonymise('user:paise');
    store.users.ensure(uid);
    store.users.update(uid, { net_income_paise: rupeesToPaise(45000.5) });
    const row = store.raw.prepare('SELECT net_income_paise FROM users WHERE id = ?').get(uid);
    expect(Number.isInteger(row.net_income_paise)).toBe(true);
    expect(row.net_income_paise).toBe(4500050);
  });
});

describe('pseudonymised ids (F-13)', () => {
  it('never stores the raw phone number', () => {
    const raw = '919812345678@s.whatsapp.net';
    const uid = store.pseudonymise(raw);
    expect(uid).not.toContain('9812345678');
    expect(uid).toMatch(/^[0-9a-f]{32}$/);
    expect(pseudonymise(raw, SECRET)).toBe(uid);
  });

  it('is stable for the same input and different across inputs', () => {
    expect(pseudonymise('a', SECRET)).toBe(pseudonymise('a', SECRET));
    expect(pseudonymise('a', SECRET)).not.toBe(pseudonymise('b', SECRET));
  });

  it('refuses a missing secret in production', () => {
    expect(() => resolveSecret({ NODE_ENV: 'production' })).toThrow(MissingSecretError);
    expect(resolveSecret({ NODE_ENV: 'production', PSEUDONYM_SECRET: 'a'.repeat(32) })).toHaveLength(32);
  });
});

describe('profile round-trip', () => {
  it('survives a store round-trip and produces the same tier', () => {
    const profile = ARCHETYPE_BY_ID.B.profile;
    const uid = store.pseudonymise('user:B');
    store.users.ensure(uid);
    store.users.update(uid, fieldsFromProfile(profile));
    store.debts.replaceAll(uid, profile.debts);

    const back = profileFromStore(store.users.get(uid), store.debts.list(uid));
    expect(back.netIncome).toBe(profile.netIncome);
    expect(back.debts).toHaveLength(profile.debts.length);
    expect(back.debts[1]).toMatchObject({ type: 'revolving', secured: false, creditLimit: 250000, apr: 42 });

    expect(diagnoseProfile(back).tier).toBe(diagnoseProfile(profile).tier);
  });

  it('keeps a missing credit limit missing', () => {
    const uid = store.pseudonymise('user:nolimit');
    store.users.ensure(uid);
    store.debts.replaceAll(uid, [{ name: 'card', type: 'revolving', secured: false, balance: 10000, minPayment: 500, apr: 42 }]);
    expect(store.debts.list(uid)[0].creditLimit).toBeNull();
  });
});

describe('expenses, audit history and the local-date fix (F-19)', () => {
  it('logs an expense and returns it for today', () => {
    const uid = store.pseudonymise('user:exp');
    store.expenses.add(uid, { amount: 400, category: 'Health', isEssential: true, description: 'medicine 400' });
    expect(store.expenses.today(uid)).toHaveLength(1);
    expect(store.expenses.today(uid)[0].amount).toBe(400);
  });

  it('does not store free-text descriptions unless explicitly enabled', () => {
    const uid = store.pseudonymise('user:desc');
    store.expenses.add(uid, { amount: 400, category: 'Health', isEssential: true, description: 'medicine for Asha at Apollo' });
    expect(store.expenses.today(uid)[0].description).toBeNull();
    expect(store.storesDescriptions).toBe(false);
  });

  it('records audits and computes tier movement', () => {
    const uid = store.pseudonymise('user:audit');
    const good = diagnoseProfile({ netIncome: 200000, coreExpenses: 20000, rent: 0, liquidReserves: 2000000, debts: [] });
    const bad = diagnoseProfile(ARCHETYPE_BY_ID.D.profile);
    store.audits.record(uid, bad);
    store.audits.record(uid, good);

    const trend = store.audits.trend(uid);
    expect(trend).toHaveLength(2);
    expect(trend[0].tier).toBe(4);
    expect(trend[1].tier).toBe(1);
    expect(trend[1].tierChange).toBe(-3);
  });
});

describe('consent, retention and erasure (task section 11)', () => {
  it('records and reports consent', () => {
    const uid = store.pseudonymise('user:consent');
    expect(store.consent.hasConsent(uid)).toBe(false);
    store.consent.record(uid, { noticeVersion: 'v1', purpose: 'diagnostic', retentionDays: 90 });
    expect(store.consent.hasConsent(uid)).toBe(true);
    expect(store.consent.latest(uid).retentionDays).toBe(90);
  });

  it('cascades an erasure across every table', () => {
    const uid = store.pseudonymise('user:erase');
    store.users.ensure(uid);
    store.users.update(uid, fieldsFromProfile(ARCHETYPE_BY_ID.C.profile));
    store.debts.replaceAll(uid, ARCHETYPE_BY_ID.C.profile.debts);
    store.expenses.add(uid, { amount: 100, category: 'Groceries', isEssential: true });
    store.audits.record(uid, diagnoseProfile(ARCHETYPE_BY_ID.C.profile));
    store.consent.record(uid, { noticeVersion: 'v1', purpose: 'diagnostic', retentionDays: 90 });
    store.events.log(uid, 'AUDIT_COMPLETED');

    const counts = store.retention.deleteAllFor(uid);
    expect(counts.users).toBe(1);
    expect(store.users.get(uid)).toBeNull();
    expect(store.debts.list(uid)).toHaveLength(0);
    expect(store.expenses.listAll(uid)).toHaveLength(0);
    expect(store.audits.list(uid)).toHaveLength(0);
    expect(store.consent.hasConsent(uid)).toBe(false);
    expect(store.events.recent(uid)).toHaveLength(0);
  });

  it('purges only users past the retention window', () => {
    const fresh = store.pseudonymise('user:fresh');
    const stale = store.pseudonymise('user:stale');
    store.users.ensure(fresh);
    store.users.ensure(stale);
    store.raw.prepare("UPDATE users SET last_seen_at = datetime('now','-200 days') WHERE id = ?").run(stale);

    const purged = store.retention.purgeInactive(90);
    expect(purged.users).toBe(1);
    expect(store.users.get(fresh)).not.toBeNull();
    expect(store.users.get(stale)).toBeNull();
  });

  it('logs event kinds but never message bodies', () => {
    const uid = store.pseudonymise('user:events');
    store.events.log(uid, 'EXPENSE_LOGGED');
    const rows = store.events.recent(uid);
    expect(rows[0].kind).toBe('EXPENSE_LOGGED');
    // The events table has no body column at all.
    const cols = store.query('PRAGMA table_info(events)').map((c) => c.name);
    expect(cols).toEqual(['id', 'user_id', 'kind', 'created_at']);
  });

  it('minimises a description when it is stored at all', () => {
    // Digits and punctuation are stripped so a description cannot carry an amount, and
    // the result is truncated so it cannot carry a long free-text note.
    expect(minimiseDescription('Medicine for Asha at Apollo, 400 rupees')).toBe('medicine for asha at apollo rupees');
    expect(minimiseDescription('400')).toBeNull();
    expect(minimiseDescription('₹1,234.56')).toBeNull();
    expect(minimiseDescription('a'.repeat(120)).length).toBe(40);
  });
});
