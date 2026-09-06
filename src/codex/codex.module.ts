import { Module } from '@nestjs/common';

import { CodexClientService } from './app-server/codex-client.service';
import { CODEX_TRANSPORT } from './app-server/codex-transport';
import { ServerRequestRegistry } from './app-server/server-request.registry';
import { StdioTransport } from './app-server/stdio.transport';
import { CodexAdminAuthController } from './auth/codex-admin-auth.controller';
import { CodexAuthController } from './auth/codex-auth.controller';
import { CodexAuthService } from './auth/codex-auth.service';
import { CodexBinaryService } from './binary/codex-binary.service';
import { ChatModesController } from './modes/chat-modes.controller';
import { ChatModesService } from './modes/chat-modes.service';
import { QuotaController } from './quota/quota.controller';
import { QuotaService } from './quota/quota.service';

/**
 * Everything that touches Codex lives here.
 *
 * The transport is bound through a token so Phase 7 can swap stdio for a
 * WebSocket connection to `--listen ws://` without CodexClientService noticing.
 *
 * Phase 5 registers real approval responders with ServerRequestRegistry.
 */
@Module({
  controllers: [CodexAuthController, CodexAdminAuthController, QuotaController, ChatModesController],
  providers: [
    CodexAuthService,
    CodexBinaryService,
    QuotaService,
    ChatModesService,
    ServerRequestRegistry,
    StdioTransport,
    { provide: CODEX_TRANSPORT, useExisting: StdioTransport },
    CodexClientService,
  ],
  exports: [
    CodexBinaryService,
    CodexClientService,
    ServerRequestRegistry,
    CodexAuthService,
    QuotaService,
    ChatModesService,
  ],
})
export class CodexModule {}
