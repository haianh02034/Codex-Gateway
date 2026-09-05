import { Injectable, Logger } from '@nestjs/common';

import { WireError, WireServerRequest } from './wire.types';

export type ServerRequestResponder = (request: WireServerRequest) => Promise<unknown>;

export interface ServerRequestOutcome {
  result?: unknown;
  error?: WireError;
}

/** JSON-RPC "method not found". */
const METHOD_NOT_FOUND = -32601;

/**
 * Refusals that keep a turn moving.
 *
 * The app-server blocks on the answer to a server request, so the one thing we
 * must never do is stay silent. Until Phase 5 puts a real approval UI in front
 * of a human, every approval is refused in the shape that specific method
 * expects — a decline Codex understands, rather than an error it has to
 * recover from.
 */
const DECLINE_BY_METHOD: Record<string, unknown> = {
  // v2 approvals take a plain decision enum.
  'item/commandExecution/requestApproval': { decision: 'decline' },
  'item/fileChange/requestApproval': { decision: 'decline' },

  // The pre-v2 pair still uses ReviewDecision, which carries a reason.
  execCommandApproval: {
    decision: { denied: { rejection: 'Approvals are not available on this gateway yet' } },
  },
  applyPatchApproval: {
    decision: { denied: { rejection: 'Approvals are not available on this gateway yet' } },
  },
};

/**
 * Routes server-initiated requests to whoever can answer them.
 *
 * Phase 1 registers nothing, so every request falls through to a refusal. That
 * is deliberate: the dispatch path, the response envelope and the timeout
 * behaviour are all exercised now, and Phase 5 only has to supply a responder
 * that asks a person instead.
 */
@Injectable()
export class ServerRequestRegistry {
  private readonly logger = new Logger(ServerRequestRegistry.name);
  private readonly responders = new Map<string, ServerRequestResponder>();

  /**
   * Claims one method. Later registrations replace earlier ones so a module
   * can override a default without the registry needing to know about it.
   */
  register(method: string, responder: ServerRequestResponder): void {
    if (this.responders.has(method)) {
      this.logger.warn(`Replacing the existing responder for ${method}`);
    }
    this.responders.set(method, responder);
  }

  hasResponder(method: string): boolean {
    return this.responders.has(method);
  }

  /** Never throws: a rejected responder still produces an answer to send back. */
  async resolve(request: WireServerRequest): Promise<ServerRequestOutcome> {
    const responder = this.responders.get(request.method);

    if (responder) {
      try {
        return { result: await responder(request) };
      } catch (error) {
        this.logger.error(
          `Responder for ${request.method} threw: ${(error as Error).message}`,
        );
        return this.fallbackFor(request.method);
      }
    }

    this.logger.warn(`No responder for ${request.method} — refusing`);
    return this.fallbackFor(request.method);
  }

  private fallbackFor(method: string): ServerRequestOutcome {
    const decline = DECLINE_BY_METHOD[method];
    if (decline !== undefined) return { result: decline };

    // No known refusal shape. An error still unblocks the server, which is the
    // only outcome worse than a decline but far better than hanging.
    return {
      error: {
        code: METHOD_NOT_FOUND,
        message: `The gateway cannot answer ${method} yet`,
      },
    };
  }
}
