import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthConfig } from '../config/configuration';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { User, UserSchema } from './schemas/user.schema';
import { USER_STORE } from './users/user-store';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

/**
 * Global because JwtAuthGuard is registered application-wide and needs
 * AuthService wherever it runs.
 *
 * USER_STORE is bound to the Mongo-backed UsersService. Nothing outside this
 * module names the implementation, which is what made the Phase 0 swap free.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
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
  controllers: [AuthController, UsersController],
  providers: [AuthService, UsersService, { provide: USER_STORE, useExisting: UsersService }],
  exports: [AuthService, UsersService],
})
export class AuthModule {}
