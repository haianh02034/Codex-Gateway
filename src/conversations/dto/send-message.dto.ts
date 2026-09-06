import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { ChatMode } from '../../codex/modes/chat-mode';

export class SendMessageDto {
  @IsString()
  @IsNotEmpty({ message: 'Message cannot be empty' })
  @MaxLength(100_000)
  text!: string;

  /**
   * Switches the conversation's mode for this message and the ones after it.
   * Omit to keep whatever it was.
   */
  @IsOptional()
  @IsEnum(ChatMode, { message: 'mode must be "instant" or "think"' })
  mode?: ChatMode;
}
