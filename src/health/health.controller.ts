import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';

import { CodexBinaryService } from '../codex/binary/codex-binary.service';
import { Public } from '../common/decorators/public.decorator';

interface LivenessResponse {
  status: 'ok';
  uptimeSeconds: number;
}

interface CodexHealthResponse {
  status: 'ok' | 'unavailable';
  version: string | null;
  source: 'bundled' | 'override' | null;
  detail: string | null;
}

@Controller('health')
export class HealthController {
  constructor(private readonly codexBinary: CodexBinaryService) {}

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
   * Codex runtime readiness. Behind authentication because the path and
   * version identify the host's toolchain.
   *
   * Phase 0 checks only that the executable runs. Whether Codex is logged in
   * is a Phase 2 question, and whether the app-server responds is Phase 1.
   */
  @Get('codex')
  @HttpCode(HttpStatus.OK)
  async codex(): Promise<CodexHealthResponse> {
    try {
      const info = await this.codexBinary.describe();
      return {
        status: 'ok',
        version: info.version,
        source: info.source,
        detail: null,
      };
    } catch (error) {
      return {
        status: 'unavailable',
        version: null,
        source: null,
        detail: (error as Error).message,
      };
    }
  }
}
