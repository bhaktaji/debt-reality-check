/**
 * tools/is_main.js
 * Cross-platform "was this file run directly?" check.
 *
 * Comparing import.meta.url to a hand-built `file://${argv[1]}` string breaks on Windows
 * (drive letters and backslashes). pathToFileURL does it correctly everywhere.
 */

import { pathToFileURL } from 'node:url';

export function isMainModule(importMetaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return importMetaUrl === pathToFileURL(argv1).href;
  } catch {
    return false;
  }
}

export default { isMainModule };
