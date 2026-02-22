import { useEffect, useRef, useState } from 'react';
import { useMarketStore } from '../store/marketStore';

export function useWebSocket() {
    const currentSymbol = useMarketStore((state) => state.currentSymbol);
    const setInstruments = useMarketStore((state) => state.setInstruments);
    const updatePrice = useMarketStore((state) => state.updatePrice);
    const updateOrderbook = useMarketStore((state) => state.updateOrderbook);

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimerRef = useRef<number | null>(null);
    const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');

    useEffect(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const wsUrl = import.meta.env.DEV
            ? `${protocol}://${window.location.host}/ws`
            : `${protocol}://${window.location.host}`;
        let isUnmounted = false;

        const connect = () => {
            if (isUnmounted) return;
            setStatus('connecting');
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                setStatus('connected');
                // Subscribe to current symbol immediately upon connection
                ws.send(JSON.stringify({ type: 'subscribe', symbol: currentSymbol }));
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.type === 'connected') {
                        setInstruments(data.instruments);
                    } else if (data.type === 'price') {
                        updatePrice(data.symbol, data.price);
                    } else if (data.type === 'orderbook') {
                        updateOrderbook(data);
                    }
                } catch (err) {
                    console.error('WS message error', err);
                }
            };

            ws.onclose = () => {
                if (isUnmounted) return;
                setStatus('disconnected');
                // Reconnect after 3s
                reconnectTimerRef.current = window.setTimeout(connect, 3000);
            };

            ws.onerror = (err) => {
                console.error('WS Error', err);
                ws.close();
            };
        };

        connect();

        return () => {
            isUnmounted = true;
            if (reconnectTimerRef.current !== null) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
            if (wsRef.current) {
                wsRef.current.onclose = null; // prevent reconnect on intended unmount
                wsRef.current.close();
            }
        };
    }, []); // Run once on mount

    // Subscribe to new symbol when it changes
    useEffect(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'subscribe', symbol: currentSymbol }));
            // Clear orderbook when switching
            updateOrderbook({ bids: [], asks: [], ratio: 0.5, pressure: 'NEUTRAL' });
        }
    }, [currentSymbol, updateOrderbook]);

    return status;
}
