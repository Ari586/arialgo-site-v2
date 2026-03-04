import { useCallback, useEffect, useRef, useState } from 'react';
import { useMarketStore } from '../store/marketStore';
import { publishLiveTick } from '../utils/liveTickBus';

const CONFIG = {
    MAX_RECONNECT_DELAY: 30000,
    INITIAL_RECONNECT_DELAY: 1000,
    HEARTBEAT_INTERVAL: 30000,
    HEARTBEAT_TIMEOUT: 5000,
    MAX_RECONNECT_ATTEMPTS: 10,
    RECONNECT_JITTER: 0.2,
} as const;

export type ConnectionState = 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'DISCONNECTING' | 'RECONNECTING' | 'ERROR';
type UiConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface WebSocketMessage {
    type: string;
    [key: string]: unknown;
}

export type ChatEventListener = (data: WebSocketMessage) => void;

type UseWebSocketOptions = {
    onMessage?: (data: WebSocketMessage) => void;
    onConnectionChange?: (status: ConnectionState) => void;
    WebSocketCtor?: typeof WebSocket;
};

function toUiStatus(state: ConnectionState): UiConnectionStatus {
    if (state === 'CONNECTED') return 'connected';
    if (state === 'CONNECTING' || state === 'RECONNECTING') return 'connecting';
    return 'disconnected';
}

function resolveWebSocketUrl(): string {
    const fromEnv = String(import.meta.env.VITE_WS_URL || '').trim();
    if (fromEnv) return fromEnv;

    const centralizedCloudRunHubHost = 'xauusd-analyzer-l6k4n52jzq-od-l6k4n52jzq-od.a.run.app';
    const isCloudRunHost = /\.a\.run\.app$/i.test(window.location.host);
    if (isCloudRunHost && window.location.host !== centralizedCloudRunHubHost) {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        return `${protocol}://${centralizedCloudRunHubHost}`;
    }

    const hubHost = String(import.meta.env.VITE_CHAT_HUB_HOST || '').trim();
    if (hubHost) {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const normalizedHost = hubHost
            .replace(/^https?:\/\//i, '')
            .replace(/^wss?:\/\//i, '')
            .replace(/\/+$/g, '');
        if (normalizedHost) {
            return `${protocol}://${normalizedHost}`;
        }
    }

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return import.meta.env.DEV
        ? `${protocol}://${window.location.host}/ws`
        : `${protocol}://${window.location.host}`;
}

function isChatEventType(type: unknown): type is string {
    return typeof type === 'string' && type.startsWith('chat_');
}

export function useWebSocket({
    onMessage,
    onConnectionChange,
    WebSocketCtor = WebSocket,
}: UseWebSocketOptions = {}) {
    const currentSymbol = useMarketStore((state) => state.currentSymbol);
    const setInstruments = useMarketStore((state) => state.setInstruments);
    const updatePrice = useMarketStore((state) => state.updatePrice);
    const updateOrderbook = useMarketStore((state) => state.updateOrderbook);
    const addSignal = useMarketStore((state) => state.addSignal);

    const [connectionState, setConnectionState] = useState<ConnectionState>('IDLE');
    const status = toUiStatus(connectionState);

    const wsRef = useRef<WebSocket | null>(null);
    const wsUrlRef = useRef<string>(resolveWebSocketUrl());
    const reconnectAttemptsRef = useRef(0);
    const isManualCloseRef = useRef(false);
    const connectionStateRef = useRef<ConnectionState>('IDLE');
    const messageQueueRef = useRef<WebSocketMessage[]>([]);
    const activeSubscriptionsRef = useRef<Set<string>>(new Set());
    const chatListenersRef = useRef<Set<ChatEventListener>>(new Set());

    const timers = useRef<{
        reconnect: ReturnType<typeof setTimeout> | null;
        heartbeat: ReturnType<typeof setInterval> | null;
        heartbeatTimeout: ReturnType<typeof setTimeout> | null;
    }>({
        reconnect: null,
        heartbeat: null,
        heartbeatTimeout: null,
    });

    const clearTimers = useCallback(() => {
        if (timers.current.reconnect) clearTimeout(timers.current.reconnect);
        if (timers.current.heartbeat) clearInterval(timers.current.heartbeat);
        if (timers.current.heartbeatTimeout) clearTimeout(timers.current.heartbeatTimeout);
        timers.current = { reconnect: null, heartbeat: null, heartbeatTimeout: null };
    }, []);

    const stopHeartbeat = useCallback(() => {
        if (timers.current.heartbeat) {
            clearInterval(timers.current.heartbeat);
            timers.current.heartbeat = null;
        }
        if (timers.current.heartbeatTimeout) {
            clearTimeout(timers.current.heartbeatTimeout);
            timers.current.heartbeatTimeout = null;
        }
    }, []);

    const transitionTo = useCallback((nextState: ConnectionState) => {
        connectionStateRef.current = nextState;
        setConnectionState(nextState);
        onConnectionChange?.(nextState);
    }, [onConnectionChange]);

    const emitChatEvent = useCallback((data: WebSocketMessage) => {
        chatListenersRef.current.forEach((listener) => {
            try {
                listener(data);
            } catch (error) {
                console.error('[WS] Chat listener error', error);
            }
        });
    }, []);

    const handleIncomingMessage = useCallback((data: WebSocketMessage) => {
        if (data.type === 'connected' && Array.isArray(data.instruments)) {
            setInstruments(data.instruments as string[]);
        } else if (data.type === 'price' && typeof data.symbol === 'string' && typeof data.price === 'number') {
            updatePrice(data.symbol, data.price, {
                symbol: data.symbol,
                source: typeof data.source === 'string' ? data.source : undefined,
                timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
                bid: typeof data.bid === 'number' ? data.bid : undefined,
                ask: typeof data.ask === 'number' ? data.ask : undefined,
                spread: typeof data.spread === 'number' ? data.spread : undefined,
            });
            publishLiveTick({
                symbol: data.symbol,
                price: data.price,
                timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
            });
        } else if (data.type === 'orderbook') {
            updateOrderbook(data as unknown as Parameters<typeof updateOrderbook>[0]);
        } else if (data.type === 'signal') {
            addSignal(data as unknown as Parameters<typeof addSignal>[0]);
        }
        if (isChatEventType(data.type)) {
            emitChatEvent(data);
        }
        onMessage?.(data);
    }, [addSignal, emitChatEvent, onMessage, setInstruments, updateOrderbook, updatePrice]);

    const startHeartbeat = useCallback(() => {
        stopHeartbeat();
        timers.current.heartbeat = setInterval(() => {
            const ws = wsRef.current;
            if (!ws || ws.readyState !== WebSocketCtor.OPEN) return;

            ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
            timers.current.heartbeatTimeout = setTimeout(() => {
                wsRef.current?.close(4000, 'Heartbeat timeout');
            }, CONFIG.HEARTBEAT_TIMEOUT);
        }, CONFIG.HEARTBEAT_INTERVAL);
    }, [WebSocketCtor.OPEN, stopHeartbeat]);

    const connectRef = useRef<() => void>(() => undefined);
    const scheduleReconnect = useCallback(() => {
        if (isManualCloseRef.current || typeof window === 'undefined' || !window.navigator.onLine) return;

        if (reconnectAttemptsRef.current >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
            transitionTo('ERROR');
            return;
        }

        transitionTo('RECONNECTING');

        const baseDelay = Math.min(
            CONFIG.INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttemptsRef.current),
            CONFIG.MAX_RECONNECT_DELAY
        );
        const jitter = baseDelay * CONFIG.RECONNECT_JITTER * (Math.random() - 0.5);
        const delay = Math.max(0, Math.round(baseDelay + jitter));

        timers.current.reconnect = setTimeout(() => {
            reconnectAttemptsRef.current += 1;
            connectRef.current();
        }, delay);
    }, [transitionTo]);

    const connect = useCallback(() => {
        const activeSocket = wsRef.current;
        if (activeSocket && (activeSocket.readyState === WebSocketCtor.OPEN || activeSocket.readyState === WebSocketCtor.CONNECTING)) {
            return;
        }

        clearTimers();
        transitionTo('CONNECTING');

        try {
            const ws = new WebSocketCtor(wsUrlRef.current);
            wsRef.current = ws;

            ws.onopen = () => {
                reconnectAttemptsRef.current = 0;
                transitionTo('CONNECTED');
                startHeartbeat();

                if (activeSubscriptionsRef.current.size > 0) {
                    activeSubscriptionsRef.current.forEach((symbol) => {
                        ws.send(JSON.stringify({ type: 'subscribe', symbol }));
                    });
                }

                if (messageQueueRef.current.length > 0) {
                    messageQueueRef.current.forEach((message) => {
                        ws.send(JSON.stringify(message));
                    });
                    messageQueueRef.current = [];
                }
            };

            ws.onmessage = (event: MessageEvent) => {
                try {
                    const data = JSON.parse(event.data) as WebSocketMessage;
                    if (data.type === 'pong') {
                        if (timers.current.heartbeatTimeout) {
                            clearTimeout(timers.current.heartbeatTimeout);
                            timers.current.heartbeatTimeout = null;
                        }
                        return;
                    }
                    handleIncomingMessage(data);
                } catch (error) {
                    console.error('[WS] Message parse error', error);
                }
            };

            ws.onerror = (error) => {
                console.error('[WS] Socket error', error);
            };

            ws.onclose = (event) => {
                stopHeartbeat();
                if (!isManualCloseRef.current && event.code !== 1000) {
                    scheduleReconnect();
                } else {
                    transitionTo('IDLE');
                }
            };
        } catch (error) {
            console.error('[WS] Connection failed', error);
            scheduleReconnect();
        }
    }, [WebSocketCtor, clearTimers, handleIncomingMessage, scheduleReconnect, startHeartbeat, stopHeartbeat, transitionTo]);
    connectRef.current = connect;

    const disconnect = useCallback(() => {
        isManualCloseRef.current = true;
        transitionTo('DISCONNECTING');
        clearTimers();
        stopHeartbeat();

        if (wsRef.current) {
            wsRef.current.close(1000, 'User disconnected');
        } else {
            transitionTo('IDLE');
        }
    }, [clearTimers, stopHeartbeat, transitionTo]);

    const sendMessage = useCallback((message: WebSocketMessage) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocketCtor.OPEN) {
            ws.send(JSON.stringify(message));
            return;
        }

        messageQueueRef.current.push(message);
        if (connectionStateRef.current === 'IDLE' || connectionStateRef.current === 'ERROR') {
            isManualCloseRef.current = false;
            connectRef.current();
        }
    }, [WebSocketCtor.OPEN]);

    const subscribe = useCallback((symbol: string) => {
        if (!symbol) return;
        if (!activeSubscriptionsRef.current.has(symbol)) {
            activeSubscriptionsRef.current.add(symbol);
        }
        sendMessage({ type: 'subscribe', symbol });
    }, [sendMessage]);

    const unsubscribe = useCallback((symbol: string) => {
        if (!symbol) return;
        if (activeSubscriptionsRef.current.has(symbol)) {
            activeSubscriptionsRef.current.delete(symbol);
        }
        sendMessage({ type: 'unsubscribe', symbol });
    }, [sendMessage]);

    const reconnect = useCallback(() => {
        isManualCloseRef.current = false;
        reconnectAttemptsRef.current = 0;
        connectRef.current();
    }, []);

    const sendChatRegister = useCallback((clientId: string, profile?: { name?: string }) => {
        const name = typeof profile?.name === 'string' ? profile.name.trim().slice(0, 28) : '';
        sendMessage({ type: 'chat_register', clientId, ...(name ? { name } : {}) });
    }, [sendMessage]);

    const sendChatMessage = useCallback((message: string | Record<string, unknown>, meta?: Record<string, unknown>) => {
        if (typeof message === 'string') {
            sendMessage({ type: 'chat_message', message, ...meta });
            return;
        }
        sendMessage({ type: 'chat_message', ...message });
    }, [sendMessage]);

    const sendChatPayload = useCallback((payload: WebSocketMessage) => {
        sendMessage(payload);
    }, [sendMessage]);

    const onChatEvent = useCallback((listener: ChatEventListener) => {
        chatListenersRef.current.add(listener);
        return () => {
            chatListenersRef.current.delete(listener);
        };
    }, []);

    useEffect(() => {
        const initialSymbol = currentSymbol || 'XAU/USD';
        activeSubscriptionsRef.current.add(initialSymbol);
        connectRef.current();

        const handleOnline = () => {
            if (connectionStateRef.current !== 'CONNECTED' && connectionStateRef.current !== 'CONNECTING') {
                reconnectAttemptsRef.current = 0;
                isManualCloseRef.current = false;
                connectRef.current();
            }
        };

        const handleOffline = () => {
            clearTimers();
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            disconnect();
        };
    }, [clearTimers, disconnect]);

    useEffect(() => {
        if (!currentSymbol) return;
        subscribe(currentSymbol);
        updateOrderbook({ bids: [], asks: [], ratio: 0.5, pressure: 'NEUTRAL' });
    }, [currentSymbol, subscribe, updateOrderbook]);

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const pollPrice = async () => {
            try {
                const res = await fetch(`/api/price?symbol=${encodeURIComponent(currentSymbol)}`);
                const data = await res.json();
                if (!cancelled && data?.success && typeof data.price === 'number') {
                    updatePrice(currentSymbol, data.price, {
                        symbol: currentSymbol,
                        source: typeof data.source === 'string' ? data.source : undefined,
                        timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
                        bid: typeof data.bid === 'number' ? data.bid : undefined,
                        ask: typeof data.ask === 'number' ? data.ask : undefined,
                        spread: typeof data.spread === 'number' ? data.spread : undefined,
                    });
                    publishLiveTick({
                        symbol: currentSymbol,
                        price: data.price,
                        timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
                    });
                }
            } catch {
                // Polling is best-effort fallback.
            } finally {
                if (cancelled) return;
                const nextMs = toUiStatus(connectionStateRef.current) === 'connected' ? 900 : 1700;
                timer = setTimeout(pollPrice, nextMs);
            }
        };

        pollPrice();
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [currentSymbol, updatePrice]);

    return {
        status,
        connectionState,
        chatStatus: status,
        sendMessage,
        subscribe,
        unsubscribe,
        disconnect,
        reconnect,
        sendChatRegister,
        sendChatMessage,
        sendChatPayload,
        onChatEvent,
        isConnected: connectionState === 'CONNECTED',
    };
}
