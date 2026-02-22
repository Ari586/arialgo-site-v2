export interface Candle {
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface InstrumentState {
    symbol: string;
    name: string;
    icon: string;
    price: number;
}

export interface OrderbookEntry {
    price: number;
    qty: number;
    total: number;
}

export interface OrderbookData {
    bids: OrderbookEntry[];
    asks: OrderbookEntry[];
    ratio: number;
    pressure: 'BUY' | 'SELL' | 'NEUTRAL';
}

export interface SignalRecord {
    id: string;
    timestamp: number;
    symbol: string;
    timeframe: string;
    signal: 'BUY' | 'SELL' | 'HOLD';
    price: number;
    confidence: number;
    entryPrice?: number;
    takeProfit?: number;
    stopLoss?: number;
}

export interface MarketState {
    currentSymbol: string;
    currentTimeframe: string;
    instruments: string[];
    prices: Record<string, number>;
    orderbook: OrderbookData | null;
    signalHistory: SignalRecord[];
    selectedAI: string;
    // Actions
    setSymbol: (symbol: string) => void;
    setTimeframe: (timeframe: string) => void;
    setInstruments: (instruments: string[]) => void;
    updatePrice: (symbol: string, price: number) => void;
    updateOrderbook: (data: OrderbookData) => void;
    addSignal: (signal: SignalRecord) => void;
    setSelectedAI: (id: string) => void;
}
