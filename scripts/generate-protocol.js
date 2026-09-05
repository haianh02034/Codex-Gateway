'use strict';

/**
 * Regenerates the app-server protocol bindings from the pinned Codex binary.
 *
 *   npm run codex:protocol
 *
 * The output is committed on purpose: the diff of src/codex/protocol/generated
 * is the most accurate protocol changelog available when Codex is upgraded.
 * Never hand-edit those files.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { resolveCodexBinary } = require('./resolve-codex');

const OUT_DIR = path.join(__dirname, '..', 'src', 'codex', 'protocol', 'generated');

let binary;
try {
  binary = resolveCodexBinary();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const version = spawnSync(binary, ['--version'], { encoding: 'utf8', windowsHide: true });
if (version.status !== 0) {
  console.error('Could not run the Codex binary:', version.stderr || version.error);
  process.exit(1);
}

console.log(`Codex:  ${version.stdout.trim()}`);
console.log(`Output: ${OUT_DIR}`);

// Drop the previous output so removed protocol types disappear from the diff
// instead of lingering as dead files.
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const result = spawnSync(binary, ['app-server', 'generate-ts', '--out', OUT_DIR], {
  stdio: 'inherit',
  windowsHide: true,
});

if (result.status !== 0) {
  console.error('generate-ts failed');
  process.exit(result.status ?? 1);
}

const count = countTsFiles(OUT_DIR);
fs.writeFileSync(
  path.join(OUT_DIR, 'GENERATED.md'),
  [
    '# Generated protocol bindings',
    '',
    'Do not edit these files by hand.',
    '',
    `- Codex version: \`${version.stdout.trim()}\``,
    `- Files: ${count}`,
    '- Regenerate: `npm run codex:protocol`',
    '',
    'Committed deliberately. The diff of this directory after a Codex upgrade',
    'is the protocol changelog.',
    '',
  ].join('\n'),
);

console.log(`Wrote ${count} .ts files`);

function countTsFiles(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) total += countTsFiles(path.join(dir, entry.name));
    else if (entry.name.endsWith('.ts')) total += 1;
  }
  return total;
}
