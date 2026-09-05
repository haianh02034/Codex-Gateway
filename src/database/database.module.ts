import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { DatabaseConfig } from '../config/configuration';

/**
 * MongoDB connection.
 *
 * Mongo is not just storage here. The app-server knows nothing about users —
 * threads are global to the host — so the documents in this database are the
 * only thing that separates one user's work from another's. Treat every query
 * that reaches them as a permission check.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const { uri } = config.getOrThrow<DatabaseConfig>('database');
        const logger = new Logger('Database');

        return {
          uri,
          // Fail fast instead of buffering queries against a database that is
          // not there; a dead Mongo must surface as an error, not a hang.
          bufferCommands: false,
          serverSelectionTimeoutMS: 5_000,
          onConnectionCreate: (connection: { on: (e: string, cb: () => void) => void }) => {
            connection.on('connected', () => logger.log('MongoDB connected'));
            connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
            return connection;
          },
        };
      },
    }),
  ],
})
export class DatabaseModule {}
