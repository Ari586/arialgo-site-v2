import React, { useMemo, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useMarketStore } from '../store/marketStore';
import { calculateAllIndicators } from '../utils/indicators';
import { getMarketClosedReason, isSymbolMarketClosed } from '../utils/marketHours';
import { formatSymbolPrice } from '../utils/priceFormat';

type Direction = 'BUY' | 'SELL' | 'HOLD';
type StrategyMode = 'scalp-1m' | 'scalp-3m' | 'intraday' | 'swing';
type USDBiasMode = 'AUTO' | 'STRONG' | 'WEAK' | 'NEUTRAL';

const timeframeToSeconds = (tf: string): number => {
    const value = String(tf || '').toLowerCase();
    if (value === '1s') return 1;
    if (value === '5s') return 5;
    if (value === '15s') return 15;
    if (value === '30s') return 30;
    if (value === '1min' || value === '1m') return 60;
    if (value === '5min' || value === '5m') return 300;
    if (value === '15min' || value === '15m') return 900;
    if (value === '1h' || value === 'h1') return 3600;
    if (value === '4h' || value === 'h4') return 14400;
    return 60;
};

const strategyMinTimeframe = (mode: StrategyMode): string | null => {
    if (mode === 'intraday') return '5min';
    if (mode === 'swing') return '15min';
    return null;
};

interface AISignalResponse {
    success?: boolean;
    source?: string;
    signal: Direction;
    confidence?: number;
    reasoning?: string;
    entryPrice?: number;
    takeProfit?: number;
    stopLoss?: number;
}

interface FilterChecklistItem {
    id: string;
    label: string;
    passed: boolean;
    details?: string;
}

interface RiskFilterSummary {
    riskScore?: number;
    riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | string;
    blockTrade?: boolean;
    caution?: boolean;
    summary?: string;
    blockers?: string[];
    warnings?: string[];
    checklist?: FilterChecklistItem[];
}

interface MarketDataDiagnostic {
    source?: string;
    actor?: string;
    sourceClass?: string;
    providerChain?: string[];
    timeframe?: string;
    freshnessTargetMs?: number;
    feedTier?: string;
    l1?: {
        fresh?: boolean;
        tickAgeMs?: number | null;
        bid?: number;
        ask?: number;
        spread?: number;
    };
    l2?: {
        available?: boolean;
        source?: string;
        depthLevels?: number;
        ratio?: number | null;
        pressure?: string;
        synthetic?: boolean;
        real?: boolean;
    };
    filter?: RiskFilterSummary;
}

interface StrategyPredictionResponse {
    success?: boolean;
    source?: string;
    mode?: StrategyMode;
    usdBiasMode?: USDBiasMode | string;
    usdContext?: {
        source?: string;
        indexSymbol?: string;
        bias?: USDBiasMode | string;
        changePct?: number | null;
        strengthScore?: number;
        price?: number | null;
        fresh?: boolean;
        updatedAt?: string;
    };
    signal: Direction;
    confidence?: number;
    score?: number;
    horizonMinutes?: number;
    entryPrice?: number;
    takeProfit?: number;
    stopLoss?: number;
    reasoning?: string;
    reasons?: string[];
    targetTime?: string;
    blockedReason?: string;
    riskGate?: {
        enabled?: boolean;
        blocked?: boolean;
        initialSignal?: Direction;
        blockers?: string[];
        warnings?: string[];
        thresholds?: Record<string, number>;
        metrics?: {
            timeframe?: string;
            timeframeSeconds?: number;
            openSpikeRiskScore?: number;
            newsRiskScore?: number;
            dataQualityRiskScore?: number;
            macroRiskScore?: number;
            usdRiskScore?: number;
            marketDataRiskScore?: number;
            sessionRiskScore?: number;
            sessionVolatilityScore?: number;
            sessionLiquidityScore?: number;
            sessionNewsWindowScore?: number;
            marketDataFeedTier?: string;
            marketDataSourceClass?: string;
            marketDataL1AgeMs?: number | null;
            marketDataL2DepthLevels?: number;
        };
        filters?: {
            openSpike?: RiskFilterSummary;
            news?: RiskFilterSummary;
            dataQuality?: RiskFilterSummary;
            macroCalendar?: RiskFilterSummary;
            usd?: RiskFilterSummary;
            marketData?: RiskFilterSummary;
            session?: RiskFilterSummary;
        };
    };
    technicalSummary?: {
        totalChecks?: number;
        directionalChecks?: number;
        bullishChecks?: number;
        bearishChecks?: number;
        neutralChecks?: number;
        agreementPct?: number;
        activationPct?: number;
        reliabilityScore?: number;
        rawScore?: number;
        maxRawScore?: number;
        checks?: Array<{
            id: string;
            label: string;
            signal: Direction;
            weight: number;
            score: number;
            details?: string;
        }>;
    };
    geometry?: {
        slopePerCandle?: number;
        slopePctPerCandle?: number;
        channelBreak?: string;
        fibZone?: string | null;
        patternBias?: Direction;
    };
    newsFilter?: RiskFilterSummary;
    openSpikeFilter?: RiskFilterSummary;
    dataQualityFilter?: RiskFilterSummary;
    macroCalendarFilter?: RiskFilterSummary;
    usdFilter?: RiskFilterSummary;
    marketDataFilter?: RiskFilterSummary;
    sessionFilter?: RiskFilterSummary;
    marketData?: MarketDataDiagnostic;
    tradingSessions?: {
        generatedAt?: string;
        activeSessions?: string[];
        overlaps?: {
            londonNewYork?: boolean;
            sydneyTokyo?: boolean;
        };
        volatilityScore?: number;
        liquidityScore?: number;
        newsPublicationScore?: number;
        sessionRiskScore?: number;
        summary?: string;
    };
}

interface BacktestResponse {
    success?: boolean;
    source?: string;
    symbol?: string;
    mode?: StrategyMode;
    usdBiasMode?: USDBiasMode | string;
    usdContext?: StrategyPredictionResponse['usdContext'];
    timeframe?: string;
    bars?: number;
    horizonBars?: number;
    horizonMinutes?: number;
    evaluatedSamples?: number;
    blockedSignals?: number;
    trades?: number;
    buySignals?: number;
    sellSignals?: number;
    breakEvenTrades?: number;
    winRate?: number;
    lossRate?: number;
    avgReturnPct?: number;
    expectancyPct?: number;
    profitFactor?: number;
    maxWinPct?: number;
    maxLossPct?: number;
    maxDrawdownPct?: number;
    grossProfitPct?: number;
    grossLossPct?: number;
    avgConfidence?: number;
    avgRiskReward?: number;
    avgHoldingBars?: number;
    tpHits?: number;
    slHits?: number;
    timeExitTrades?: number;
    blockedBySignal?: number;
    blockedByQuality?: number;
    blockedByPattern?: number;
    blockedByRegime?: number;
    blockedByRiskReward?: number;
    blockedByEdge?: number;
    blockedByCooldown?: number;
    benchmarkBuyHoldPct?: number;
    thresholds?: {
        minDirectionalChecks?: number;
        minReliability?: number;
        minAgreementPct?: number;
        minConfidence?: number;
        minScalpScore?: number;
        minRiskReward?: number;
        roundTripCostBps?: number;
        breakEvenBandPct?: number;
        minAdx?: number;
        minAtrPct?: number;
        maxAtrPct?: number;
        minEdgePct?: number;
        minSpacingBars?: number;
    };
}

interface AIModelInfo {
    id: string;
    name: string;
    provider?: string;
    active?: boolean;
}

interface AIModelsResponse {
    success?: boolean;
    models?: AIModelInfo[];
}

const AI_ICON_MAP: Record<string, string> = {
    auto: '🧭',
    tradingagents: '🧩',
    ollama: '🤖',
    gemini: '✨',
    groq: '⚡',
    openrouter: '🌐',
    'gpt-5': '⚡',
    'claude-opus': '🦾',
    glm: '🧠',
    codex: '🧠',
    copilot: '🪁',
};

const fetchHistory = async (symbol: string, timeframe: string) => {
    const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}&outputsize=1000`);
    const data = await res.json();
    return data.data || [];
};

const postAISignal = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/ai-signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    return res.json() as Promise<AISignalResponse>;
};

const fetchAIModels = async () => {
    const res = await fetch('/api/ai-models');
    return res.json() as Promise<AIModelsResponse>;
};

const STRATEGY_MODE_STORAGE_KEY = 'ari_strategy_mode';
const USD_BIAS_STORAGE_KEY = 'ari_usd_bias_mode';

function readStrategyMode(): StrategyMode {
    if (typeof window === 'undefined') return 'scalp-3m';
    const raw = String(window.localStorage.getItem(STRATEGY_MODE_STORAGE_KEY) || '').trim().toLowerCase();
    if (raw === 'intraday' || raw === 'swing' || raw === 'scalp-3m' || raw === 'scalp-1m') return raw;
    return 'scalp-3m';
}

function saveStrategyMode(mode: StrategyMode) {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STRATEGY_MODE_STORAGE_KEY, mode);
}

function readUsdBiasMode(): USDBiasMode {
    if (typeof window === 'undefined') return 'AUTO';
    const raw = String(window.localStorage.getItem(USD_BIAS_STORAGE_KEY) || '').trim().toUpperCase();
    if (raw === 'STRONG' || raw === 'WEAK' || raw === 'NEUTRAL' || raw === 'AUTO') return raw;
    return 'AUTO';
}

function saveUsdBiasMode(mode: USDBiasMode) {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(USD_BIAS_STORAGE_KEY, mode);
}

const postStrategySignal = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/strategy-signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    return res.json() as Promise<StrategyPredictionResponse>;
};

const postBacktestStrategy = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/backtest-strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    return res.json() as Promise<BacktestResponse>;
};

function compactIndicatorsForBacktest(indicators: any) {
    if (!indicators || typeof indicators !== 'object') return null;
    const compactZoneList = (zones: any) => Array.isArray(zones)
        ? zones.slice(0, 10).map((z) => ({ type: String(z?.type || '').toUpperCase() }))
        : [];
    const compactPatternList = (patterns: any) => Array.isArray(patterns)
        ? patterns.slice(0, 10).map((p) => ({
            name: String(p?.name || ''),
            confidence: Number(p?.confidence || 0),
            tone: String(p?.type || p?.signal || ''),
            signal: String(p?.nextAction || p?.signal || p?.type || p?.tone || ''),
            riskReward: Number(p?.riskReward || 0),
            horizonBars: Number(p?.horizonBars || 0)
        }))
        : [];
    const blocks = indicators?.proCombo?.blocks || {};

    return {
        ema21: indicators.ema21 ?? null,
        ema50: indicators.ema50 ?? null,
        ema200: indicators.ema200 ?? null,
        ichimoku: indicators.ichimoku ? { signal: indicators.ichimoku.signal } : null,
        rsi: indicators.rsi ?? null,
        macdLine: indicators.macdLine ?? null,
        macdSignal: indicators.macdSignal ?? null,
        macdHistogram: indicators.macdHistogram ?? null,
        rsiDivergence: indicators.rsiDivergence ? { signal: indicators.rsiDivergence.signal } : null,
        stochastic: indicators.stochastic ? { k: indicators.stochastic.k, d: indicators.stochastic.d } : null,
        stochRsi: indicators.stochRsi ? { signal: indicators.stochRsi.signal } : null,
        adx: indicators.adx ? { plusDI: indicators.adx.plusDI, minusDI: indicators.adx.minusDI, adx: indicators.adx.adx } : null,
        williamsR: indicators.williamsR ?? null,
        cci: indicators.cci ?? null,
        mfi: indicators.mfi ?? null,
        obv: indicators.obv ? { trend: indicators.obv.trend } : null,
        cvd: indicators.cvd ? { trend: indicators.cvd.trend } : null,
        volumeProfile: indicators.volumeProfile ? { skew: indicators.volumeProfile.skew } : null,
        vwap: indicators.vwap ?? null,
        bbSqueeze: indicators.bbSqueeze ? { state: indicators.bbSqueeze.state, intensity: indicators.bbSqueeze.intensity } : null,
        keltner: indicators.keltner ? { middle: indicators.keltner.middle } : null,
        mtfConfluence: indicators.mtfConfluence ? { signal: indicators.mtfConfluence.signal, strength: indicators.mtfConfluence.strength } : null,
        atr: indicators.atr ?? null,
        fibonacci: indicators.fibonacci
            ? { trend: indicators.fibonacci.trend, inGoldenPocket: indicators.fibonacci.inGoldenPocket, nearestLevel: indicators.fibonacci.nearestLevel }
            : null,
        orderBlocks: compactZoneList(indicators.orderBlocks),
        fvgs: compactZoneList(indicators.fvgs),
        patterns: compactPatternList(indicators.patterns),
        proCombo: indicators.proCombo ? {
            signal: indicators.proCombo.signal,
            score: indicators.proCombo.score,
            blocks: {
                trend: blocks?.trend ? { signal: blocks.trend.signal, score: blocks.trend.score } : null,
                momentum: blocks?.momentum ? { signal: blocks.momentum.signal, score: blocks.momentum.score } : null,
                volume: blocks?.volume ? { signal: blocks.volume.signal, score: blocks.volume.score } : null,
                volatility: blocks?.volatility ? { signal: blocks.volatility.signal, score: blocks.volatility.score } : null,
                structure: blocks?.structure ? { signal: blocks.structure.signal, score: blocks.structure.score } : null,
                confirmation: blocks?.confirmation ? { signal: blocks.confirmation.signal, score: blocks.confirmation.score } : null
            }
        } : null
    };
}

const formatLevel = (symbol: string, value?: number) => {
    const n = Number(value);
    return Number.isFinite(n) ? formatSymbolPrice(symbol, n) : '—';
};

export default function AISignalPanel() {
    const currentSymbol = useMarketStore(state => state.currentSymbol);
    const currentTimeframe = useMarketStore(state => state.currentTimeframe);
    const signalHistory = useMarketStore(state => state.signalHistory);
    const livePrice = useMarketStore(state => state.prices[currentSymbol]);
    const orderbook = useMarketStore(state => state.orderbook);
    const priceMetaMap = useMarketStore(state => state.priceMeta);
    const isMarketClosed = isSymbolMarketClosed(currentSymbol);
    const marketClosedReason = getMarketClosedReason(currentSymbol);
    const lastScalpRunRef = useRef(0);
    const lastBacktestRunRef = useRef(0);
    const [strategyMode, setStrategyMode] = React.useState<StrategyMode>(() => readStrategyMode());
    const [usdBiasMode, setUsdBiasMode] = React.useState<USDBiasMode>(() => readUsdBiasMode());

    const { data: history } = useQuery({
        queryKey: ['history', currentSymbol, currentTimeframe],
        queryFn: () => fetchHistory(currentSymbol, currentTimeframe),
        staleTime: 60000,
    });
    const { data: aiModelsData } = useQuery({
        queryKey: ['ai-models'],
        queryFn: fetchAIModels,
        staleTime: 60000,
        refetchInterval: 120000,
    });

    const candlesForAnalysis = useMemo(() => {
        if (!history || history.length < 30) return [];
        const candles = [...history];
        if (livePrice) {
            const last = { ...candles[candles.length - 1] };
            last.close = livePrice;
            last.high = Math.max(last.high, livePrice);
            last.low = Math.min(last.low, livePrice);
            candles[candles.length - 1] = last;
        }
        return candles;
    }, [history, livePrice]);

    const indicators = useMemo(() => {
        if (!candlesForAnalysis || candlesForAnalysis.length < 30) return null;
        return calculateAllIndicators(candlesForAnalysis);
    }, [candlesForAnalysis]);
    const currentPriceMeta = useMemo(() => priceMetaMap[currentSymbol] || null, [priceMetaMap, currentSymbol]);

    const addSignal = useMarketStore(state => state.addSignal);
    const selectedAI = useMarketStore(state => state.selectedAI);
    const setSelectedAI = useMarketStore(state => state.setSelectedAI);

    const mutation = useMutation({
        mutationFn: postAISignal,
        onSuccess: (data) => {
            if (data && data.signal) {
                addSignal({
                    id: Math.random().toString(36).substring(7),
                    timestamp: Date.now(),
                    symbol: currentSymbol,
                    timeframe: currentTimeframe,
                    signal: data.signal,
                    price: livePrice || 0,
                    confidence: data.confidence || 0,
                    entryPrice: data.entryPrice,
                    takeProfit: data.takeProfit,
                    stopLoss: data.stopLoss
                });
            }
        }
    });

    const strategyMutation = useMutation({
        mutationFn: postStrategySignal,
        onSuccess: (data) => {
            if (!data?.signal) return;
            addSignal({
                id: Math.random().toString(36).substring(7),
                timestamp: Date.now(),
                symbol: currentSymbol,
                timeframe: currentTimeframe,
                signal: data.signal,
                price: Number(data.entryPrice || livePrice || 0),
                confidence: Number(data.confidence || 0),
                entryPrice: data.entryPrice,
                takeProfit: data.takeProfit,
                stopLoss: data.stopLoss
            });
        }
    });
    const backtestMutation = useMutation({
        mutationFn: postBacktestStrategy
    });

    // Keep timeframe under user control.
    // We only show compatibility warnings for strategy mode, without auto-forcing chart timeframe.

    const aiPayload = useMemo(() => {
        if (!indicators || !livePrice || candlesForAnalysis.length < 30) return null;
        return {
            symbol: currentSymbol,
            currentPrice: livePrice,
            candles: candlesForAnalysis.slice(-80),
            indicators,
            aiModel: selectedAI,
            usdBias: usdBiasMode
        };
    }, [indicators, livePrice, candlesForAnalysis, currentSymbol, selectedAI, usdBiasMode]);

    const strategyPayload = useMemo(() => {
        if (!indicators || !livePrice || candlesForAnalysis.length < 30) return null;
        const depth = strategyMode === 'swing'
            ? 1000
            : strategyMode === 'intraday'
                ? 500
                : strategyMode === 'scalp-1m'
                    ? 170
                    : 140;
        return {
            symbol: currentSymbol,
            timeframe: currentTimeframe,
            mode: strategyMode,
            usdBias: usdBiasMode,
            currentPrice: livePrice,
            candles: candlesForAnalysis.slice(-depth),
            indicators,
            marketContext: {
                priceMeta: currentPriceMeta,
                orderbook: orderbook && orderbook.symbol === currentSymbol
                    ? orderbook
                    : (orderbook && !orderbook.symbol ? orderbook : null)
            }
        };
    }, [indicators, livePrice, candlesForAnalysis, currentSymbol, currentTimeframe, strategyMode, usdBiasMode, currentPriceMeta, orderbook]);

    const backtestPayload = useMemo(() => {
        if (!history || history.length < 180) return null;
        const depth = strategyMode === 'swing'
            ? 1100
            : strategyMode === 'intraday'
                ? 750
                : strategyMode === 'scalp-1m'
                    ? 620
                    : 520;
        const baseCandles = history
            .slice(-depth)
            .map((c: any) => ({
                time: Number(c?.time || 0),
                open: Number(c?.open || 0),
                high: Number(c?.high || 0),
                low: Number(c?.low || 0),
                close: Number(c?.close || 0),
                volume: Number(c?.volume || 0),
            }))
            .filter((c: any) => c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0);

        if (baseCandles.length < 180) return null;

        const warmup = strategyMode === 'swing'
            ? 220
            : strategyMode === 'intraday'
                ? 160
                : strategyMode === 'scalp-1m'
                    ? 120
                    : 100;
        const usable = baseCandles.length - warmup - 2;
        if (usable <= 0) return null;

        const maxSnapshots = strategyMode === 'swing'
            ? 180
            : strategyMode === 'intraday'
                ? 150
                : strategyMode === 'scalp-1m'
                    ? 140
                    : 120;
        const stride = Math.max(1, Math.ceil(usable / maxSnapshots));
        const indicatorSamples: Array<{ index: number; indicators: any }> = [];

        for (let idx = warmup; idx < baseCandles.length - 2; idx += stride) {
            const subset = baseCandles.slice(0, idx + 1);
            const snapshot = calculateAllIndicators(subset as any);
            if (!snapshot) continue;
            const compact = compactIndicatorsForBacktest(snapshot);
            if (!compact) continue;
            indicatorSamples.push({ index: idx, indicators: compact });
        }

        if (indicatorSamples.length < 20) return null;

        return {
            symbol: currentSymbol,
            timeframe: currentTimeframe,
            mode: strategyMode,
            usdBias: usdBiasMode,
            candles: baseCandles,
            indicatorSamples,
            maxSamples: strategyMode === 'swing' ? 360 : strategyMode === 'scalp-1m' ? 340 : 320
        };
    }, [history, currentSymbol, currentTimeframe, strategyMode, usdBiasMode]);

    const runAiAnalysis = React.useCallback(() => {
        if (!aiPayload || mutation.isPending) return;
        mutation.mutate(aiPayload);
    }, [aiPayload, mutation]);

    const runStrategyRefresh = React.useCallback(() => {
        if (!strategyPayload || strategyMutation.isPending) return;
        lastScalpRunRef.current = Date.now();
        strategyMutation.mutate(strategyPayload);
    }, [strategyPayload, strategyMutation]);

    const runBacktestRefresh = React.useCallback(() => {
        if (!backtestPayload || backtestMutation.isPending) return;
        lastBacktestRunRef.current = Date.now();
        backtestMutation.mutate(backtestPayload);
    }, [backtestPayload, backtestMutation]);

    // Auto-refresh by strategy horizon, tied to live ticks.
    React.useEffect(() => {
        if (isMarketClosed || !strategyPayload || strategyMutation.isPending) return;
        const minPushMs = strategyMode === 'swing'
            ? 30000
            : strategyMode === 'intraday'
                ? 15000
                : strategyMode === 'scalp-1m'
                    ? 4000
                    : 7000;
        const now = Date.now();
        if (now - lastScalpRunRef.current < minPushMs) return;
        lastScalpRunRef.current = now;
        strategyMutation.mutate(strategyPayload);
    }, [isMarketClosed, strategyPayload, strategyMutation, livePrice, strategyMode]);

    React.useEffect(() => {
        if (isMarketClosed || !backtestPayload || backtestMutation.isPending) return;
        const minPushMs = strategyMode === 'swing'
            ? 180000
            : strategyMode === 'scalp-1m'
                ? 60000
                : 90000;
        const now = Date.now();
        if (now - lastBacktestRunRef.current < minPushMs) return;
        lastBacktestRunRef.current = now;
        backtestMutation.mutate(backtestPayload);
    }, [isMarketClosed, backtestPayload, backtestMutation, strategyMode]);

    const AI_MODELS = useMemo(() => {
        const fallbackModels: AIModelInfo[] = [
            { id: 'tradingagents', name: 'TradingAgents Graph', provider: 'TradingAgents bridge', active: false },
            { id: 'gemini', name: 'Gemini 2.0 Flash', provider: 'Google', active: false },
            { id: 'groq', name: 'Llama 3.3 70B', provider: 'Groq', active: false },
            { id: 'openrouter', name: 'Mixtral 8x7B', provider: 'OpenRouter', active: false },
            { id: 'ollama', name: 'Gemma 3 4B', provider: 'Ollama (local)', active: false },
        ];

        const models = Array.isArray(aiModelsData?.models) && aiModelsData.models.length > 0
            ? aiModelsData.models
            : fallbackModels;

        return [
            { id: 'auto', name: 'Auto', provider: 'Auto fallback', active: true, icon: AI_ICON_MAP.auto },
            ...models.map((m) => ({
                ...m,
                icon: AI_ICON_MAP[m.id] || '🧩',
            })),
        ];
    }, [aiModelsData]);

    React.useEffect(() => {
        if (!AI_MODELS.some((m) => m.id === selectedAI)) {
            setSelectedAI('auto');
        }
    }, [AI_MODELS, selectedAI, setSelectedAI]);

    if (isMarketClosed) {
        return (
            <div style={{
                padding: '12px',
                fontSize: '12px',
                color: 'var(--gold)',
                background: 'rgba(245,176,65,0.08)',
                border: '1px solid var(--gold)',
                borderRadius: '8px',
                margin: '4px 8px 8px 8px'
            }}>
                MARCHE FERME pour {currentSymbol}.<br />
                <span style={{ color: 'var(--text-secondary)' }}>{marketClosedReason}</span>
            </div>
        );
    }

    const signalData = mutation.data;
    const isBuy = signalData?.signal === 'BUY';
    const isSell = signalData?.signal === 'SELL';
    const colorType = isBuy ? 'buy' : isSell ? 'sell' : 'neutral';
    const strategyData = strategyMutation.data;
    const strategyColor = strategyData?.signal === 'BUY' ? 'var(--buy)' : strategyData?.signal === 'SELL' ? 'var(--sell)' : 'var(--gold)';
    const strategyBg = strategyData?.signal === 'BUY'
        ? 'var(--buy-bg)'
        : strategyData?.signal === 'SELL'
            ? 'var(--sell-bg)'
            : 'rgba(255,255,255,0.05)';
    const strategyEta = strategyData?.targetTime
        ? new Date(strategyData.targetTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : '—';
    const strategyMinTf = strategyMinTimeframe(strategyMode);
    const strategyTfMismatch = !!strategyMinTf && timeframeToSeconds(currentTimeframe) < timeframeToSeconds(strategyMinTf);
    const hasInputs = !!aiPayload;
    const strategyLabel = strategyMode === 'swing'
        ? 'SWING'
        : strategyMode === 'intraday'
            ? 'INTRADAY'
            : strategyMode === 'scalp-1m'
                ? 'SCALPING 1 MIN'
                : 'SCALPING 3 MIN';
    const tpLabel = strategyMode === 'swing'
        ? 'TP SW'
        : strategyMode === 'intraday'
            ? 'TP ID'
            : strategyMode === 'scalp-1m'
                ? 'TP 1M'
                : 'TP 3M';
    const slLabel = strategyMode === 'swing'
        ? 'SL SW'
        : strategyMode === 'intraday'
            ? 'SL ID'
            : strategyMode === 'scalp-1m'
                ? 'SL 1M'
                : 'SL 3M';
    const totalChecks = Number(strategyData?.technicalSummary?.totalChecks || 0);
    const directionalChecks = Number(strategyData?.technicalSummary?.directionalChecks || 0);
    const reliabilityScore = Number(strategyData?.technicalSummary?.reliabilityScore || 0);
    const agreementPct = Number(strategyData?.technicalSummary?.agreementPct || 0);
    const backtestData = backtestMutation.data;
    const newsFilter = strategyData?.newsFilter || strategyData?.riskGate?.filters?.news;
    const openSpikeFilter = strategyData?.openSpikeFilter || strategyData?.riskGate?.filters?.openSpike;
    const dataQualityFilter = strategyData?.dataQualityFilter || strategyData?.riskGate?.filters?.dataQuality;
    const macroCalendarFilter = strategyData?.macroCalendarFilter || strategyData?.riskGate?.filters?.macroCalendar;
    const usdFilter = strategyData?.usdFilter || strategyData?.riskGate?.filters?.usd;
    const marketDataFilter = strategyData?.marketDataFilter || strategyData?.riskGate?.filters?.marketData || strategyData?.marketData?.filter;
    const sessionFilter = strategyData?.sessionFilter || strategyData?.riskGate?.filters?.session;
    const sessionContext = strategyData?.tradingSessions;
    const usdContext = strategyData?.usdContext;
    const marketDataContext = strategyData?.marketData;
    const riskWarnings = Array.isArray(strategyData?.riskGate?.warnings) ? strategyData.riskGate.warnings : [];
    const resultDistribution = (() => {
        const safePct = (value: number) => Number(Math.max(0, value).toFixed(1));

        if (backtestData?.success && Number(backtestData.evaluatedSamples) > 0) {
            const total = Math.max(1, Math.round(Number(backtestData.evaluatedSamples) || 0));
            const trades = Math.max(0, Math.round(Number(backtestData.trades) || 0));
            const blocked = Math.max(0, Math.min(total, Math.round(Number(backtestData.blockedSignals) || 0)));
            const winRate = Math.max(0, Math.min(100, Number(backtestData.winRate) || 0));
            const wins = Math.max(0, Math.min(trades, Math.round((trades * winRate) / 100)));
            const breakEven = Math.max(0, Math.min(trades - wins, Math.round(Number(backtestData.breakEvenTrades) || 0)));
            const losses = Math.max(0, trades - wins - breakEven);
            const neutral = Math.max(0, total - wins - losses - breakEven - blocked);

            const slices = [
                { id: 'wins', label: 'Gagnants', count: wins, color: 'var(--buy)' },
                { id: 'losses', label: 'Perdants', count: losses, color: 'var(--sell)' },
                { id: 'breakeven', label: 'Breakeven', count: breakEven, color: '#60a5fa' },
                { id: 'blocked', label: 'Bloqués', count: blocked, color: '#f6c84c' },
                { id: 'neutral', label: 'Neutres', count: neutral, color: '#94a3b8' }
            ]
                .filter((slice) => slice.count > 0)
                .map((slice) => ({ ...slice, pct: safePct((slice.count / total) * 100) }));

            return {
                title: 'Distribution Backtest',
                total,
                slices
            };
        }

        const scoped = signalHistory
            .filter((s) => s.symbol === currentSymbol && s.timeframe === currentTimeframe)
            .slice(0, 60);
        const total = scoped.length;
        if (total <= 0) return null;

        const buys = scoped.filter((s) => s.signal === 'BUY').length;
        const sells = scoped.filter((s) => s.signal === 'SELL').length;
        const holds = scoped.filter((s) => s.signal !== 'BUY' && s.signal !== 'SELL').length;
        const slices = [
            { id: 'buy', label: 'BUY', count: buys, color: 'var(--buy)' },
            { id: 'sell', label: 'SELL', count: sells, color: 'var(--sell)' },
            { id: 'hold', label: 'HOLD', count: holds, color: '#94a3b8' }
        ]
            .filter((slice) => slice.count > 0)
            .map((slice) => ({ ...slice, pct: safePct((slice.count / total) * 100) }));

        return {
            title: 'Distribution Signaux',
            total,
            slices
        };
    })();
    const resultDonutGradient = (() => {
        if (!resultDistribution || resultDistribution.slices.length === 0) return '';
        let cursor = 0;
        const stops: string[] = [];
        for (const slice of resultDistribution.slices) {
            const start = cursor;
            const end = Math.min(100, cursor + slice.pct);
            stops.push(`${slice.color} ${start}% ${end}%`);
            cursor = end;
        }
        if (cursor < 100) {
            stops.push(`rgba(148,163,184,0.18) ${cursor}% 100%`);
        }
        return `conic-gradient(${stops.join(', ')})`;
    })();
    const selectedModelMeta = AI_MODELS.find((m) => m.id === selectedAI);
    const tradingAgentsActive = !!AI_MODELS.find((m) => m.id === 'tradingagents' && m.active !== false);
    const engineLabel = selectedAI === 'auto'
        ? (tradingAgentsActive
            ? 'AUTO → Gemini > Groq > OpenRouter > Ollama > TradingAgents > algorithmique'
            : 'AUTO → Gemini > Groq > OpenRouter > Ollama > algorithmique')
        : `${selectedModelMeta?.name || selectedAI}${selectedModelMeta?.active === false ? ' (indisponible, fallback algorithmique)' : ''}`;

    const renderFilterChecklist = (title: string, filter?: RiskFilterSummary, accentColor = 'var(--gold)') => {
        if (!filter) return null;
        const checklist = Array.isArray(filter.checklist) ? filter.checklist : [];
        const score = Number(filter.riskScore || 0);
        const riskLevel = String(filter.riskLevel || (filter.blockTrade ? 'HIGH' : filter.caution ? 'MEDIUM' : 'LOW'));
        const normalizedRisk = riskLevel.toUpperCase();
        const badgeBg = normalizedRisk === 'HIGH' || normalizedRisk === 'UNSAFE'
            ? 'rgba(255, 107, 107, 0.14)'
            : normalizedRisk === 'MEDIUM' || normalizedRisk === 'CAUTION'
                ? 'rgba(255, 193, 7, 0.15)'
                : 'rgba(76, 175, 80, 0.15)';
        const badgeColor = normalizedRisk === 'HIGH' || normalizedRisk === 'UNSAFE'
            ? 'var(--sell)'
            : normalizedRisk === 'MEDIUM' || normalizedRisk === 'CAUTION'
                ? '#f6c84c'
                : 'var(--buy)';

        return (
            <div style={{ marginTop: '8px', padding: '8px', borderRadius: '7px', border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: checklist.length > 0 ? '6px' : 0 }}>
                    <div style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.5px', color: accentColor }}>{title}</div>
                    <div style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '10px', background: badgeBg, color: badgeColor, fontWeight: 800 }}>
                        {riskLevel} · {Math.round(score)}
                    </div>
                </div>
                {filter.summary && (
                    <div style={{ fontSize: '10px', lineHeight: 1.4, color: 'var(--text-secondary)', marginBottom: checklist.length > 0 ? '5px' : 0 }}>
                        {filter.summary}
                    </div>
                )}
                {checklist.length > 0 && (
                    <ul style={{ margin: '0 0 0 14px', padding: 0, fontSize: '10px', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                        {checklist.slice(0, 5).map((item) => (
                            <li key={`${title}-${item.id}`} style={{ color: item.passed ? 'var(--text-secondary)' : 'var(--text-main)' }}>
                                {item.passed ? 'OK' : 'FAIL'} · {item.label}{item.details ? ` (${item.details})` : ''}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        );
    };

    return (
        <div className="ai-panel" style={{ padding: '0 8px 8px 8px' }}>
            <div className="ai-selector" style={{ display: 'flex', gap: '4px', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid var(--border)' }}>
                {AI_MODELS.map(m => (
                    <button
                        key={m.id}
                        disabled={m.id !== 'auto' && m.active === false}
                        onClick={() => setSelectedAI(m.id)}
                        title={`${m.name}${m.provider ? ` · ${m.provider}` : ''}${m.active === false ? ' · indisponible' : ''}`}
                        style={{
                            flex: 1,
                            padding: '6px 2px',
                            background: selectedAI === m.id ? 'rgba(255,215,0,0.1)' : 'transparent',
                            border: '1px solid',
                            borderColor: selectedAI === m.id ? 'var(--gold)' : 'transparent',
                            borderRadius: '4px',
                            cursor: (m.id !== 'auto' && m.active === false) ? 'not-allowed' : 'pointer',
                            fontSize: '14px',
                            transition: 'all 0.2s',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '2px',
                            opacity: m.active === false ? 0.45 : 1
                        }}
                    >
                        <span>{m.icon}</span>
                        <span style={{ fontSize: '8px', fontWeight: 700, opacity: selectedAI === m.id ? 1 : 0.5 }}>{m.name.toUpperCase()}</span>
                    </button>
                ))}
            </div>
            <div style={{ marginTop: '-8px', marginBottom: '10px', fontSize: '10px', color: 'var(--text-secondary)' }}>
                Moteur actif: <span style={{ color: 'var(--text-main)', fontWeight: 700 }}>{engineLabel}</span>
            </div>

            <div className="ai-action-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '10px' }}>
                <button
                    onClick={runAiAnalysis}
                    disabled={!hasInputs || mutation.isPending}
                    style={{
                        padding: '8px',
                        fontSize: '11px',
                        fontWeight: 800,
                        letterSpacing: '0.5px',
                        borderRadius: '6px',
                        border: '1px solid var(--gold)',
                        background: mutation.isPending ? 'rgba(255,215,0,0.08)' : 'rgba(255,215,0,0.14)',
                        color: 'var(--gold)',
                        cursor: !hasInputs || mutation.isPending ? 'not-allowed' : 'pointer',
                        opacity: !hasInputs || mutation.isPending ? 0.6 : 1
                    }}
                >
                    {mutation.isPending ? 'ANALYSE IA...' : 'ANALYSE IA MANUELLE'}
                </button>
                <button
                    onClick={runStrategyRefresh}
                    disabled={!strategyPayload || strategyMutation.isPending}
                    style={{
                        padding: '8px',
                        fontSize: '11px',
                        fontWeight: 800,
                        letterSpacing: '0.5px',
                        borderRadius: '6px',
                        border: '1px solid var(--border)',
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-main)',
                        cursor: !strategyPayload || strategyMutation.isPending ? 'not-allowed' : 'pointer',
                        opacity: !strategyPayload || strategyMutation.isPending ? 0.6 : 1
                    }}
                >
                    {strategyMutation.isPending ? 'PREDICTION...' : 'RAFRAICHIR PREDICTION'}
                </button>
                <button
                    onClick={runBacktestRefresh}
                    disabled={!backtestPayload || backtestMutation.isPending}
                    style={{
                        padding: '8px',
                        fontSize: '11px',
                        fontWeight: 800,
                        letterSpacing: '0.5px',
                        borderRadius: '6px',
                        border: '1px solid var(--border)',
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-main)',
                        cursor: !backtestPayload || backtestMutation.isPending ? 'not-allowed' : 'pointer',
                        opacity: !backtestPayload || backtestMutation.isPending ? 0.6 : 1
                    }}
                >
                    {backtestMutation.isPending ? 'BACKTEST...' : 'RAFRAICHIR BACKTEST'}
                </button>
            </div>

            <div className="ai-mode-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '6px', marginBottom: '10px' }}>
                {[
                    { id: 'scalp-1m' as StrategyMode, label: 'SCALP 1M' },
                    { id: 'scalp-3m' as StrategyMode, label: 'SCALP 3M' },
                    { id: 'intraday' as StrategyMode, label: 'INTRADAY' },
                    { id: 'swing' as StrategyMode, label: 'SWING' }
                ].map((mode) => (
                    <button
                        key={mode.id}
                        type="button"
                        onClick={() => {
                            setStrategyMode(mode.id);
                            saveStrategyMode(mode.id);
                            lastScalpRunRef.current = 0;
                            lastBacktestRunRef.current = 0;
                        }}
                        style={{
                            padding: '7px 6px',
                            borderRadius: '6px',
                            border: `1px solid ${strategyMode === mode.id ? 'var(--gold)' : 'var(--border)'}`,
                            background: strategyMode === mode.id ? 'rgba(245,176,65,0.13)' : 'var(--bg-tertiary)',
                            color: strategyMode === mode.id ? 'var(--gold)' : 'var(--text-secondary)',
                            fontSize: '10px',
                            fontWeight: 800,
                            letterSpacing: '0.5px',
                            cursor: 'pointer'
                        }}
                    >
                        {mode.label}
                    </button>
                ))}
            </div>

            <div className="ai-usd-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '6px', marginBottom: '10px' }}>
                {[
                    { id: 'AUTO' as USDBiasMode, label: 'USD AUTO' },
                    { id: 'STRONG' as USDBiasMode, label: 'USD FORT' },
                    { id: 'WEAK' as USDBiasMode, label: 'USD FAIBLE' },
                    { id: 'NEUTRAL' as USDBiasMode, label: 'USD NEUTRE' }
                ].map((mode) => (
                    <button
                        key={mode.id}
                        type="button"
                        onClick={() => {
                            setUsdBiasMode(mode.id);
                            saveUsdBiasMode(mode.id);
                            lastScalpRunRef.current = 0;
                            lastBacktestRunRef.current = 0;
                        }}
                        style={{
                            padding: '7px 6px',
                            borderRadius: '6px',
                            border: `1px solid ${usdBiasMode === mode.id ? 'var(--gold)' : 'var(--border)'}`,
                            background: usdBiasMode === mode.id ? 'rgba(245,176,65,0.13)' : 'var(--bg-tertiary)',
                            color: usdBiasMode === mode.id ? 'var(--gold)' : 'var(--text-secondary)',
                            fontSize: '10px',
                            fontWeight: 800,
                            letterSpacing: '0.4px',
                            cursor: 'pointer'
                        }}
                    >
                        {mode.label}
                    </button>
                ))}
            </div>

            {strategyMinTf && (
                <div style={{ marginBottom: '10px', fontSize: '11px', color: strategyTfMismatch ? '#f6c84c' : 'var(--text-secondary)' }}>
                    Mode {strategyMode.toUpperCase()} utilise mieux {strategyMinTf}+ (timeframe actuelle: {currentTimeframe}).
                </div>
            )}

            {!hasInputs && (
                <div style={{ marginBottom: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    En attente de suffisamment de données marché...
                </div>
            )}

            {signalData && (
                <>
                    <div className={`ai-header ${colorType}`}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <div className="ai-badge">{signalData.source?.toUpperCase() || 'ALGORITHMIQUE'}</div>
                            <div className="ai-confidence">
                                FIABILITÉ: <span style={{ color: 'var(--text-main)', fontWeight: 'bold' }}>{signalData.confidence || 0}%</span>
                            </div>
                        </div>
                        <div className="ai-action">{signalData.signal}</div>
                    </div>

                    <div className="trade-levels">
                        <div className="level-box entry">
                            <span className="level-label">ENTRÉE</span>
                            <span className="level-value">{formatLevel(currentSymbol, signalData.entryPrice || livePrice)}</span>
                        </div>
                        <div className="level-box tp">
                            <span className="level-label">TAKE PROFIT</span>
                            <span className="level-value">{formatLevel(currentSymbol, signalData.takeProfit)}</span>
                        </div>
                        <div className="level-box sl">
                            <span className="level-label">STOP LOSS</span>
                            <span className="level-value">{formatLevel(currentSymbol, signalData.stopLoss)}</span>
                        </div>
                    </div>

                    <div className="ai-reasoning" style={{ marginBottom: '12px' }}>
                        <strong>💡 Raisonnement IA:</strong> <br />
                        {signalData.reasoning || "Analyse basée sur de multiples indicateurs techniques et momentum."}
                    </div>
                </>
            )}

            {!signalData && !mutation.isPending && (
                <div className="ai-reasoning" style={{ marginBottom: '12px' }}>
                    Clique sur <strong>ANALYSE IA MANUELLE</strong> pour générer un signal complet (plus lent, mais détaillé).
                </div>
            )}

            <div style={{ border: `1px solid ${strategyColor}`, background: strategyBg, borderRadius: '8px', padding: '12px', marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.6px', color: 'var(--text-secondary)' }}>
                        PREDICTION {strategyLabel}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                        ETA {strategyEta}
                    </div>
                </div>
                {strategyData ? (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <div style={{ fontSize: '22px', fontWeight: 900, color: strategyColor }}>{strategyData.signal}</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-main)' }}>
                                Confiance <strong>{Math.round(Number(strategyData.confidence) || 0)}%</strong> | Score <strong>{Number(strategyData.score || 0).toFixed(1)}</strong>
                            </div>
                        </div>
                        {totalChecks > 0 && (
                            <div style={{ marginBottom: '8px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                                Analyses techniques: <strong style={{ color: 'var(--text-main)' }}>{directionalChecks}/{totalChecks}</strong> directionnelles
                                {' '}| Accord <strong style={{ color: 'var(--text-main)' }}>{agreementPct}%</strong>
                                {' '}| Fiabilité <strong style={{ color: 'var(--text-main)' }}>{reliabilityScore}%</strong>
                            </div>
                        )}
                        <div className="backtest-metrics-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginBottom: '8px' }}>
                            <div className="level-box entry">
                                <span className="level-label">ENTRÉE</span>
                                <span className="level-value">{formatLevel(currentSymbol, strategyData.entryPrice || livePrice)}</span>
                            </div>
                            <div className="level-box tp">
                                <span className="level-label">{tpLabel}</span>
                                <span className="level-value">{formatLevel(currentSymbol, strategyData.takeProfit)}</span>
                            </div>
                            <div className="level-box sl">
                                <span className="level-label">{slLabel}</span>
                                <span className="level-value">{formatLevel(currentSymbol, strategyData.stopLoss)}</span>
                            </div>
                        </div>
                        <div style={{ fontSize: '12px', lineHeight: 1.45 }}>
                            {strategyData.reasoning || 'Analyse en cours...'}
                        </div>
                        {strategyData.riskGate?.blocked && (
                            <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--sell)' }}>
                                Garde-fou actif: {strategyData.blockedReason || 'signal bloqué'}
                            </div>
                        )}
                        {!strategyData.riskGate?.blocked && riskWarnings.length > 0 && (
                            <div style={{ marginTop: '8px', fontSize: '11px', color: '#f6c84c' }}>
                                Avertissement: {riskWarnings.slice(0, 2).join(' | ')}
                            </div>
                        )}
                        {usdContext && (
                            <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                                USD ({usdContext.indexSymbol || 'DXY'}): {String(usdContext.bias || 'NEUTRAL').toUpperCase()}
                                {' '}| Δ {Number.isFinite(Number(usdContext.changePct)) ? `${Number(usdContext.changePct).toFixed(3)}%` : 'n/a'}
                                {' '}| force {Math.round(Number(usdContext.strengthScore || 0))}
                                {usdContext.fresh === false ? ' | stale' : ''}
                            </div>
                        )}
                        {marketDataContext && (
                            <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                                Flux marché: <strong style={{ color: 'var(--text-main)' }}>{String(marketDataContext.source || 'unknown')}</strong>
                                {' '}| acteur <strong style={{ color: 'var(--text-main)' }}>{String(marketDataContext.actor || 'UNKNOWN')}</strong>
                                {' '}| tier <strong style={{ color: 'var(--text-main)' }}>{String(marketDataContext.feedTier || 'L1_ONLY')}</strong>
                                {' '}| L1 age <strong style={{ color: 'var(--text-main)' }}>
                                    {Number.isFinite(Number(marketDataContext.l1?.tickAgeMs))
                                        ? `${Math.round(Number(marketDataContext.l1?.tickAgeMs || 0))}ms`
                                        : 'n/a'}
                                </strong>
                                {' '}| L2 depth <strong style={{ color: 'var(--text-main)' }}>
                                    {Math.round(Number(marketDataContext.l2?.depthLevels || 0))}
                                </strong>
                                {Array.isArray(marketDataContext.providerChain) && marketDataContext.providerChain.length > 0 && (
                                    <>
                                        {' '}| chaîne <strong style={{ color: 'var(--text-main)' }}>{marketDataContext.providerChain.join(' → ')}</strong>
                                    </>
                                )}
                            </div>
                        )}
                        {sessionContext && (
                            <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                                Sessions actives: <strong style={{ color: 'var(--text-main)' }}>
                                    {Array.isArray(sessionContext.activeSessions) && sessionContext.activeSessions.length > 0
                                        ? sessionContext.activeSessions.join(', ')
                                        : 'Aucune'}
                                </strong>
                                {' '}| Chevauchement:
                                {' '}
                                <strong style={{ color: 'var(--text-main)' }}>
                                    {sessionContext.overlaps?.londonNewYork
                                        ? 'Londres-New York'
                                        : sessionContext.overlaps?.sydneyTokyo
                                            ? 'Sydney-Tokyo'
                                            : 'Aucun'}
                                </strong>
                                {' '}| Vol {Math.round(Number(sessionContext.volatilityScore || 0))}/100
                                {' '}| Liq {Math.round(Number(sessionContext.liquidityScore || 0))}/100
                                {' '}| News {Math.round(Number(sessionContext.newsPublicationScore || 0))}/100
                            </div>
                        )}
                        {renderFilterChecklist('NEWS FILTER CHECKLIST', newsFilter, '#89d9ff')}
                        {renderFilterChecklist('ANTI-SPIKE CHECKLIST', openSpikeFilter, '#f6c84c')}
                        {renderFilterChecklist('DATA QUALITY GATE', dataQualityFilter, '#ff9f6e')}
                        {renderFilterChecklist('MACRO CALENDAR FILTER', macroCalendarFilter, '#d4b5ff')}
                        {renderFilterChecklist('USD FILTER CHECKLIST', usdFilter, '#7ee7d6')}
                        {renderFilterChecklist('MARKET DATA STACK FILTER', marketDataFilter, '#7dcfff')}
                        {renderFilterChecklist('TRADING SESSIONS FILTER', sessionFilter, '#5bc2ff')}
                        {Array.isArray(strategyData.reasons) && strategyData.reasons.length > 0 && (
                            <ul style={{ margin: '8px 0 0 16px', padding: 0, fontSize: '11px', color: 'var(--text-secondary)' }}>
                                {strategyData.reasons.slice(0, 5).map((reason, idx) => (
                                    <li key={`${reason}-${idx}`}>{reason}</li>
                                ))}
                            </ul>
                        )}
                        {strategyData.geometry && (
                            <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                                Géométrie: pente {Number(strategyData.geometry.slopePctPerCandle || 0).toFixed(4)}%/bougie ·
                                cassure {strategyData.geometry.channelBreak || 'NONE'} ·
                                fib {strategyData.geometry.fibZone || 'n/a'} ·
                                pattern {strategyData.geometry.patternBias || 'HOLD'}
                            </div>
                        )}
                    </>
                ) : (
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {strategyMutation.isPending ? 'Calcul de la prediction...' : `Mode ${strategyLabel} en attente des données de marché.`}
                    </div>
                )}
            </div>

            <div style={{ border: '1px solid var(--border)', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '12px', marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.6px', color: 'var(--text-secondary)' }}>
                        BACKTEST AUTO {strategyLabel}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                        {backtestMutation.isPending ? 'calcul...' : (backtestData?.trades ? `${backtestData.trades} trades` : 'en attente')}
                    </div>
                </div>
                {backtestData?.success ? (
                    <>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginBottom: '8px' }}>
                            <div className="level-box entry">
                                <span className="level-label">WIN RATE</span>
                                <span className="level-value">{Number(backtestData.winRate || 0).toFixed(1)}%</span>
                            </div>
                            <div className="level-box tp">
                                <span className="level-label">EXPECTANCY</span>
                                <span className="level-value">{Number(backtestData.expectancyPct || 0).toFixed(3)}%</span>
                            </div>
                            <div className="level-box sl">
                                <span className="level-label">PF</span>
                                <span className="level-value">{Number(backtestData.profitFactor || 0).toFixed(2)}</span>
                            </div>
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                            Samples: <strong style={{ color: 'var(--text-main)' }}>{backtestData.evaluatedSamples || 0}</strong>
                            {' '}| Bloqués: <strong style={{ color: 'var(--text-main)' }}>{backtestData.blockedSignals || 0}</strong>
                            {' '}| Drawdown max: <strong style={{ color: 'var(--text-main)' }}>{Number(backtestData.maxDrawdownPct || 0).toFixed(2)}%</strong>
                            {' '}| Buy&Hold: <strong style={{ color: 'var(--text-main)' }}>{Number(backtestData.benchmarkBuyHoldPct || 0).toFixed(2)}%</strong>
                        </div>
                        <div style={{ marginTop: '4px', fontSize: '10px', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                            Blocages:
                            {' '}Signal {Math.round(Number(backtestData.blockedBySignal || 0))}
                            {' '}· Qualité {Math.round(Number(backtestData.blockedByQuality || 0))}
                            {' '}· Pattern {Math.round(Number(backtestData.blockedByPattern || 0))}
                            {' '}· Régime {Math.round(Number(backtestData.blockedByRegime || 0))}
                            {' '}· RR {Math.round(Number(backtestData.blockedByRiskReward || 0))}
                            {' '}· Edge {Math.round(Number(backtestData.blockedByEdge || 0))}
                            {' '}· Cooldown {Math.round(Number(backtestData.blockedByCooldown || 0))}
                        </div>
                        <div style={{ marginTop: '6px', fontSize: '10px', color: 'var(--text-secondary)' }}>
                            Seuils: rel&gt;={backtestData.thresholds?.minReliability ?? '-'}%,
                            checks&gt;={backtestData.thresholds?.minDirectionalChecks ?? '-'},
                            accord&gt;={backtestData.thresholds?.minAgreementPct ?? '-'}%,
                            conf&gt;={backtestData.thresholds?.minConfidence ?? '-'}%,
                            rr&gt;={backtestData.thresholds?.minRiskReward ?? '-'},
                            adx&gt;={backtestData.thresholds?.minAdx ?? '-'},
                            atr% {backtestData.thresholds?.minAtrPct ?? '-'}-{backtestData.thresholds?.maxAtrPct ?? '-'},
                            edge&gt;={backtestData.thresholds?.minEdgePct ?? '-'}%,
                            espace≥{backtestData.thresholds?.minSpacingBars ?? '-'} bougie,
                            cout≈{backtestData.thresholds?.roundTripCostBps ?? '-'}bps
                        </div>
                        {resultDistribution && resultDistribution.slices.length > 0 && (
                            <div style={{ marginTop: '10px', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
                                <div style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.5px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                    {resultDistribution.title} (%) · {resultDistribution.total} échantillons
                                </div>
                                <div className="backtest-distribution-grid" style={{ display: 'grid', gridTemplateColumns: '108px 1fr', gap: '10px', alignItems: 'center' }}>
                                    <div style={{ position: 'relative', width: '108px', height: '108px', margin: '0 auto' }}>
                                        <div
                                            style={{
                                                width: '108px',
                                                height: '108px',
                                                borderRadius: '50%',
                                                background: resultDonutGradient || 'rgba(148,163,184,0.15)',
                                                border: '1px solid var(--border)',
                                            }}
                                        />
                                        <div
                                            style={{
                                                position: 'absolute',
                                                inset: '22px',
                                                borderRadius: '50%',
                                                background: 'var(--bg-secondary)',
                                                border: '1px solid var(--border)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                fontSize: '11px',
                                                color: 'var(--text-secondary)',
                                                fontWeight: 800,
                                            }}
                                        >
                                            100%
                                        </div>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '5px' }}>
                                        {resultDistribution.slices.map((slice) => (
                                            <div key={slice.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)' }}>
                                                    <span style={{ width: '10px', height: '10px', borderRadius: '999px', background: slice.color }} />
                                                    {slice.label}
                                                </span>
                                                <span style={{ color: 'var(--text-main)', fontWeight: 800 }}>{slice.pct.toFixed(1)}%</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {backtestMutation.isPending
                            ? 'Backtest en cours sur les dernières données...'
                            : 'Backtest prêt dès que les snapshots d’indicateurs sont disponibles.'}
                    </div>
                )}
            </div>

            <style>{`
                @keyframes loaderMsg { 0% { left: -30%; } 100% { left: 100%; } }
                .ai-header {
                    padding: 16px;
                    border-radius: 8px;
                    text-align: center;
                    margin-bottom: 12px;
                    border: 1px solid var(--border);
                }
                .ai-header.buy { background: var(--buy-bg); border-color: var(--buy); color: var(--buy); }
                .ai-header.sell { background: var(--sell-bg); border-color: var(--sell); color: var(--sell); }
                .ai-header.neutral, .ai-header.hold { background: rgba(255,255,255,0.05); border-color: var(--gold); color: var(--gold); }
                
                .ai-action { font-size: 28px; font-weight: 900; letter-spacing: 2px; }
                .ai-badge { background: rgba(0,0,0,0.3); padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; }
                .ai-confidence { font-size: 11px; opacity: 0.8;}

                .trade-levels { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 16px; }
                .level-box { background: var(--bg-tertiary); padding: 10px; border-radius: 6px; text-align: center; border: 1px solid var(--border); }
                .level-label { display: block; font-size: 9px; font-weight: bold; color: var(--text-secondary); margin-bottom: 4px; }
                .level-value { font-family: var(--font-mono); font-weight: bold; font-size: 13px; }
                .level-box.tp .level-value { color: var(--buy); }
                .level-box.sl .level-value { color: var(--sell); }

                .ai-reasoning { background: var(--bg-tertiary); padding: 12px; border-radius: 8px; font-size: 12px; line-height: 1.5; color: var(--text-main); border-left: 3px solid var(--gold); }

                @media (max-width: 720px) {
                    .ai-selector {
                        display: grid !important;
                        grid-template-columns: repeat(3, minmax(0, 1fr));
                    }

                    .ai-action-grid {
                        grid-template-columns: 1fr !important;
                    }

                    .ai-mode-grid,
                    .ai-usd-grid {
                        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
                    }

                    .trade-levels,
                    .backtest-metrics-grid {
                        grid-template-columns: 1fr !important;
                    }

                    .backtest-distribution-grid {
                        grid-template-columns: 1fr !important;
                    }
                }

                @media (max-width: 460px) {
                    .ai-action {
                        font-size: 24px;
                    }

                    .level-value {
                        font-size: 12px;
                    }

                    .ai-reasoning {
                        font-size: 11px;
                        padding: 10px;
                    }
                }
            `}</style>
        </div>
    );
}
