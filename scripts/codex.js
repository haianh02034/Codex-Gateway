'use strict';

/**
 * Runs the pinned Codex binary with whatever arguments follow.
 *
 *   npm run codex:version
 *   node scripts/codex.js login status
 *
 * Use this rather than a globally installed `codex`, so you are always talking
 * to the version this gateway is built against.
 */

const { spawn } = require('node:child_process');

const { resolveCodexBinary } = require('./resolve-codex');

let binary;
try {
  binary = resolveCodexBinary();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const child = spawn(binary, process.argv.slice(2), { stdio: 'inherit', windowsHide: true });

child.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
