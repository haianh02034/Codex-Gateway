import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

import { Injectable, Logger } from '@nestjs/common';

import { CodexBinaryService } from '../binary/codex-binary.service';
import { CodexTransport, TransportExit } from './codex-transport';
import { WireInbound, WireOutbound } from './wire.types';

/** How long close() waits for a clean exit before killing the process. */
const CLOSE_GRACE_MS = 5_000;

/**
 * Runs `codex app-server` as a child process and speaks newline-delimited JSON
 * over its stdin/stdout.
 *
 * stdio is chosen over `--listen ws://` for the gateway's own transport: there
 * is no port to secure, no token to distribute, and the server's lifetime is
 * tied to this process. Codex only requires WebSocket authentication for
 * non-loopback listeners, so a socket would buy nothing here.
 */
@Injectable()
export class StdioTransport implements CodexTransport {
  readonly name = 'stdio';

  private readonly logger = new Logger(StdioTransport.name);
  private readonly messageListeners: ((message: WireInbound) => void)[] = [];
  private readonly exitListeners: ((exit: TransportExit) => void)[] = [];

  private child: ChildProcessWithoutNullStreams | null = null;
  private decoder = new StringDecoder('utf8');
  private buffer = '';
  private exited = false;

  constructor(private readonly binary: CodexBinaryService) {}

  async start(): Promise<void> {
    if (this.child) return;

    const binaryPath = this.binary.getBinaryPath();
    const env = this.binary.buildEnv();

    this.logger.log(`Starting: ${binaryPath} app-server`);

    const child = spawn(binaryPath, ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env,
    });

    this.child = child;
    this.exited = false;
    this.buffer = '';
    this.decoder = new StringDecoder('utf8');

    child.stdout.on('data', (chunk: Buffer) => this.ingest(chunk));

    // app-server logs diagnostics here; it is never protocol traffic.
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trimEnd();
      if (text) this.logger.debug(`[app-server] ${text}`);
    });

    child.on('exit', (code, signal) => {
      this.exited = true;
      this.child = null;
      this.logger.warn(`app-server exited (code=${code}, signal=${signal ?? 'none'})`);
      for (const listener of this.exitListeners) listener({ code, signal });
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.child = null;
        reject(new Error(`Could not start the Codex app-server: ${error.message}`));
      };

      child.once('error', onError);

      // spawn() reports failures asynchronously, so give the event loop one
      // turn to surface an immediate failure before declaring success.
      setImmediate(() => {
        child.removeListener('error', onError);
        if (this.exited) {
          reject(new Error('The Codex app-server exited immediately after starting'));
        } else {
          child.on('error', (error) => this.logger.error(`Transport error: ${error.message}`));
          resolve();
        }
      });
    });
  }

  send(message: WireOutbound): void {
    const child = this.child;
    if (!child || this.exited) {
      throw new Error('The Codex app-server is not running');
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child) return;

    // Closing stdin is the documented way to ask app-server to wind down.
    child.stdin.end();

    const exited = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), CLOSE_GRACE_MS);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });

    if (!exited) {
      this.logger.warn(`app-server did not exit within ${CLOSE_GRACE_MS}ms — terminating`);
      child.kill();
    }

    this.child = null;
  }

  onMessage(listener: (message: WireInbound) => void): void {
    this.messageListeners.push(listener);
  }

  onExit(listener: (exit: TransportExit) => void): void {
    this.exitListeners.push(listener);
  }

  /**
   * Reassembles messages from arbitrary chunk boundaries. A single stdout chunk
   * may hold several messages, part of one, or split a multi-byte character in
   * half — StringDecoder covers the last case.
   */
  private ingest(chunk: Buffer): void {
    this.buffer += this.decoder.write(chunk);

    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf('\n');

      if (!line) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        this.logger.error(`Discarding unparseable line from app-server: ${line.slice(0, 200)}`);
        continue;
      }

      for (const listener of this.messageListeners) listener(parsed as WireInbound);
    }
  }
}
