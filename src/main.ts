import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = new Logger('Bootstrap');

  const { port, apiPrefix, corsOrigins, nodeEnv } =
    app.get(ConfigService).getOrThrow<AppConfig>('app');

  app.use(helmet());

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

void bootstrap();
