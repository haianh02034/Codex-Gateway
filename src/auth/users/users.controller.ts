import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';

import { AdminGuard } from '../../common/guards/admin.guard';
import { UserRole } from '../auth.types';
import { CreateUserDto } from '../dto/create-user.dto';
import { SetActiveDto } from '../dto/set-active.dto';
import { UsersService, UserSummary } from './users.service';

/**
 * Account administration.
 *
 * There is no public sign-up: accounts are created here on purpose, because
 * every user of this gateway shares one Codex identity and therefore one quota.
 * Handing someone an account spends the same allowance as your own.
 */
@UseGuards(AdminGuard)
@Controller('admin/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(): Promise<UserSummary[]> {
    return this.users.list();
  }

  @Post()
  create(@Body() dto: CreateUserDto): Promise<UserSummary> {
    return this.users.create(dto.email, dto.password, dto.role ?? UserRole.User);
  }

  /** Disabling ends that user's sessions on their next request. */
  @Patch(':id/active')
  setActive(@Param('id') id: string, @Body() dto: SetActiveDto): Promise<UserSummary> {
    return this.users.setActive(id, dto.active);
  }
}
