import { create } from 'zustand';
import { MarketState } from '../types/market';

export const useMarketStore = create<MarketState>((set) => ({
    currentSymbol: 'BTC/USD',
    currentTimeframe: '15min',
    instruments: [],
    prices: {},
    orderbook: null,
    signalHistory: [],
    selectedAI: 'ollama',

    setSymbol: (symbol) => set({ currentSymbol: symbol }),
    setTimeframe: (timeframe) => set({ currentTimeframe: timeframe }),

    setInstruments: (instruments) => set({ instruments }),

    updatePrice: (symbol, price) => set((state) => ({
        prices: { ...state.prices, [symbol]: price }
    })),

    updateOrderbook: (data) => set({ orderbook: data }),

    addSignal: (signal) => set((state) => {
        // Prevent duplicate signals (optional but good for UI)
        const lastSignal = state.signalHistory[0];
        if (lastSignal && lastSignal.signal === signal.signal && lastSignal.symbol === signal.symbol && lastSignal.timeframe === signal.timeframe && signal.timestamp - lastSignal.timestamp < 30000) {
            return state;
        }
        return {
            signalHistory: [signal, ...state.signalHistory].slice(0, 50)
        };
    }),

    setSelectedAI: (id) => set({ selectedAI: id })
}));
