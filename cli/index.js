/**
 * cli/index.js
 * CLI dispatcher.
 *
 *   node cli/index.js demo                       # full end-to-end conversation
 *   node cli/index.js calibrate [--boundaries]   # archetypes / band edges
 *   node cli/index.js audit --file profile.json  # non-interactive audit
 */

import { isMainModule } from '../tools/is_main.js';
import { runDemo } from './demo.js';
import { runCalibrateCli } from './calibrate.js';
import { runAuditCli } from './audit.js';

export function runCli(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  switch (command) {
    case 'demo':
      runDemo();
      return 0;
    case 'calibrate':
      return runCalibrateCli(rest);
    case 'audit':
      return runAuditCli(rest);
    case 'help':
    case undefined:
    default:
      process.stdout.write(
        [
          'Debt Reality Check CLI',
          '',
          '  node cli/index.js demo                       full end-to-end conversation',
          '  node cli/index.js calibrate [--boundaries]   archetypes / band-edge sweep',
          '  node cli/index.js audit --file profile.json  non-interactive audit',
          '',
        ].join('\n'),
      );
      return 0;
  }
}

if (isMainModule(import.meta.url)) process.exit(runCli());

export default { runCli };
