/**
 * cli/calibrate.js
 * Calibration and boundary harness.
 *
 *   node cli/calibrate.js             # the four archetypes under v2
 *   node cli/calibrate.js --boundaries  # every documented band edge
 *
 * The cut-offs are rules of thumb. This tool makes their behaviour visible so they can
 * be reviewed with pilot evidence (C.9, E.4) rather than changed by accident.
 */

import { isMainModule } from '../tools/is_main.js';
import { runDiagnosticV2 } from '../core/engine_v2.js';
import { tierUp, tierDown, POLICY, TIER_LABELS } from '../core/policy.js';
import { ARCHETYPES } from '../tests/fixtures/archetypes.js';
import { diagnoseProfile } from '../core/profile.js';
import { pct, months } from '../core/formatting.js';

function pad(s, n) {
  return String(s).padEnd(n);
}

export function archetypeTable() {
  const rows = [['ID', 'Name', 'FOIR', 'DCF%', 'Runway', 'Flow', 'Final', 'Drivers']];
  for (const a of ARCHETYPES) {
    const d = diagnoseProfile(a.profile);
    rows.push([
      a.id,
      a.name,
      pct(d.metrics.foir),
      pct(d.metrics.dcfPct),
      months(d.metrics.er),
      d.flowTier,
      d.tier,
      d.drivers.join('+') || '-',
    ]);
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows.map((r) => r.map((c, i) => pad(c, widths[i])).join('  ')).join('\n');
}

export function boundaryTable() {
  const lines = [];
  const cut = (metric, value, got, expected) =>
    lines.push(`${pad(metric, 34)} ${pad(value, 12)} -> tier ${got} ${got === expected ? 'OK' : `EXPECTED ${expected}`}`);

  for (const [v, e] of [[39.99, 1], [40, 2], [50, 3], [65, 4]]) cut('FOIR %', v, tierUp(v, POLICY.foirCuts), e);
  for (const [v, e] of [[25, 1], [24.99, 2], [10, 2], [9.99, 3], [0, 3]]) cut('DCF % of income', v, tierDown(v, POLICY.dcfPctCuts), e);
  for (const [v, e] of [[6, 1], [5.99, 2], [3, 2], [2.99, 3], [1, 3], [0.99, 4]]) cut('Runway months', v, tierDown(v, POLICY.erCuts), e);

  // Deficit horizon: reserves / monthly shortfall
  for (const [ratio, e] of [[5.99, 4], [6.0, 3]]) {
    const d = runDiagnosticV2({
      netIncome: 50000, coreExpenses: 40000, rent: 0, liquidReserves: ratio * 1000,
      debts: [{ name: 'x', type: 'installment', secured: false, balance: 100000, minPayment: 11000, apr: 12 }],
    });
    // monthly shortfall is 1,000 by construction
    cut('Deficit (reserves/shortfall)', ratio, d.tiers.dcf, e);
  }

  const override1 = runDiagnosticV2({
    netIncome: 100000, coreExpenses: 5000, liquidReserves: 900000,
    debts: [{ name: 'grower', type: 'revolving', secured: false, balance: 200000, minPayment: 2000, apr: 36, creditLimit: 500000 }],
  });
  cut('Min <= monthly interest override', 'expect >=3', override1.tier, Math.max(3, override1.tier));

  // Dependency escalation replaces DASI: dlf 0.75 with runway 2 months (< 3) raises the
  // tier by exactly one, on top of whatever the runway penalty already did.
  const base = runDiagnosticV2({ netIncome: 100000, coreExpenses: 10000, liquidReserves: 20000, earners: 1, dependents: 0, debts: [] });
  const withDeps = runDiagnosticV2({ netIncome: 100000, coreExpenses: 10000, liquidReserves: 20000, earners: 1, dependents: 3, debts: [] });
  cut('Dependency escalation', `dlf 0.75 runway 2 (+${withDeps.tier - base.tier})`, withDeps.tier, base.tier + 1);

  // Family help must never improve the tier (contingent, unverifiable support).
  const withHelp = runDiagnosticV2({ netIncome: 100000, coreExpenses: 10000, liquidReserves: 20000, earners: 1, dependents: 3, familyHelp: true, debts: [] });
  cut('Family help never improves', 'tier unchanged', withHelp.tier, withDeps.tier);

  lines.push('');
  lines.push(`Tier labels: ${Object.entries(TIER_LABELS).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  lines.push(`Snowball tolerance: <= ${POLICY.snowballMaxExtraCostPct}% of total debt. Runway penalty: max ${POLICY.runwayMaxPenalty} tier.`);
  return lines.join('\n');
}

export function runCalibrateCli(argv = process.argv.slice(2)) {
  if (argv.includes('--boundaries')) {
    process.stdout.write(`${boundaryTable()}\n`);
  } else {
    process.stdout.write('ARCHETYPES (v2)\n');
    process.stdout.write(`${archetypeTable()}\n`);
    process.stdout.write('\nRun with --boundaries for the band-edge sweep.\n');
  }
  return 0;
}

if (isMainModule(import.meta.url)) process.exit(runCalibrateCli());

export default { runCalibrateCli, archetypeTable, boundaryTable };
