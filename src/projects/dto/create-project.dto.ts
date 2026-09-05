import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty({ message: 'A project name is required' })
  @MaxLength(120)
  name!: string;

  /**
   * Absolute path to an existing directory inside an allowed workspace root.
   * Validated and canonicalised before it is stored.
   */
  @IsString()
  @IsNotEmpty({ message: 'A workspace path is required' })
  @MaxLength(4096)
  workspacePath!: string;
}
