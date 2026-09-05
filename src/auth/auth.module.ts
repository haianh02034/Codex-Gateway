import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';

import { AuthConfig } from '../config/configuration';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EnvUserStore } from './users/env-user.store';
import { USER_STORE } from './users/user-store';

/**
 * Global because JwtAuthGuard is registered application-wide and needs
 * AuthService wherever it runs.
 *
 * Phase 3 swaps the USER_STORE provider for the Mongo-backed store;
 * nothing outside this module refers to EnvUserStore.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const auth = config.getOrThrow<AuthConfig>('auth');
        return {
          secret: auth.jwtSecret,
          // jsonwebtoken types this as a duration literal ("1d", "30m"), not a
          // plain string. The value is validated as a string in env.validation.
          signOptions: {
            expiresIn: auth.jwtExpiresIn as JwtSignOptions['expiresIn'],
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, { provide: USER_STORE, useClass: EnvUserStore }],
  exports: [AuthService],
})
export class AuthModule {}
