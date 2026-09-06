import { Controller, Get } from '@nestjs/common';

import { ChatModeView, ChatModesService } from './chat-modes.service';

/**
 * Lets the client render the mode picker from the gateway's definitions
 * instead of hardcoding a second copy that can drift.
 */
@Controller('codex/modes')
export class ChatModesController {
  constructor(private readonly modes: ChatModesService) {}

  @Get()
  list(): ChatModeView[] {
    return this.modes.list();
  }
}
