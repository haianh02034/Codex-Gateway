import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { ConfiguredIoAdapter } from './realtime/socket-io.adapter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // Release the buffer now. Held until listen(), a startup that refuses to
  // continue — a held instance lease, a bad workspace root — would exit
  // silently with nothing written anywhere.
  app.flushLogs();

  const logger = new Logger('Bootstrap');

  const { port, apiPrefix, corsOrigins, nodeEnv } =
    app.get(ConfigService).getOrThrow<AppConfig>('app');

  app.use(helmet());

  // Socket.IO enforces its own CORS list, so it gets the same origins.
  app.useWebSocketAdapter(new ConfiguredIoAdapter(app));

  // No origins configured means no browser may call the API. Being locked out
  // is recoverable; a wildcard on a gateway holding shared credentials is not.
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Health stays off the API prefix so the load balancer probes a stable path.
  app.setGlobalPrefix(apiPrefix, {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/codex', method: RequestMethod.GET },
    ],
  });

  // Lets Phase 1 shut the app-server down cleanly via onModuleDestroy.
  app.enableShutdownHooks();

  await app.listen(port);

  logger.log(`Codex Gateway listening on http://localhost:${port} [${nodeEnv}]`);
  logger.log(`API prefix: /${apiPrefix}   Health: /health`);
  if (corsOrigins.length === 0) {
    logger.warn('CORS_ORIGINS is empty — browser clients will be blocked');
  }
}

void bootstrap().catch((error: Error) => {
  // Refusing to start is a valid outcome — a held instance lease, an
  // unusable workspace root. Say why in one line instead of a stack trace.
  new Logger('Bootstrap').error(error.message);
  process.exit(1);
});
