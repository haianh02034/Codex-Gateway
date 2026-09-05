import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CodexConfig } from '../config/configuration';

/** Windows compares paths case-insensitively; Linux and macOS do not. */
const CASE_INSENSITIVE = process.platform === 'win32';

@Injectable()
export class WorkspacePathService implements OnModuleInit {
  private readonly logger = new Logger(WorkspacePathService.name);

  /** Allowlisted roots, fully resolved. Nothing outside these is reachable. */
  private readonly roots: string[];

  constructor(config: ConfigService) {
    const configured = config.getOrThrow<CodexConfig>('codex').workspaceRoots;
    this.roots = configured.map((root) => path.resolve(root));
  }

  /**
   * Refuses to start on an unusable allowlist. Booting anyway would leave every
   * project request failing for a reason nobody would look for.
   */
  onModuleInit(): void {
    if (this.roots.length === 0) {
      throw new Error('CODEX_WORKSPACE_ROOTS is empty — the gateway has nowhere to run threads');
    }

    for (const root of this.roots) {
      if (!existsSync(root) || !statSync(root).isDirectory()) {
        throw new Error(`CODEX_WORKSPACE_ROOTS contains a path that is not a directory: ${root}`);
      }
    }

    this.logger.log(`Workspace roots: ${this.roots.join(', ')}`);
  }

  get allowedRoots(): string[] {
    return [...this.roots];
  }

  /**
   * Resolves a caller-supplied directory, or refuses it.
   *
   * Every check here exists because of a specific way out. Symlinks are the
   * subtle one: a link sitting inside an allowed root can point anywhere, so
   * containment is judged on the resolved target, never on the path as typed.
   *
   * @returns the real, canonical path — the value that should be handed to
   *   Codex, since it is what the sandbox will actually enforce against.
   */
  resolveWithin(candidate: string): string {
    const raw = candidate?.trim();

    if (!raw) {
      throw new BadRequestException('A workspace path is required');
    }

    // A NUL byte truncates the path inside native calls, so what gets checked
    // and what gets opened would differ.
    if (raw.includes('\0')) {
      throw new BadRequestException('That workspace path is not valid');
    }

    // UNC and extended-length prefixes reach network shares and bypass the
    // normalisation the checks below rely on.
    if (raw.startsWith('\\\\') || raw.startsWith('//')) {
      throw new BadRequestException('Network paths are not allowed');
    }

    if (!path.isAbsolute(raw)) {
      throw new BadRequestException('The workspace path must be absolute');
    }

    // resolve() collapses `..`; realpath() then follows every symlink, so a
    // link inside an allowed root cannot smuggle the target outside it.
    const resolved = path.resolve(raw);

    if (!existsSync(resolved)) {
      throw new BadRequestException(
        'That directory does not exist. Create it first, then add the project.',
      );
    }

    let real: string;
    try {
      real = realpathSync.native(resolved);
    } catch {
      throw new BadRequestException('That workspace path could not be read');
    }

    if (!statSync(real).isDirectory()) {
      throw new BadRequestException('The workspace path must be a directory');
    }

    const root = this.roots.find((candidateRoot) => this.contains(candidateRoot, real));
    if (!root) {
      this.logger.warn(`Rejected workspace path outside every allowed root: ${real}`);
      throw new BadRequestException(
        'That directory is outside the folders this gateway is allowed to use',
      );
    }

    return real;
  }

  /**
   * The private directory a user gets when they have not chosen a project.
   *
   * Per user rather than one shared folder: with workspace-write, an agent can
   * read and write anywhere under its cwd, so a common default would let one
   * person's agent walk through everybody else's files.
   *
   * The path is composed here from the root and the user id, never taken from
   * the caller, which is why creating it is safe.
   */
  personalWorkspace(userId: string): string {
    if (!/^[a-f\d]{24}$/i.test(userId)) {
      throw new BadRequestException('Invalid user');
    }

    const directory = path.join(this.roots[0], 'users', userId);
    mkdirSync(directory, { recursive: true });

    return realpathSync.native(directory);
  }

  private contains(root: string, target: string): boolean {
    const normalisedRoot = this.normalise(root);
    const normalisedTarget = this.normalise(target);

    if (normalisedTarget === normalisedRoot) return true;

    // The separator matters: without it, /srv/work-secrets would look like it
    // sits inside /srv/work.
    return normalisedTarget.startsWith(normalisedRoot + path.sep);
  }

  private normalise(value: string): string {
    const trimmed = value.endsWith(path.sep) ? value.slice(0, -1) : value;
    return CASE_INSENSITIVE ? trimmed.toLowerCase() : trimmed;
  }
}
