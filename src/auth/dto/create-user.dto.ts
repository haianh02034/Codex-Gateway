import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { UserRole } from '../auth.types';

export class CreateUserDto {
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(200)
  password!: string;

  /** Defaults to a regular user. Granting admin hands over Codex sign-in. */
  @IsOptional()
  @IsEnum(UserRole, { message: 'role must be "admin" or "user"' })
  role?: UserRole;
}
