import { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';

import { AppConfig } from '../config/configuration';

/**
 * Applies the gateway's CORS policy to Socket.IO.
 *
 * @WebSocketGateway options are static, and Socket.IO keeps a CORS list of its
 * own. Without this the WebSocket endpoint would accept origins the HTTP API
 * rejects — an open door beside a locked one.
 */
export class ConfiguredIoAdapter extends IoAdapter {
  private readonly origins: string[];

  constructor(app: INestApplicationContext) {
    super(app);
    this.origins = app.get(ConfigService).getOrThrow<AppConfig>('app').corsOrigins;
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    return super.createIOServer(port, {
      ...options,
      cors: {
        // No configured origins means no browser may connect, matching the
        // HTTP side. Being locked out is recoverable; a wildcard is not.
        origin: this.origins.length > 0 ? this.origins : false,
        credentials: true,
      },
    });
  }
}
