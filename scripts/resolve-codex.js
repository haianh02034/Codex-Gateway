'use strict';

/**
 * Locates the Codex executable the same way src/codex/binary/codex-binary.service.ts
 * does, for use by npm scripts that run before the app is built.
 */

const fs = require('node:fs');
const path = require('node:path');

const PLATFORM_PACKAGE_BY_TARGET = {
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
  'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
  'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64',
};

const TARGET_TRIPLE_BY_PLATFORM = {
  linux: { x64: 'x86_64-unknown-linux-musl', arm64: 'aarch64-unknown-linux-musl' },
  android: { x64: 'x86_64-unknown-linux-musl', arm64: 'aarch64-unknown-linux-musl' },
  darwin: { x64: 'x86_64-apple-darwin', arm64: 'aarch64-apple-darwin' },
  win32: { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' },
};

function resolveCodexBinary() {
  const override = (process.env.CODEX_BIN || '').trim();
  if (override) {
    if (!fs.existsSync(override)) {
      throw new Error(`CODEX_BIN points at ${override}, which does not exist`);
    }
    return override;
  }

  const { platform, arch } = process;
  const targetTriple = (TARGET_TRIPLE_BY_PLATFORM[platform] || {})[arch];
  if (!targetTriple) {
    throw new Error(`Codex does not ship a binary for ${platform} ${arch}`);
  }

  const platformPackage = PLATFORM_PACKAGE_BY_TARGET[targetTriple];
  const executable = platform === 'win32' ? 'codex.exe' : 'codex';
  const candidates = [];

  for (const pkg of [platformPackage, '@openai/codex']) {
    try {
      const manifest = require.resolve(`${pkg}/package.json`);
      candidates.push(path.join(path.dirname(manifest), 'vendor', targetTriple, 'bin', executable));
    } catch {
      // Not installed; try the next candidate.
    }
  }

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (found) return found;

  throw new Error(
    `Could not find the Codex executable for ${targetTriple}. ` +
      `Run \`npm install\` to restore ${platformPackage}, or set CODEX_BIN.`,
  );
}

module.exports = { resolveCodexBinary };
