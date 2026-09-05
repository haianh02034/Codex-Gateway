import { NodeEnv } from './env.validation';

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  apiPrefix: string;
  corsOrigins: string[];
}

export interface AuthConfig {
  jwtSecret: string;
  jwtExpiresIn: string;
  adminEmail: string;
  adminPasswordHash: string;
}

export interface CodexConfig {
  /** Explicit binary path. Empty means "resolve from node_modules". */
  binaryOverride: string;
  /** Overrides CODEX_HOME for spawned Codex processes. Empty means the default. */
  home: string;
}

export interface GatewayConfig {
  app: AppConfig;
  auth: AuthConfig;
  codex: CodexConfig;
}

/**
 * Maps validated environment variables onto the typed config tree.
 * Nothing else in the codebase reads `process.env`.
 */
export function configuration(): GatewayConfig {
  const env = process.env;

  return {
    app: {
      nodeEnv: (env.NODE_ENV as NodeEnv) ?? NodeEnv.Development,
      port: Number(env.PORT ?? 3000),
      apiPrefix: env.API_PREFIX || 'api',
      corsOrigins: (env.CORS_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    },
    auth: {
      jwtSecret: env.JWT_SECRET!,
      jwtExpiresIn: env.JWT_EXPIRES_IN || '1d',
      adminEmail: env.ADMIN_EMAIL!,
      adminPasswordHash: env.ADMIN_PASSWORD_HASH!,
    },
    codex: {
      binaryOverride: env.CODEX_BIN || '',
      home: env.CODEX_HOME || '',
    },
  };
}
