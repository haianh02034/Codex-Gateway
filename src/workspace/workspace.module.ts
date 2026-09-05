import { Global, Module } from '@nestjs/common';

import { WorkspacePathService } from './workspace-path.service';

/**
 * Global because the allowlist is a single policy for the whole gateway, and
 * anything that hands a directory to Codex has to be judged against it.
 */
@Global()
@Module({
  providers: [WorkspacePathService],
  exports: [WorkspacePathService],
})
export class WorkspaceModule {}
