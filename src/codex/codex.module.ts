import { Module } from '@nestjs/common';

import { CodexBinaryService } from './binary/codex-binary.service';

/**
 * Everything that touches Codex lives here.
 *
 * Phase 0 only locates the executable. Phase 1 adds the app-server transport
 * and the JSON-RPC client; Phase 2 adds the login flow on top of it.
 */
@Module({
  providers: [CodexBinaryService],
  exports: [CodexBinaryService],
})
export class CodexModule {}
