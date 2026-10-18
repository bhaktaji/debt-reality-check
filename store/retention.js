/**
 * store/retention.js
 * Retention TTL and erasure (task section 11, F.1).
 *
 * Pseudonymised data is still personal data. These controls reduce exposure; they do
 * not create an exemption, and the product never claims one.
 */

export const DEFAULT_RETENTION_DAYS = 90;

/** Human-readable retention notice shown on first contact. */
export function retentionNotice(days = DEFAULT_RETENTION_DAYS) {
  return [
    'What is stored: the numbers you send (income, costs, debts, reserves), your expense categories and amounts, and your audit results.',
    'Why: to compute your diagnostic, show your history and cross-check your spending.',
    `For how long: data linked to you is deleted after ${days} days of inactivity, and immediately when you send DELETE MY DATA.`,
    'Your channel id is stored only as a one-way hash, never as a phone number.',
    'No names, no PAN, no Aadhaar, no bank credentials, and no message bodies are stored.',
    'Send DELETE MY DATA at any time to erase everything.',
  ].join('\n');
}

/**
 * Delete users (and, by foreign-key cascade, their debts, expenses, audits and consent
 * rows) that have not been seen for `days`.
 * @returns {{users:number, events:number}}
 */
export function purgeInactive(db, days = DEFAULT_RETENTION_DAYS) {
  const cutoff = `-${Math.max(1, Math.floor(days))} days`;
  const stale = db
    .prepare("SELECT id FROM users WHERE last_seen_at < datetime('now', ?)")
    .all(cutoff)
    .map((r) => r.id);

  if (!stale.length) return { users: 0, events: 0 };

  let events = 0;
  for (const id of stale) {
    events += db.prepare('DELETE FROM events WHERE user_id = ?').run(id).changes;
    db.prepare('DELETE FROM users WHERE id = ?').run(id); // cascades
  }
  return { users: stale.length, events };
}

/**
 * Erase everything for one user (DELETE MY DATA). Returns per-table counts.
 */
export function deleteAllFor(db, userId) {
  const counts = {};
  for (const table of ['expenses', 'debts', 'audits', 'consent', 'events']) {
    counts[table] = db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId).changes;
  }
  counts.users = db.prepare('DELETE FROM users WHERE id = ?').run(userId).changes;
  return counts;
}

export default { purgeInactive, deleteAllFor, retentionNotice, DEFAULT_RETENTION_DAYS };
