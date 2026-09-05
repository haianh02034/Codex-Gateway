import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { WorkspacePathService } from './workspace-path.service';

const isWindows = process.platform === 'win32';

describe('WorkspacePathService', () => {
  let root: string;
  let outside: string;
  let service: WorkspacePathService;

  beforeEach(() => {
    const base = mkdtempSync(path.join(tmpdir(), 'cgw-'));
    root = path.join(base, 'allowed');
    outside = path.join(base, 'forbidden');
    mkdirSync(path.join(root, 'project-a'), { recursive: true });
    mkdirSync(path.join(outside, 'secrets'), { recursive: true });

    service = build([root]);
  });

  afterEach(() => {
    rmSync(path.dirname(root), { recursive: true, force: true });
  });

  const build = (roots: string[]) => {
    const config = {
      getOrThrow: () => ({ workspaceRoots: roots, binaryOverride: '', home: '' }),
    } as unknown as ConfigService;
    const created = new WorkspacePathService(config);
    jest.spyOn(created['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(created['logger'], 'warn').mockImplementation(() => undefined);
    return created;
  };

  describe('accepting', () => {
    it('accepts a directory inside an allowed root', () => {
      const resolved = service.resolveWithin(path.join(root, 'project-a'));
      expect(resolved.toLowerCase()).toContain('project-a');
    });

    it('accepts the root itself', () => {
      expect(() => service.resolveWithin(root)).not.toThrow();
    });

    it('returns the canonical path, not the one supplied', () => {
      // Codex enforces against the real path, so that is what must be stored.
      const messy = path.join(root, 'project-a', '..', 'project-a');
      expect(service.resolveWithin(messy)).toBe(service.resolveWithin(path.join(root, 'project-a')));
    });

    it('honours every configured root', () => {
      const second = path.join(path.dirname(root), 'second');
      mkdirSync(second, { recursive: true });
      const multi = build([root, second]);

      expect(() => multi.resolveWithin(second)).not.toThrow();
    });
  });

  describe('refusing', () => {
    it('refuses a directory outside every root', () => {
      expect(() => service.resolveWithin(path.join(outside, 'secrets'))).toThrow(
        BadRequestException,
      );
    });

    it('refuses an escape by ..', () => {
      const escape = path.join(root, 'project-a', '..', '..', 'forbidden', 'secrets');
      expect(() => service.resolveWithin(escape)).toThrow(BadRequestException);
    });

    it('refuses a sibling whose name starts with the root', () => {
      // /base/allowed-extra must not pass a naive startsWith check against
      // /base/allowed.
      const sibling = `${root}-extra`;
      mkdirSync(sibling, { recursive: true });

      expect(() => service.resolveWithin(sibling)).toThrow(BadRequestException);
    });

    it('refuses a relative path', () => {
      expect(() => service.resolveWithin('project-a')).toThrow(BadRequestException);
    });

    it('refuses a network path', () => {
      expect(() => service.resolveWithin('\\\\server\\share\\work')).toThrow(BadRequestException);
      expect(() => service.resolveWithin('//server/share/work')).toThrow(BadRequestException);
    });

    it('refuses a path containing a NUL byte', () => {
      // The byte truncates the path inside native calls, so the checked path
      // and the opened path would differ.
      expect(() => service.resolveWithin(`${root}\0/../../etc`)).toThrow(BadRequestException);
    });

    it('refuses an empty path', () => {
      expect(() => service.resolveWithin('   ')).toThrow(BadRequestException);
    });

    it('refuses a directory that does not exist', () => {
      expect(() => service.resolveWithin(path.join(root, 'not-there'))).toThrow(
        BadRequestException,
      );
    });

    it('refuses a file', () => {
      const file = path.join(root, 'notes.txt');
      writeFileSync(file, 'x');

      expect(() => service.resolveWithin(file)).toThrow(BadRequestException);
    });
  });

  describe('symlinks', () => {
    it('refuses a link inside the root that points outside it', () => {
      const link = path.join(root, 'escape-hatch');
      try {
        symlinkSync(path.join(outside, 'secrets'), link, isWindows ? 'junction' : 'dir');
      } catch {
        return; // Unprivileged Windows without developer mode; nothing to test.
      }

      // Containment is judged on the resolved target. Checking the path as
      // typed would accept this, since it sits under an allowed root.
      expect(() => service.resolveWithin(link)).toThrow(BadRequestException);
    });

    it('accepts a link that stays inside the root', () => {
      const link = path.join(root, 'alias');
      try {
        symlinkSync(path.join(root, 'project-a'), link, isWindows ? 'junction' : 'dir');
      } catch {
        return;
      }

      expect(service.resolveWithin(link)).toBe(service.resolveWithin(path.join(root, 'project-a')));
    });
  });

  describe('personal workspace', () => {
    const userId = '5f2b1c9d8e7a4b3c2d1e0f01';

    it('creates a private directory under the first root', () => {
      const workspace = service.personalWorkspace(userId);

      expect(workspace.toLowerCase()).toContain(userId.toLowerCase());
      expect(() => service.resolveWithin(workspace)).not.toThrow();
    });

    it('gives different users different directories', () => {
      // A shared default would let one person's agent read and write in
      // everyone else's files, since workspace-write covers the whole cwd.
      const a = service.personalWorkspace(userId);
      const b = service.personalWorkspace('5f2b1c9d8e7a4b3c2d1e0f02');

      expect(a).not.toBe(b);
    });

    it('refuses anything that is not a user id', () => {
      expect(() => service.personalWorkspace('../../etc')).toThrow(BadRequestException);
    });
  });

  describe('startup', () => {
    it('refuses to start with no roots configured', () => {
      expect(() => build([]).onModuleInit()).toThrow(/CODEX_WORKSPACE_ROOTS is empty/);
    });

    it('refuses to start when a root is missing', () => {
      expect(() => build([path.join(root, 'nope')]).onModuleInit()).toThrow(/not a directory/);
    });
  });
});
