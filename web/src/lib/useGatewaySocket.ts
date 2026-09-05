'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

import { api } from './api';
import type { GatewayEvent, Quota } from './types';

export type SocketState = 'connecting' | 'ready' | 'failed';

interface Options {
  token: string | null;
  /** Conversation to receive events for. Changing it re-joins. */
  conversationId: string | null;
  onEvent: (event: GatewayEvent) => void;
  onQuota: (quota: Quota) => void;
}

/**
 * Live connection to the gateway.
 *
 * The token goes in the handshake auth payload rather than the query string,
 * matching the gateway: a query string would be written to proxy logs.
 *
 * Callbacks are held in a ref so a re-render does not tear the socket down and
 * lose the stream mid-turn.
 */
export function useGatewaySocket({ token, conversationId, onEvent, onQuota }: Options): SocketState {
  const [state, setState] = useState<SocketState>('connecting');
  const socketRef = useRef<Socket | null>(null);
  const handlers = useRef({ onEvent, onQuota });

  handlers.current = { onEvent, onQuota };

  useEffect(() => {
    if (!token) return;

    const socket = io(`${api.baseUrl}/codex`, {
      auth: { token },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('codex.connected', () => setState('ready'));
    socket.on('codex.error', () => setState('failed'));
    socket.on('connect_error', () => setState('failed'));
    socket.on('disconnect', () => setState('connecting'));
    socket.on('codex.event', (event: GatewayEvent) => handlers.current.onEvent(event));
    socket.on('codex.quota', (quota: Quota) => handlers.current.onQuota(quota));

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [token]);

  // Joining is separate from connecting: switching conversations must not
  // drop and rebuild the socket.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !conversationId || state !== 'ready') return;

    socket.emit('conversation.join', { conversationId });

    return () => {
      socket.emit('conversation.leave', { conversationId });
    };
  }, [conversationId, state]);

  return state;
}
