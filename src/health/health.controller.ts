import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';

import { CodexClientService, CodexClientStatus } from '../codex/app-server/codex-client.service';
import { CodexBinaryService } from '../codex/binary/codex-binary.service';
import { Public } from '../common/decorators/public.decorator';

interface LivenessResponse {
  status: 'ok';
  uptimeSeconds: number;
}

interface CodexHealthResponse {
  status: 'ok' | 'degraded' | 'unavailable';
  binary: {
    version: string | null;
    source: 'bundled' | 'override' | null;
  };
  appServer: CodexClientStatus | null;
  detail: string | null;
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly codexBinary: CodexBinaryService,
    private readonly codexClient: CodexClientService,
  ) {}

  /**
   * Liveness for the load balancer. Public and deliberately uninformative —
   * it reveals nothing about the host beyond "the process is up".
   */
  @Public()
  @Get()
  liveness(): LivenessResponse {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  /**
   * Codex runtime readiness. Behind authentication because the path, version
   * and Codex home all describe the host's toolchain.
   *
   * `degraded` means the executable is fine but the app-server connection is
   * not — worth separating, because only the second one recovers on its own.
   */
  @Get('codex')
  @HttpCode(HttpStatus.OK)
  async codex(): Promise<CodexHealthResponse> {
    let binaryVersion: string | null = null;
    let binarySource: 'bundled' | 'override' | null = null;

    try {
      const info = await this.codexBinary.describe();
      binaryVersion = info.version;
      binarySource = info.source;
    } catch (error) {
      return {
        status: 'unavailable',
        binary: { version: null, source: null },
        appServer: null,
        detail: (error as Error).message,
      };
    }

    const appServer = this.codexClient.getStatus();

    return {
      status: appServer.connected ? 'ok' : 'degraded',
      binary: { version: binaryVersion, source: binarySource },
      appServer,
      detail: appServer.connected ? null : (appServer.lastError ?? 'app-server is not connected'),
    };
  }
}
