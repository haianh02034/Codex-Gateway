import type { RequestId } from '../protocol/generated/RequestId';

/**
 * The app-server wire envelope, measured against codex 0.153.4 rather than
 * taken from documentation.
 *
 * Framing is newline-delimited JSON: one complete JSON value per line, no
 * Content-Length headers. The envelope resembles JSON-RPC 2.0 but carries no
 * `jsonrpc` field in either direction — the server ignores it on the way in
 * and never sends it back, so we do not write one.
 *
 * These types describe the envelope only. Every `params` and `result` payload
 * is typed by the generated bindings under ../protocol/generated.
 */

export interface WireError {
  code: number;
  message: string;
  data?: unknown;
}

/** Client -> server call expecting a response. */
export interface WireRequest {
  id: RequestId;
  method: string;
  params?: unknown;
}

/** Client -> server message with no response. */
export interface WireNotification {
  method: string;
  params?: unknown;
}

/**
 * Client -> server reply to a server-initiated request. Not a mirror of
 * WireResponse: this one we produce, and exactly one of result/error is set.
 */
export interface WireClientResponse {
  id: RequestId;
  result?: unknown;
  error?: WireError;
}

export type WireOutbound = WireRequest | WireNotification | WireClientResponse;

/** Server -> client reply to one of our requests. */
export interface WireResponse {
  id: RequestId;
  result?: unknown;
  error?: WireError;
}

/**
 * Server -> client call that expects a reply from us. Approval requests arrive
 * this way, and the server blocks on the answer.
 */
export interface WireServerRequest {
  id: RequestId;
  method: string;
  params?: unknown;
}

/** Server -> client event. Carries no id, so nothing is expected back. */
export interface WireServerNotification {
  method: string;
  params?: unknown;
  emittedAtMs?: number;
}

export type WireInbound = WireResponse | WireServerRequest | WireServerNotification;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * An id with no method is a reply to us; an id with a method is the server
 * calling us; no id at all is an event. That single distinction drives the
 * whole dispatch loop.
 */
export function classifyInbound(
  message: unknown,
): { kind: 'response'; message: WireResponse }
  | { kind: 'request'; message: WireServerRequest }
  | { kind: 'notification'; message: WireServerNotification }
  | { kind: 'unknown'; message: unknown } {
  if (!isRecord(message)) return { kind: 'unknown', message };

  const hasId = message.id !== undefined && message.id !== null;
  const hasMethod = typeof message.method === 'string';

  if (hasId && !hasMethod) return { kind: 'response', message: message as unknown as WireResponse };
  if (hasId && hasMethod) return { kind: 'request', message: message as unknown as WireServerRequest };
  if (hasMethod) return { kind: 'notification', message: message as unknown as WireServerNotification };

  return { kind: 'unknown', message };
}
