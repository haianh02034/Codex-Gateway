import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { AuthUser, LoginResult } from './auth.types';
import { LoginDto } from './dto/login.dto';

/**
 * Authentication for users of this gateway.
 *
 * Not to be confused with /admin/codex/auth, which drives Codex's own login
 * against ChatGPT. That one is machine-global; this one is per user.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Rate limited per IP. The endpoint answers identically for a wrong password
   * and an unknown address, so the only way to learn anything from it is to
   * keep guessing — which is what this stops.
   */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ login: {} })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<LoginResult> {
    return this.auth.login(dto.email, dto.password);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}
