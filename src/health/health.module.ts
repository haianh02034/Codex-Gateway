import { Module } from '@nestjs/common';

import { CodexModule } from '../codex/codex.module';
import { HealthController } from './health.controller';

@Module({
  imports: [CodexModule],
  controllers: [HealthController],
})
export class HealthModule {}
