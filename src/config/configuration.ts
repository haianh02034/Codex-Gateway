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

export interface DatabaseConfig {
  uri: string;
}

export interface RuntimeConfig {
  maxConcurrentTurns: number;
  maxTurnsPerUser: number;
  approvalTimeoutMs: number;
}

export interface CodexConfig {
  /** Explicit binary path. Empty means "resolve from node_modules". */
  binaryOverride: string;
  /** Overrides CODEX_HOME for spawned Codex processes. Empty means the default. */
  home: string;
  /** Absolute directories threads may run in. Validated at boot. */
  workspaceRoots: string[];
}

export interface GatewayConfig {
  app: AppConfig;
  auth: AuthConfig;
  database: DatabaseConfig;
  runtime: RuntimeConfig;
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
    database: {
      uri: env.MONGODB_URI!,
    },
    runtime: {
      maxConcurrentTurns: Number(env.MAX_CONCURRENT_TURNS ?? 4),
      maxTurnsPerUser: Number(env.MAX_TURNS_PER_USER ?? 2),
      approvalTimeoutMs: Number(env.APPROVAL_TIMEOUT_MS ?? 300_000),
    },
    codex: {
      binaryOverride: env.CODEX_BIN || '',
      home: env.CODEX_HOME || '',
      workspaceRoots: (env.CODEX_WORKSPACE_ROOTS ?? '')
        .split(',')
        .map((root) => root.trim())
        .filter(Boolean),
    },
  };
}
