import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ApprovalView } from './approval.types';
import { ApprovalsService } from './approvals.service';
import { ResolveApprovalDto } from './dto/resolve-approval.dto';

/**
 * Answering a prompt is scoped to whoever owns the conversation. Deciding for
 * someone else would let a stranger authorise commands against their files, so
 * an approval that is not yours reads as 404 — the same answer as one that
 * never existed.
 */
@Controller()
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get('conversations/:id/approvals')
  list(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ApprovalView[]> {
    return this.approvals.listForConversation(user, id);
  }

  @Post('approvals/:id/resolve')
  @HttpCode(HttpStatus.OK)
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ResolveApprovalDto,
  ): Promise<ApprovalView> {
    return this.approvals.resolve(user, id, dto.decision);
  }
}
