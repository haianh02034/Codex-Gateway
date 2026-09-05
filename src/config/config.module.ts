import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { configuration } from './configuration';
import { validateEnv } from './env.validation';

/**
 * Global config. Every other module injects ConfigService rather than
 * reading process.env, so the validated tree is the single source of truth.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env'],
      load: [configuration],
      validate: validateEnv,
    }),
  ],
})
export class ConfigModule {}
