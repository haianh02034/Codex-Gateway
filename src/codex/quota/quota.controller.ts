import { Controller, Get, Post } from '@nestjs/common';

import { QuotaService, QuotaView } from './quota.service';

/**
 * The shared allowance. Visible to every signed-in user on purpose: they all
 * spend from the same budget, so someone whose turn is throttled needs to see
 * why without having to ask an administrator.
 */
@Controller('codex/rate-limits')
export class QuotaController {
  constructor(private readonly quota: QuotaService) {}

  @Get()
  current(): QuotaView {
    return this.quota.getSnapshot();
  }

  /** Forces a read from Codex rather than serving the cached figures. */
  @Post('refresh')
  refresh(): Promise<QuotaView> {
    return this.quota.refresh();
  }
}
