import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMarketStore } from '../store/marketStore';
import { calculateAllIndicators, Candle as IndicatorCandle } from '../utils/indicators';
import TradeActionCard from './TradeActionCard';
import { buildTradeVerdict } from '../utils/tradeVerdict';

type TradeSignal = 'BUY' | 'SELL' | 'HOLD';

type SuperalgosRepo = {
    id: string;
    label: string;
    role: string;
    roots: string[];
    notes: string[];
};

type PipelineNode = {
    id: string;
    name: string;
    status: 'READY' | 'WARMUP' | 'WAIT';
    detail: string;
    metric: string;
};

const HISTORY_SIZE = 360;

const SUPERALGOS_REPOS: SuperalgosRepo[] = [
    {
        id: 'sa-fork',
        label: 'Superalgos / SA',
        role: 'Fork mirror (upstream compatible)',
        roots: ['Platform', 'Projects', 'TaskServer', 'Social-Trading', 'Bitcoin-Factory', 'Dashboards'],
        notes: [
            'Good source to align AriAlgo workflows with Superalgos app structure.',
            'Useful when you need fork-specific changes while staying upstream friendly.'
        ]
    },
    {
        id: 'superalgos-main',
        label: 'Superalgos / Superalgos',
        role: 'Main upstream repository',
        roots: ['Platform', 'Network', 'Plugins', 'TaskServer', 'App-Management', 'Launch-Scripts'],
        notes: [
            'Reference architecture for setup, platform runtime, and plugin lifecycle.',
            'Primary baseline for feature parity and long-term compatibility.'
        ]
    }
];

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function formatNumber(value: number | null | undefined, decimals = 2) {
    if (!Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

function getSignalClass(signal: TradeSignal) {
    if (signal === 'BUY') return 'buy';
    if (signal === 'SELL') return 'sell';
    return 'hold';
}

async function fetchHistory(symbol: string, timeframe: string) {
    const url = `/api/history?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}&outputsize=${HISTORY_SIZE}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`History fetch failed (${response.status})`);
    const payload = await response.json();
    return Array.isArray(payload?.data) ? payload.data : [];
}

function normalizeCandles(rows: any[]): IndicatorCandle[] {
    const candles: IndicatorCandle[] = [];
    rows.forEach((row) => {
        const open = Number(row?.open);
        const high = Number(row?.high);
        const low = Number(row?.low);
        const close = Number(row?.close);
        const volume = Number(row?.volume) || 0;
        const directTime = Number(row?.time);
        const fallbackTs = Date.parse(String(row?.timestamp || ''));
        const time = Number.isFinite(directTime)
            ? (directTime > 1e12 ? directTime : directTime * 1000)
            : (Number.isFinite(fallbackTs) ? fallbackTs : Date.now());

        if (![open, high, low, close].every(Number.isFinite)) return;
        candles.push({ open, high, low, close, volume, time });
    });
    return candles;
}

function buildLiveModel(indicators: any, currentPrice: number) {
    const reasons: string[] = [];
    let score = 50;

    const ema21 = Number(indicators?.ema21);
    const ema50 = Number(indicators?.ema50);
    if (Number.isFinite(ema21) && Number.isFinite(ema50)) {
        if (ema21 > ema50) {
            score += 12;
            reasons.push('EMA21 > EMA50 (bull regime)');
        } else {
            score -= 12;
            reasons.push('EMA21 < EMA50 (bear regime)');
        }
    }

    const macdHistogram = Number(indicators?.macdHistogram);
    if (Number.isFinite(macdHistogram)) {
        if (macdHistogram > 0) {
            score += 10;
            reasons.push('MACD histogram positive');
        } else if (macdHistogram < 0) {
            score -= 10;
            reasons.push('MACD histogram negative');
        }
    }

    const rsi = Number(indicators?.rsi);
    if (Number.isFinite(rsi)) {
        if (rsi <= 30) {
            score += 8;
            reasons.push('RSI oversold area');
        } else if (rsi >= 70) {
            score -= 8;
            reasons.push('RSI overbought area');
        } else {
            reasons.push('RSI neutral band');
        }
    }

    const adx = Number(indicators?.adx?.adx);
    const plusDI = Number(indicators?.adx?.plusDI);
    const minusDI = Number(indicators?.adx?.minusDI);
    if ([adx, plusDI, minusDI].every(Number.isFinite)) {
        if (adx >= 20) {
            if (plusDI > minusDI) {
                score += 8;
                reasons.push('ADX trend confirmed (+DI leader)');
            } else if (plusDI < minusDI) {
                score -= 8;
                reasons.push('ADX trend confirmed (-DI leader)');
            }
        } else {
            reasons.push('ADX weak trend');
        }
    }

    score = clamp(Math.round(score), 0, 100);
    const signal: TradeSignal = score >= 60 ? 'BUY' : score <= 40 ? 'SELL' : 'HOLD';
    const confidence = clamp(Math.round(35 + Math.abs(score - 50) * 1.2), 35, 92);

    const atr = Number(indicators?.atr);
    const atrSafe = Number.isFinite(atr) && atr > 0 ? atr : Math.max(currentPrice * 0.003, 0.1);
    const entry = Number.isFinite(currentPrice) ? currentPrice : 0;

    const sl = signal === 'BUY'
        ? entry - atrSafe * 1.6
        : signal === 'SELL'
            ? entry + atrSafe * 1.6
            : entry - atrSafe * 1.2;

    const tp = signal === 'BUY'
        ? entry + atrSafe * 2.2
        : signal === 'SELL'
            ? entry - atrSafe * 2.2
            : entry + atrSafe * 1.4;

    return {
        signal,
        score,
        confidence,
        entry,
        sl,
        tp,
        atr: atrSafe,
        reasons: reasons.slice(0, 5)
    };
}

function buildPipeline(candlesCount: number, signal: TradeSignal, confidence: number, indicators: any): PipelineNode[] {
    const hasEnoughHistory = candlesCount >= 120;
    const adx = Number(indicators?.adx?.adx);
    const trendReady = Number.isFinite(adx) && adx >= 18;

    return [
        {
            id: 'data',
            name: 'Data Mining Layer',
            status: hasEnoughHistory ? 'READY' : 'WARMUP',
            detail: hasEnoughHistory ? 'OHLC stream stabilized' : 'Need more candles for robust state',
            metric: `${candlesCount} candles`
        },
        {
            id: 'feature',
            name: 'Feature Engineering',
            status: hasEnoughHistory ? 'READY' : 'WARMUP',
            detail: 'RSI / MACD / ATR / ADX / MA stack',
            metric: trendReady ? 'Trend model active' : 'Trend model warming'
        },
        {
            id: 'decision',
            name: 'Decision Node',
            status: signal === 'HOLD' ? 'WAIT' : 'READY',
            detail: signal === 'HOLD' ? 'No clean edge yet' : `${signal} plan generated`,
            metric: `${confidence}% confidence`
        },
        {
            id: 'execution',
            name: 'Execution Bridge',
            status: signal === 'HOLD' ? 'WAIT' : confidence >= 60 ? 'READY' : 'WARMUP',
            detail: 'Route to MT5 / broker bridge with risk rules',
            metric: confidence >= 60 ? 'Risk gate passed' : 'Risk gate pending'
        }
    ];
}

export default function SuperalgosHub() {
    const currentSymbol = useMarketStore((state) => state.currentSymbol);
    const currentTimeframe = useMarketStore((state) => state.currentTimeframe);
    const prices = useMarketStore((state) => state.prices);
    const orderbook = useMarketStore((state) => state.orderbook);

    const historyQuery = useQuery({
        queryKey: ['superalgos-hub-history', currentSymbol, currentTimeframe],
        queryFn: () => fetchHistory(currentSymbol, currentTimeframe),
        refetchInterval: 2500,
        staleTime: 1000,
        retry: 1
    });

    const candles = React.useMemo(
        () => normalizeCandles(Array.isArray(historyQuery.data) ? historyQuery.data : []),
        [historyQuery.data]
    );
    const indicators = React.useMemo(() => calculateAllIndicators(candles), [candles]);
    const livePrice = Number(prices[currentSymbol]);
    const currentPrice = Number.isFinite(livePrice) && livePrice > 0
        ? livePrice
        : Number(candles[candles.length - 1]?.close || 0);

    const liveModel = React.useMemo(
        () => buildLiveModel(indicators, currentPrice),
        [indicators, currentPrice]
    );
    const actionableVerdict = React.useMemo(() => {
        const pressureBias = orderbook && (!orderbook.symbol || orderbook.symbol === currentSymbol)
            ? ((Number(orderbook.ratio ?? 0.5) - 0.5) * 2)
            : 0;
        return buildTradeVerdict({
            currentPrice,
            signalHint: liveModel.signal,
            confidenceHint: liveModel.confidence,
            atr: liveModel.atr,
            trendBias: liveModel.score - 50,
            pressureBias,
            entryHint: liveModel.entry,
            stopLossHint: liveModel.sl,
            takeProfitHint: liveModel.tp,
            reasons: liveModel.reasons,
            timeframe: currentTimeframe
        });
    }, [currentPrice, currentSymbol, currentTimeframe, liveModel.atr, liveModel.confidence, liveModel.entry, liveModel.reasons, liveModel.score, liveModel.signal, liveModel.sl, liveModel.tp, orderbook]);
    const pipeline = React.useMemo(
        () => buildPipeline(candles.length, liveModel.signal, liveModel.confidence, indicators),
        [candles.length, liveModel.signal, liveModel.confidence, indicators]
    );

    return (
        <div className="superalgos-hub">
            <div className="superalgos-head">
                <div>
                    <h2>AriAlgo Superalgos Lab</h2>
                    <p>
                        Environnement d’intégration des architectures <strong>SA</strong> et <strong>Superalgos</strong> dans le moteur AriAlgo temps réel.
                    </p>
                </div>
                <div className={`superalgos-live-chip ${getSignalClass(liveModel.signal)}`}>
                    <span>Live Signal</span>
                    <strong>{liveModel.signal}</strong>
                </div>
            </div>

            <div className="superalgos-kpis">
                <div className="superalgos-kpi">
                    <span>Symbol / TF</span>
                    <strong>{currentSymbol} · {currentTimeframe}</strong>
                </div>
                <div className="superalgos-kpi">
                    <span>Current Price</span>
                    <strong>{formatNumber(currentPrice)}</strong>
                </div>
                <div className="superalgos-kpi">
                    <span>Model Score</span>
                    <strong>{liveModel.score}/100</strong>
                </div>
                <div className="superalgos-kpi">
                    <span>Confidence</span>
                    <strong>{liveModel.confidence}%</strong>
                </div>
                <div className="superalgos-kpi">
                    <span>Live Candles</span>
                    <strong>{candles.length}</strong>
                </div>
            </div>

            <TradeActionCard
                title="Actionable Trade Verdict"
                modelLabel="Superalgos Decision Node"
                symbol={currentSymbol}
                verdict={actionableVerdict}
            />

            <div className="superalgos-grid">
                <aside className="superalgos-panel">
                    <h3>Repo Mapping</h3>
                    <div className="superalgos-repo-list">
                        {SUPERALGOS_REPOS.map((repo) => (
                            <article key={repo.id} className="superalgos-repo-card">
                                <header>
                                    <strong>{repo.label}</strong>
                                    <span>{repo.role}</span>
                                </header>
                                <div className="superalgos-tags">
                                    {repo.roots.map((root) => (
                                        <span key={`${repo.id}-${root}`}>{root}</span>
                                    ))}
                                </div>
                                <ul>
                                    {repo.notes.map((note) => (
                                        <li key={`${repo.id}-${note}`}>{note}</li>
                                    ))}
                                </ul>
                            </article>
                        ))}
                    </div>

                    <h3>Runtime Commands</h3>
                    <div className="superalgos-command-card">
                        <pre>{`node setup
node setupPlugins <github-user> <token>
node platform`}</pre>
                        <p>Ces commandes sont présentées comme référence d’orchestration pour ce module.</p>
                    </div>
                </aside>

                <section className="superalgos-panel">
                    <h3>AriAlgo × Superalgos Pipeline</h3>
                    <div className="superalgos-pipeline">
                        {pipeline.map((node) => (
                            <article key={node.id} className={`superalgos-node ${node.status.toLowerCase()}`}>
                                <div className="superalgos-node-head">
                                    <strong>{node.name}</strong>
                                    <span>{node.status}</span>
                                </div>
                                <p>{node.detail}</p>
                                <small>{node.metric}</small>
                            </article>
                        ))}
                    </div>

                    <h3>Signal Narrative</h3>
                    <div className={`superalgos-signal-card ${getSignalClass(liveModel.signal)}`}>
                        <div className="superalgos-signal-head">
                            <strong>{liveModel.signal}</strong>
                            <span>{liveModel.confidence}% confidence</span>
                        </div>
                        <div className="superalgos-signal-levels">
                            <div>
                                <span>Entry</span>
                                <strong>{formatNumber(liveModel.entry)}</strong>
                            </div>
                            <div>
                                <span>Stop Loss</span>
                                <strong>{formatNumber(liveModel.sl)}</strong>
                            </div>
                            <div>
                                <span>Take Profit</span>
                                <strong>{formatNumber(liveModel.tp)}</strong>
                            </div>
                            <div>
                                <span>ATR</span>
                                <strong>{formatNumber(liveModel.atr, 4)}</strong>
                            </div>
                        </div>
                        <ul>
                            {liveModel.reasons.map((reason) => (
                                <li key={reason}>{reason}</li>
                            ))}
                        </ul>
                        {historyQuery.isFetching && <small>Refreshing live candles...</small>}
                        {historyQuery.isError && <small>Live history feed unavailable now.</small>}
                    </div>
                </section>
            </div>
        </div>
    );
}
