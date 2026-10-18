/**
 * web/src/storage.js
 * Persistent local storage for the dashboard.
 *
 * The dashboard is offline-first: the profile, expense log and audit history live in the
 * browser's localStorage on this device and are never sent anywhere. There is no account,
 * no telemetry and no outbound request (the whitepaper's "offline dashboard" intent).
 *
 * The bot/CLI use SQLite (store/) with the same data shapes; the two are interchangeable
 * via the JSON export, which is the documented bridge.
 */

const KEY = 'drc.dashboard.v2';
const SCHEMA_VERSION = 2;

export function defaultState() {
  return {
    version: SCHEMA_VERSION,
    consent: false,
    currency: 'INR',
    profile: null,
    expenses: [],
    audits: [],
    step: 'income',
    resultTab: 'summary',
    updatedAt: null,
  };
}

function safeParse(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Load persisted state, migrating older versions. Never throws. */
export function loadState(storage = globalThis.localStorage) {
  if (!storage) return defaultState();
  const raw = storage.getItem(KEY);
  if (!raw) return defaultState();
  const parsed = safeParse(raw);
  if (!parsed) return defaultState();
  return {
    ...defaultState(),
    ...parsed,
    version: SCHEMA_VERSION,
    expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
    audits: Array.isArray(parsed.audits) ? parsed.audits : [],
  };
}

export function saveState(state, storage = globalThis.localStorage) {
  if (!storage) return false;
  try {
    storage.setItem(KEY, JSON.stringify({ ...state, version: SCHEMA_VERSION, updatedAt: new Date().toISOString() }));
    return true;
  } catch {
    return false;
  }
}

/** DELETE MY DATA for the dashboard: erase the local store completely. */
export function clearState(storage = globalThis.localStorage) {
  if (!storage) return;
  storage.removeItem(KEY);
}

/** Export everything as a JSON string the user can keep or import elsewhere. */
export function exportJson(state) {
  return JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
}

/** Import a previously exported JSON blob. Returns the state or null when invalid. */
export function importJson(text) {
  const parsed = safeParse(text);
  if (!parsed || typeof parsed !== 'object') return null;
  return {
    ...defaultState(),
    ...parsed,
    version: SCHEMA_VERSION,
    expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
    audits: Array.isArray(parsed.audits) ? parsed.audits : [],
  };
}

/** Append an audit snapshot and keep the history bounded. */
export function recordAudit(audits, diagnostic) {
  const entry = {
    id: `${Date.now()}`,
    takenAt: new Date().toISOString(),
    tier: diagnostic.tier,
    tierLabel: diagnostic.tierLabel,
    foir: Number(diagnostic.metrics.foir.toFixed(2)),
    dcf: Math.round(diagnostic.metrics.dcf),
    runway: Number.isFinite(diagnostic.metrics.er) ? Number(diagnostic.metrics.er.toFixed(2)) : null,
    debt: Math.round(diagnostic.metrics.totalBalance),
    interestBurn: Math.round(diagnostic.metrics.interestBurn),
  };
  return [entry, ...audits].slice(0, 50);
}

export { SCHEMA_VERSION, KEY };
export default { loadState, saveState, clearState, exportJson, importJson, recordAudit, defaultState };
