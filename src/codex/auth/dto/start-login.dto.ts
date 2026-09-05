import { IsEnum, IsOptional } from 'class-validator';

import { CodexLoginMethod } from '../codex-auth.types';

export class StartCodexLoginDto {
  /**
   * Defaults to the browser flow. Pick `deviceCode` when the gateway runs on a
   * different machine than the browser: the browser flow completes through a
   * loopback callback on the Codex host, which a remote admin cannot reach.
   */
  @IsOptional()
  @IsEnum(CodexLoginMethod, { message: 'method must be "browser" or "deviceCode"' })
  method?: CodexLoginMethod;
}
