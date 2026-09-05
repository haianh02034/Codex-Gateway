import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CodexConfig } from '../../config/configuration';

const execFileAsync = promisify(execFile);

/**
 * Same mapping the `@openai/codex` launcher uses. Replicated here so the
 * gateway can spawn the native binary directly: going through the launcher
 * would put an extra Node process between NestJS and a long-lived app-server,
 * which complicates signal handling on Windows for no benefit.
 */
const PLATFORM_PACKAGE_BY_TARGET: Record<string, string> = {
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
  'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
  'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64',
};

const TARGET_TRIPLE_BY_PLATFORM: Record<string, Record<string, string>> = {
  linux: { x64: 'x86_64-unknown-linux-musl', arm64: 'aarch64-unknown-linux-musl' },
  android: { x64: 'x86_64-unknown-linux-musl', arm64: 'aarch64-unknown-linux-musl' },
  darwin: { x64: 'x86_64-apple-darwin', arm64: 'aarch64-apple-darwin' },
  win32: { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' },
};

export interface CodexBinaryInfo {
  path: string;
  version: string;
  /** Resolved from node_modules, or pointed at by CODEX_BIN. */
  source: 'bundled' | 'override';
}

/**
 * Locates the Codex executable and reports its version.
 *
 * Resolving from node_modules rather than PATH means the Codex version is
 * pinned by package.json, so a machine-wide `codex update` cannot silently
 * change the protocol underneath the gateway.
 */
@Injectable()
export class CodexBinaryService implements OnModuleInit {
  private readonly logger = new Logger(CodexBinaryService.name);
  private readonly config: CodexConfig;

  private binaryPath: string | null = null;
  private cachedVersion: string | null = null;

  constructor(config: ConfigService) {
    this.config = config.getOrThrow<CodexConfig>('codex');
  }

  async onModuleInit(): Promise<void> {
    // Fail loudly at boot rather than on the first request.
    try {
      const info = await this.describe();
      this.logger.log(`Codex ${info.version} (${info.source}) at ${info.path}`);
    } catch (error) {
      this.logger.error(
        `Codex binary unavailable — /health/codex will report unhealthy. ${(error as Error).message}`,
      );
    }
  }

  /** Absolute path to the native executable. Throws if it cannot be found. */
  getBinaryPath(): string {
    if (this.binaryPath) return this.binaryPath;

    const override = this.config.binaryOverride.trim();
    if (override) {
      if (!existsSync(override)) {
        throw new Error(`CODEX_BIN points at ${override}, which does not exist`);
      }
      this.binaryPath = override;
      return this.binaryPath;
    }

    this.binaryPath = this.resolveBundledBinary();
    return this.binaryPath;
  }

  /** Path plus version, with the version cached after the first call. */
  async describe(): Promise<CodexBinaryInfo> {
    const binary = this.getBinaryPath();

    if (!this.cachedVersion) {
      const { stdout } = await execFileAsync(binary, ['--version'], {
        timeout: 15_000,
        windowsHide: true,
      });
      this.cachedVersion = stdout.trim();
    }

    return {
      path: binary,
      version: this.cachedVersion,
      source: this.config.binaryOverride.trim() ? 'override' : 'bundled',
    };
  }

  /**
   * Environment for spawned Codex processes. CODEX_HOME decides where
   * auth.json and sessions/ live — machine-global state shared by every
   * gateway user, which is why Codex login is an admin-only action.
   */
  buildEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
    const home = this.config.home.trim();
    if (home) env.CODEX_HOME = home;
    return env;
  }

  private resolveBundledBinary(): string {
    const { platform, arch } = process;
    const targetTriple = TARGET_TRIPLE_BY_PLATFORM[platform]?.[arch];

    if (!targetTriple) {
      throw new Error(`Codex does not ship a binary for ${platform} ${arch}`);
    }

    const platformPackage = PLATFORM_PACKAGE_BY_TARGET[targetTriple];
    const executable = platform === 'win32' ? 'codex.exe' : 'codex';

    const candidates: string[] = [];

    try {
      const manifest = require.resolve(`${platformPackage}/package.json`);
      candidates.push(path.join(path.dirname(manifest), 'vendor', targetTriple, 'bin', executable));
    } catch {
      // Optional dependency missing; fall through to the launcher-adjacent path.
    }

    try {
      const manifest = require.resolve('@openai/codex/package.json');
      candidates.push(path.join(path.dirname(manifest), 'vendor', targetTriple, 'bin', executable));
    } catch {
      // @openai/codex itself is missing — reported below.
    }

    const found = candidates.find((candidate) => existsSync(candidate));
    if (found) return found;

    throw new Error(
      `Could not find the Codex executable for ${targetTriple}. ` +
        `Run \`npm install\` to restore ${platformPackage}, or set CODEX_BIN to an existing binary.`,
    );
  }
}
