import { IsEnum } from 'class-validator';

import { ApprovalDecision } from '../approval.types';

export class ResolveApprovalDto {
  @IsEnum(ApprovalDecision, {
    message: 'decision must be "allow", "allowForSession" or "deny"',
  })
  decision!: ApprovalDecision;
}
