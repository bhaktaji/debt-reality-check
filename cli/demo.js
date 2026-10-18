/**
 * cli/demo.js
 * End-to-end demonstration of the whole product with no credentials and no network.
 *
 *   node cli/demo.js
 *
 * It drives a real conversation through the shared router (consent -> audit -> debt
 * entry -> diagnostic -> expense logging -> summary -> history), then writes a
 * printable HTML audit report to dist/demo-audit-report.html.
 *
 * This is the same code path the WhatsApp adapters use, so what you see here is what a
 * user gets on any channel.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { isMainModule } from '../tools/is_main.js';
import { openDatabase } from '../store/db.js';
import { createRouter } from '../bot/router.js';
import { profileFromStore } from '../store/mappers.js';
import { diagnoseProfile } from '../core/profile.js';
import { buildReport, toHtmlReport } from '../core/report.js';
import { summariseExpenses, crossCheckCoreCosts, reviewTargets } from '../core/expense_history.js';
import { inr } from '../core/formatting.js';

const SCRIPT = [
  // First contact -> consent notice, then consent
  'medicine 400',
  'AGREE',
  'AUDIT',
  // Income
  '45,000', 'yes',
  // Income history
  'skip',
  // Rent
  '12,000', 'yes',
  // Core expenses
  '22,000', 'yes',
  // Liquid reserves
  '10,000', 'yes',
  // Household
  '1', '0', 'no',
  // Debt 1: a credit card (1 in the friendly list), so it asks for the credit limit
  'HDFC credit card', '1', 'no', '65,000', 'yes', '3,500', 'yes', '42', '1,00,000', 'yes',
  // Debt 2: a personal loan (2 in the friendly list), so no credit limit is asked for
  'Personal loan', '2', 'no', '1,20,000', 'yes', '4,500', 'yes', '16',
  // Finish debts
  'done',
  // Run the diagnostic
  'DONE',
  // Expense logging after the audit (loop closure)
  'electricity 1500',
  '2 eggs 30', 'yes',
  'cola 40', 'D',
  'school fees 3000',
  'SUMMARY',
  'HISTORY',
];

export function runDemo({ quiet = false } = {}) {
  const store = openDatabase({ path: ':memory:', secret: 'demo-secret-not-for-production' });
  const router = createRouter({ store, config: { retentionDays: 90 } });
  const rawId = 'demo:local-user';
  const transcript = [];

  const log = (s) => {
    if (!quiet) process.stdout.write(s);
    transcript.push(s);
  };

  log('='.repeat(78) + '\n');
  log('DEBT REALITY CHECK - END-TO-END DEMO (console channel, in-memory database)\n');
  log('='.repeat(78) + '\n');

  for (const message of SCRIPT) {
    log(`\n> ${message}\n`);
    const { replies } = router.handle(rawId, message);
    for (const reply of replies) log(`${reply}\n`);
  }

  // Build the printable report from what is actually stored.
  const uid = store.pseudonymise(rawId);
  const profile = profileFromStore(store.users.get(uid), store.debts.list(uid));
  const diagnostic = diagnoseProfile(profile);
  if (!diagnostic.ok) {
    log(`\nDemo stopped early: ${diagnostic.message}\n`);
    store.close();
    return { diagnostic, transcript, outPath: null };
  }
  const expenses = summariseExpenses(store.expenses.listAll(uid), { now: new Date(), days: 30 });
  const report = buildReport(diagnostic, {
    generatedAt: new Date().toISOString(),
    expenses: { ...expenses, ...reviewTargets(expenses) },
    expenseCrossCheck: crossCheckCoreCosts(profile.coreExpenses, expenses),
    history: store.audits.list(uid, 10),
  });

  mkdirSync('dist', { recursive: true });
  const outPath = 'dist/demo-audit-report.html';
  writeFileSync(outPath, toHtmlReport(report), 'utf8');

  log('\n' + '='.repeat(78) + '\n');
  log(`Stored: 1 user (pseudonym ${uid.slice(0, 12)}...), ${profile.debts.length} debt(s), ${store.expenses.listAll(uid).length} expense(s), ${store.audits.list(uid).length} audit(s).\n`);
  log(`Verdict: Tier ${diagnostic.tier} - ${diagnostic.tierLabel}. Interest burn ${inr(diagnostic.metrics.interestBurn)}/month.\n`);
  log(`HTML report written to ${outPath}\n`);
  log('='.repeat(78) + '\n');

  store.close();
  return { report, diagnostic, transcript, outPath };
}

if (isMainModule(import.meta.url)) runDemo();

export default { runDemo, SCRIPT };
