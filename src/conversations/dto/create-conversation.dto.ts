import { IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateConversationDto {
  /** Free-text label. Phase 4 can derive one from the first message instead. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  /**
   * Run this conversation in a project's directory. Omit to use the caller's
   * own private workspace.
   */
  @IsOptional()
  @IsMongoId({ message: 'projectId must be a valid id' })
  projectId?: string;
}
