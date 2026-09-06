import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  ConversationView,
  ConversationsService,
  ResumedConversation,
} from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MessageView, MessagesService, SendMessageResult } from './messages.service';

/**
 * Every route here is scoped to the signed-in user by the service, which
 * resolves the conversation against their id before touching Codex. No route
 * accepts a Codex thread id — that would bypass the only ownership check the
 * system has.
 */
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ConversationView[]> {
    return this.conversations.listForUser(user);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateConversationDto,
  ): Promise<ConversationView> {
    return this.conversations.create(user, dto.title ?? '', dto.projectId ?? null, dto.mode);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ConversationView> {
    return this.conversations.getForUser(user, id);
  }

  @Patch(':id')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateConversationDto,
  ): Promise<ConversationView> {
    return this.conversations.rename(user, id, dto.title);
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

  @Get(':id/messages')
  messageHistory(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<MessageView[]> {
    return this.messages.list(user, id);
  }

  /**
   * Returns as soon as the turn is under way. The reply itself arrives on the
   * WebSocket namespace /codex, so nothing here blocks on the model.
   */
  @Post(':id/messages')
  @HttpCode(HttpStatus.ACCEPTED)
  send(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ): Promise<SendMessageResult> {
    return this.messages.send(user, id, dto.text, dto.mode);
  }

  @Post(':id/interrupt')
  @HttpCode(HttpStatus.OK)
  interrupt(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<{ interrupted: true }> {
    return this.messages.interrupt(user, id);
  }
}
