import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';

import { AdminGuard } from '../../common/guards/admin.guard';
import { CodexAuthService } from './codex-auth.service';
import {
  CancelLoginResult,
  CodexAdminAuthStatus,
  CodexLoginMethod,
  LogoutResult,
  StartLoginResult,
} from './codex-auth.types';
import { StartCodexLoginDto } from './dto/start-login.dto';

/**
 * Host-wide Codex authentication.
 *
 * Codex keeps one identity for the whole machine, so every route here changes
 * the world for every user of the gateway at once: signing out logs everyone
 * out, and completing a login URL decides whose ChatGPT account the gateway
 * runs as. That is the entire reason for AdminGuard.
 */
@UseGuards(AdminGuard)
@Controller('admin/codex/auth')
export class CodexAdminAuthController {
  constructor(private readonly auth: CodexAuthService) {}

  /** Status plus the signed-in account and any login still in flight. */
  @Get('status')
  status(): Promise<CodexAdminAuthStatus> {
    return this.auth.getAdminStatus();
  }

  /**
   * Starts a login and returns the URL to open. Any unfinished login is
   * cancelled first, so the URL handed back is always a working one.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: StartCodexLoginDto): Promise<StartLoginResult> {
    return this.auth.startLogin(dto.method ?? CodexLoginMethod.Browser);
  }

  @Post('login/cancel')
  @HttpCode(HttpStatus.OK)
  cancelLogin(): Promise<CancelLoginResult> {
    return this.auth.cancelLogin();
  }

  /** Signs Codex out for everyone using this gateway. */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(): Promise<LogoutResult> {
    return this.auth.logout();
  }
}
