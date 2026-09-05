import { Module } from '@nestjs/common';

import { CodexClientService } from './app-server/codex-client.service';
import { CODEX_TRANSPORT } from './app-server/codex-transport';
import { ServerRequestRegistry } from './app-server/server-request.registry';
import { StdioTransport } from './app-server/stdio.transport';
import { CodexBinaryService } from './binary/codex-binary.service';

/**
 * Everything that touches Codex lives here.
 *
 * The transport is bound through a token so Phase 7 can swap stdio for a
 * WebSocket connection to `--listen ws://` without CodexClientService noticing.
 *
 * Phase 2 adds the login flow on top of the client; Phase 5 registers real
 * approval responders with ServerRequestRegistry.
 */
@Module({
  providers: [
    CodexBinaryService,
    ServerRequestRegistry,
    StdioTransport,
    { provide: CODEX_TRANSPORT, useExisting: StdioTransport },
    CodexClientService,
  ],
  exports: [CodexBinaryService, CodexClientService, ServerRequestRegistry],
})
export class CodexModule {}
