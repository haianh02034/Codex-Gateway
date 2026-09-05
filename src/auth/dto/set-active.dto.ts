import { IsBoolean } from 'class-validator';

export class SetActiveDto {
  @IsBoolean()
  active!: boolean;
}
