import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateProjectDto {
  /** Only the label can change. Moving a project means creating a new one. */
  @IsString()
  @IsNotEmpty({ message: 'A project name is required' })
  @MaxLength(120)
  name!: string;
}
