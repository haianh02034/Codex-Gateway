import { Controller, Get } from '@nestjs/common';

import { CodexAuthService } from './codex-auth.service';
import { CodexAuthStatus } from './codex-auth.types';

/**
 * Read-only Codex auth state for ordinary users.
 *
 * A user needs to know whether the gateway can reach Codex at all, but nothing
 * here may expose the access token or a login URL. Anyone who opens a login URL
 * binds their own ChatGPT account to this host, so that lives under /admin.
 */
@Controller('codex/auth')
export class CodexAuthController {
  constructor(private readonly auth: CodexAuthService) {}

  @Get('status')
  status(): Promise<CodexAuthStatus> {
    return this.auth.getStatus();
  }
}
