/**
 * cli/audit.js
 * Non-interactive audit. Feed it a profile as JSON (file or stdin) and get the v2
 * diagnostic as text, JSON or a printable HTML report.
 *
 *   node cli/audit.js --file profile.json
 *   node cli/audit.js --file profile.json --json
 *   node cli/audit.js --file profile.json --html out.html
 *   cat profile.json | node cli/audit.js --stdin
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { isMainModule } from '../tools/is_main.js';
import { diagnoseProfile } from '../core/profile.js';
import { buildReport, toTextReport, toHtmlReport, toJsonReport } from '../core/report.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

export function runAuditCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const raw = args.file ? readFileSync(String(args.file), 'utf8') : args.stdin ? readStdin() : null;
  if (raw === null) {
    process.stderr.write('Usage: node cli/audit.js --file <profile.json> [--json] [--html <out.html>]\n');
    return 1;
  }

  let profile;
  try {
    profile = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`Could not parse the profile JSON: ${err.message}\n`);
    return 1;
  }

  const diagnostic = diagnoseProfile(profile);
  if (!diagnostic.ok) {
    process.stderr.write(`${diagnostic.message}\n`);
    return 2;
  }

  const report = buildReport(diagnostic, { profile, generatedAt: new Date().toISOString() });

  if (args.html) {
    writeFileSync(String(args.html), toHtmlReport(report), 'utf8');
    process.stdout.write(`Wrote ${args.html}\n`);
  }
  if (args.json) {
    process.stdout.write(`${JSON.stringify(toJsonReport(report), null, 2)}\n`);
  } else if (!args.html) {
    process.stdout.write(`${toTextReport(report)}\n`);
  }
  return 0;
}

if (isMainModule(import.meta.url)) process.exit(runAuditCli());

export default { runAuditCli };
