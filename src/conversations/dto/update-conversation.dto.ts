import { IsString, MaxLength } from 'class-validator';

export class UpdateConversationDto {
  /** Free-text label. Clients usually derive it from the first message. */
  @IsString()
  @MaxLength(200)
  title!: string;
}
