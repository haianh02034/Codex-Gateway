'use strict';

/**
 * Reports and, with `--setup`, configures the platform sandbox.
 *
 *   npm run codex:sandbox            check readiness
 *   npm run codex:sandbox -- --setup configure it
 *
 * This matters more than it looks. When the sandbox is not configured, Codex
 * quietly applies a read-only policy instead of the requested workspace-write
 * and never says so at the point of use — an agent that cannot edit files
 * looks exactly like one that can until you ask it to.
 *
 * The setup helper next to the binary is not meant to be run directly; it
 * takes an encoded payload from the app-server, which is why this goes through
 * the protocol instead.
 */

const { spawn } = require('node:child_process');

const { resolveCodexBinary } = require('./resolve-codex');

const SETUP = process.argv.includes('--setup');
const MODE = process.argv.includes('--unelevated') ? 'unelevated' : 'elevated';

let binary;
try {
  binary = resolveCodexBinary();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const child = spawn(binary, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);

let buffer = '';
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    handle(message);
  }
});

function handle(message) {
  if (message.id === 1) {
    send({ method: 'initialized' });
    send({ id: 2, method: 'windowsSandbox/readiness', params: {} });
    return;
  }

  if (message.id === 2) {
    const status = message.result?.status ?? 'unknown';
    console.log(`Sandbox readiness: ${status}`);

    if (status === 'ready') {
      console.log('Codex can apply workspace-write.');
      process.exit(0);
    }

    if (!SETUP) {
      console.log('\nRun `npm run codex:sandbox -- --setup` to configure it.');
      console.log('Until then Codex falls back to read-only and cannot edit files.');
      process.exit(1);
    }

    console.log(`Configuring (${MODE})… approve the elevation prompt if one appears.`);
    send({ id: 3, method: 'windowsSandbox/setupStart', params: { mode: MODE } });
    return;
  }

  if (message.id === 3 && message.error) {
    console.error('Setup could not start:', message.error.message);
    process.exit(1);
  }

  if (message.method === 'windowsSandbox/setupCompleted') {
    const { success, error } = message.params;
    console.log(success ? 'Setup finished.' : `Setup failed: ${error ?? 'no reason given'}`);
    // Readiness is re-read by the next app-server process, so check again.
    send({ id: 4, method: 'windowsSandbox/readiness', params: {} });
    return;
  }

  if (message.id === 4) {
    console.log(`Sandbox readiness now: ${message.result?.status ?? 'unknown'}`);
    process.exit(0);
  }
}

send({
  id: 1,
  method: 'initialize',
  params: { clientInfo: { name: 'codex-gateway-sandbox', title: null, version: '0.1.0' }, capabilities: null },
});

setTimeout(() => {
  console.error('Timed out waiting for the app-server.');
  process.exit(1);
}, 180_000);
