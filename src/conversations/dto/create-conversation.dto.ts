import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateConversationDto {
  /** Free-text label. Phase 4 can derive one from the first message instead. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
