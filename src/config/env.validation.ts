import { plainToInstance } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/**
 * Shape of the process environment. Anything not declared here is ignored —
 * the gateway never reads an undeclared variable.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  @IsOptional()
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  PORT: number = 3000;

  @IsString()
  @IsOptional()
  API_PREFIX: string = 'api';

  @IsString()
  @IsOptional()
  CORS_ORIGINS: string = '';

  /**
   * Signs the gateway's own JWTs. Unrelated to Codex credentials.
   */
  @IsString()
  @IsNotEmpty({ message: 'JWT_SECRET is required' })
  @MinLength(32, { message: 'JWT_SECRET must be at least 32 characters' })
  JWT_SECRET!: string;

  @IsString()
  @IsOptional()
  JWT_EXPIRES_IN: string = '1d';

  @IsEmail({}, { message: 'ADMIN_EMAIL must be a valid email address' })
  ADMIN_EMAIL!: string;

  /**
   * bcrypt hash, produced by `npm run auth:hash -- "<password>"`.
   * The plaintext password is never stored or read by the gateway.
   */
  @IsString()
  @IsNotEmpty({
    message: 'ADMIN_PASSWORD_HASH is required — generate it with `npm run auth:hash`',
  })
  ADMIN_PASSWORD_HASH!: string;

  @IsString()
  @IsNotEmpty({ message: 'MONGODB_URI is required' })
  MONGODB_URI!: string;

  /**
   * Ceiling on turns running at once across the whole gateway. Every user
   * shares one Codex identity and one quota, so this is a spend control.
   */
  @IsInt()
  @Min(1)
  @Max(64)
  @IsOptional()
  MAX_CONCURRENT_TURNS: number = 4;

  /** Keeps one account from filling the global ceiling on its own. */
  @IsInt()
  @Min(1)
  @Max(64)
  @IsOptional()
  MAX_TURNS_PER_USER: number = 2;

  /**
   * How long an approval prompt waits for a person. The app-server blocks for
   * this long, so it is a ceiling on how long a turn can stall.
   */
  @IsInt()
  @Min(5_000)
  @Max(1_800_000)
  @IsOptional()
  APPROVAL_TIMEOUT_MS: number = 300_000;

  /**
   * Comma-separated directories the gateway may run threads in. Required, and
   * deliberately so: with no cwd Codex would operate in the gateway's own
   * working directory, which holds this source tree and .env.
   *
   * Nothing outside these roots is reachable, however a project is phrased.
   */
  @IsString()
  @IsNotEmpty({ message: 'CODEX_WORKSPACE_ROOTS is required' })
  CODEX_WORKSPACE_ROOTS!: string;

  @IsString()
  @IsOptional()
  CODEX_BIN: string = '';

  @IsString()
  @IsOptional()
  CODEX_HOME: string = '';
}

export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables {
  // Strip empty strings so @IsOptional defaults apply instead of failing validation.
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value !== '') cleaned[key] = value;
  }

  const config = plainToInstance(EnvironmentVariables, cleaned, {
    enableImplicitConversion: true,
    excludeExtraneousValues: false,
  });

  const errors = validateSync(config, {
    skipMissingProperties: false,
    whitelist: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .filter(Boolean)
      .map((line) => `  - ${line}`)
      .join('\n');

    throw new Error(
      `Invalid environment configuration:\n${details}\n\nCopy .env.example to .env and fill in the missing values.`,
    );
  }

  return config;
}
