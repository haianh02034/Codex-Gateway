import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  ConversationView,
  ConversationsService,
  ResumedConversation,
} from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';

/**
 * Every route here is scoped to the signed-in user by the service, which
 * resolves the conversation against their id before touching Codex. No route
 * accepts a Codex thread id — that would bypass the only ownership check the
 * system has.
 */
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ConversationView[]> {
    return this.conversations.listForUser(user);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateConversationDto,
  ): Promise<ConversationView> {
    return this.conversations.create(user, dto.title ?? '');
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ConversationView> {
    return this.conversations.getForUser(user, id);
  }

  /** Loads the thread back into Codex and reports its live state. */
  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  resume(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ResumedConversation> {
    return this.conversations.resume(user, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<{ deleted: true }> {
    return this.conversations.remove(user, id);
  }
}
