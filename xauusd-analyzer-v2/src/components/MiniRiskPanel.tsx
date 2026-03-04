import React, { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMarketStore } from '../store/marketStore';

type MiniRiskPanelProps = {
    compact?: boolean;
};

const ACCOUNT_SIZE_USD = 75;
const DEFAULT_LOT = 0.01;
const DEFAULT_SPREAD_POINTS = 10;
const DEFAULT_SL_POINTS = 25;
const DEFAULT_TP_POINTS = 40;
const SYMBOL_DECIMALS: Record<string, number> = {
    'XAU/USD': 2,
    'XAG/USD': 3,
    'WTI/USD': 2,
    'EUR/USD': 5,
    'GBP/USD': 5,
    'USD/JPY': 3,
    'CHF/JPY': 3,
    'AUD/USD': 5,
    'BTC/USD': 2,
    'ETH/USD': 2,
    'SOL/USD': 2,
    'AAPL/USD': 2,
    'TSLA/USD': 2,
    'NVDA/USD': 2,
    'SPX500/USD': 2,
    'NAS100/USD': 2,
    'US30/USD': 2
};

const toNumber = (value: string, fallback: number) => {
    const parsed = Number.parseFloat(String(value).replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
};

const inferUsdPerPoint = (symbol: string, lotSize: number) => {
    const upper = symbol.toUpperCase();
    const baseForMicroLot =
        upper.includes('XAU') || upper.includes('XAG') || upper.includes('WTI')
            ? 0.1
            : upper.includes('JPY')
                ? 0.09
                : upper.includes('BTC') || upper.includes('ETH') || upper.includes('SOL')
                    ? 0.12
                    : 0.1;
    return baseForMicroLot * (lotSize / DEFAULT_LOT);
};

const formatMoney = (value: number) => `$${value.toFixed(2)}`;
const getDecimals = (symbol: string) => SYMBOL_DECIMALS[symbol] ?? 2;
const getPointSize = (symbol: string) => {
    const decimals = getDecimals(symbol);
    return Number((1 / Math.pow(10, decimals)).toFixed(Math.max(2, decimals + 1)));
};
const roundForSymbol = (symbol: string, value: number) => {
    const decimals = getDecimals(symbol);
    return Number(value.toFixed(decimals));
};

type Mt5BotsResponse = {
    success?: boolean;
    state?: {
        status?: 'RUNNING' | 'STOPPED';
        lastHeartbeatAt?: string | null;
    };
    bridge?: {
        online?: boolean;
        heartbeatOnline?: boolean;
        lastHeartbeatAt?: string | null;
        pendingCommands?: number;
        authFailures?: {
            total?: number;
        };
    };
    liveGuard?: {
        armed?: boolean;
        updatedAt?: string | null;
        reason?: string;
        changedBy?: string;
    };
};

type ManualOrderPayload = {
    symbol: string;
    side: 'BUY' | 'SELL';
    volume: number;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    confidence: number;
    sourceSignal: string;
    note: string;
};

const fetchMt5Runtime = async (): Promise<Mt5BotsResponse> => {
    const res = await fetch('/api/mt5/bots');
    if (!res.ok) throw new Error(`mt5 runtime fetch failed (${res.status})`);
    return res.json();
};

const postManualOrder = async (payload: ManualOrderPayload) => {
    const res = await fetch('/api/mt5/manual-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || data?.success === false) {
        throw new Error(String(data?.error || 'manual_order_failed'));
    }
    return data as {
        success: boolean;
        queued?: boolean;
        bridgeOnline?: boolean;
        botStatus?: string;
        command?: { commandId?: string };
    };
};

const postLiveGuard = async (armed: boolean) => {
    const res = await fetch('/api/mt5/live-guard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            armed,
            reason: armed ? 'armed_from_micro_simulator' : 'disarmed_from_micro_simulator',
            changedBy: 'micro-simulator'
        })
    });
    const data = await res.json();
    if (!res.ok || data?.success === false) {
        throw new Error(String(data?.error || 'live_guard_update_failed'));
    }
    return data as { success: boolean; liveGuard?: { armed?: boolean } };
};

export default function MiniRiskPanel({ compact = false }: MiniRiskPanelProps) {
    const currentSymbol = useMarketStore((state) => state.currentSymbol);
    const livePrice = useMarketStore((state) => state.prices[currentSymbol]);
    const priceMeta = useMarketStore((state) => state.priceMeta[currentSymbol]);

    const [lotInput, setLotInput] = useState(String(DEFAULT_LOT));
    const [spreadInput, setSpreadInput] = useState(String(DEFAULT_SPREAD_POINTS));
    const [slInput, setSlInput] = useState(String(DEFAULT_SL_POINTS));
    const [tpInput, setTpInput] = useState(String(DEFAULT_TP_POINTS));
    const [feedback, setFeedback] = useState('');

    const { data: mt5Runtime, refetch: refetchMt5Runtime } = useQuery({
        queryKey: ['mini-risk-mt5-runtime'],
        queryFn: fetchMt5Runtime,
        refetchInterval: 8000,
        staleTime: 4000
    });

    const model = useMemo(() => {
        const lot = Math.max(0.001, toNumber(lotInput, DEFAULT_LOT));
        const spreadPoints = Math.max(0, toNumber(spreadInput, DEFAULT_SPREAD_POINTS));
        const slPoints = Math.max(1, toNumber(slInput, DEFAULT_SL_POINTS));
        const tpPoints = Math.max(1, toNumber(tpInput, DEFAULT_TP_POINTS));
        const usdPerPoint = inferUsdPerPoint(currentSymbol, lot);

        const riskUsd = (slPoints + spreadPoints) * usdPerPoint;
        const rewardUsd = Math.max(0, tpPoints - spreadPoints) * usdPerPoint;
        const riskPct = (riskUsd / ACCOUNT_SIZE_USD) * 100;
        const rewardPct = (rewardUsd / ACCOUNT_SIZE_USD) * 100;
        const rr = riskUsd > 0 ? rewardUsd / riskUsd : 0;
        const twoPctRiskUsd = ACCOUNT_SIZE_USD * 0.02;
        const targetSl = Math.max(1, Math.floor((twoPctRiskUsd / usdPerPoint) - spreadPoints));

        return {
            lot,
            spreadPoints,
            slPoints,
            tpPoints,
            usdPerPoint,
            riskUsd,
            rewardUsd,
            riskPct,
            rewardPct,
            rr,
            targetSl
        };
    }, [currentSymbol, lotInput, spreadInput, slInput, tpInput]);

    const buildOrderPreview = useMemo(() => {
        const pointSize = getPointSize(currentSymbol);
        const spreadPx = model.spreadPoints * pointSize;
        const bid = typeof priceMeta?.bid === 'number' && priceMeta.bid > 0 ? priceMeta.bid : 0;
        const ask = typeof priceMeta?.ask === 'number' && priceMeta.ask > 0 ? priceMeta.ask : 0;
        const reference = livePrice && livePrice > 0 ? livePrice : 0;
        const fallbackEntryBuy = reference > 0 ? reference + spreadPx * 0.5 : 0;
        const fallbackEntrySell = reference > 0 ? reference - spreadPx * 0.5 : 0;
        const buyEntry = ask > 0 ? ask : fallbackEntryBuy;
        const sellEntry = bid > 0 ? bid : fallbackEntrySell;

        const buy = {
            entryPrice: roundForSymbol(currentSymbol, buyEntry),
            stopLoss: roundForSymbol(currentSymbol, buyEntry - (model.slPoints * pointSize)),
            takeProfit: roundForSymbol(currentSymbol, buyEntry + (model.tpPoints * pointSize))
        };
        const sell = {
            entryPrice: roundForSymbol(currentSymbol, sellEntry),
            stopLoss: roundForSymbol(currentSymbol, sellEntry + (model.slPoints * pointSize)),
            takeProfit: roundForSymbol(currentSymbol, sellEntry - (model.tpPoints * pointSize))
        };
        return { buy, sell };
    }, [currentSymbol, livePrice, model.slPoints, model.spreadPoints, model.tpPoints, priceMeta?.ask, priceMeta?.bid]);

    const manualOrderMutation = useMutation({
        mutationFn: postManualOrder,
        onSuccess: (data, payload) => {
            const cmdId = data.command?.commandId || 'queued';
            const bridgeState = data.bridgeOnline ? 'bridge online' : 'bridge offline';
            setFeedback(`Ordre ${payload.side} envoyé (${cmdId}, ${bridgeState})`);
            void refetchMt5Runtime();
        },
        onError: (err: any) => {
            setFeedback(`Échec ordre: ${String(err?.message || 'manual_order_failed')}`);
        }
    });
    const liveGuardMutation = useMutation({
        mutationFn: postLiveGuard,
        onSuccess: (data) => {
            const armedNow = data?.liveGuard?.armed !== false;
            setFeedback(armedNow ? 'Kill switch: ARMÉ' : 'Kill switch: DÉSARMÉ');
            void refetchMt5Runtime();
        },
        onError: (err: any) => {
            setFeedback(`Kill switch erreur: ${String(err?.message || 'update_failed')}`);
        }
    });

    const submitLiveOrder = (side: 'BUY' | 'SELL') => {
        const preview = side === 'BUY' ? buildOrderPreview.buy : buildOrderPreview.sell;
        if (!(preview.entryPrice > 0 && preview.stopLoss > 0 && preview.takeProfit > 0)) {
            setFeedback('Prix live indisponible, impossible d’envoyer ordre');
            return;
        }
        const confirmed = window.confirm(
            `Confirmer ordre réel MT5 ${side} ${currentSymbol} lot ${model.lot.toFixed(3)} ?`
        );
        if (!confirmed) return;
        manualOrderMutation.mutate({
            symbol: currentSymbol,
            side,
            volume: model.lot,
            entryPrice: preview.entryPrice,
            stopLoss: preview.stopLoss,
            takeProfit: preview.takeProfit,
            confidence: Math.max(55, Math.min(95, Math.round((model.rr * 20) + 50))),
            sourceSignal: 'micro-simulator-live',
            note: `micro-simulator:${side} lot=${model.lot.toFixed(3)} spreadPts=${model.spreadPoints}`
        });
    };

    const riskTone = model.riskPct <= 2 ? 'safe' : model.riskPct <= 4 ? 'warn' : 'high';
    const mt5Status = String(mt5Runtime?.state?.status || 'STOPPED');
    const mt5Online = !!mt5Runtime?.bridge?.online;
    const heartbeatOnline = mt5Runtime?.bridge?.heartbeatOnline === true;
    const uiBridgeStatus = heartbeatOnline ? 'ONLINE' : mt5Status === 'RUNNING' ? 'CONNECTING' : (mt5Online ? 'ONLINE' : 'OFFLINE');
    const uiBridgeColor = heartbeatOnline || mt5Online ? 'var(--buy)' : mt5Status === 'RUNNING' ? 'var(--gold)' : 'var(--sell)';
    const pendingCommands = Math.max(0, Number(mt5Runtime?.bridge?.pendingCommands || 0));
    const authFailures = Math.max(0, Number(mt5Runtime?.bridge?.authFailures?.total || 0));
    const heartbeatLabel = mt5Runtime?.bridge?.lastHeartbeatAt
        ? new Date(String(mt5Runtime.bridge.lastHeartbeatAt)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : '—';
    const liveGuardArmed = mt5Runtime?.liveGuard?.armed !== false;
    const orderDisabled = manualOrderMutation.isPending || !(livePrice && livePrice > 0) || !liveGuardArmed;

    const toggleLiveGuard = (nextArmed: boolean) => {
        if (liveGuardMutation.isPending) return;
        const prompt = nextArmed
            ? 'Armer le trading live MT5 ?'
            : 'Désarmer le trading live MT5 ? (aucun ordre ne partira)';
        if (!window.confirm(prompt)) return;
        liveGuardMutation.mutate(nextArmed);
    };

    return (
        <div className={`mini-risk-panel ${compact ? 'compact' : ''}`}>
            <div className="mini-risk-topline">
                <div className="mini-risk-chip">
                    <span>Capital</span>
                    <strong>{formatMoney(ACCOUNT_SIZE_USD)}</strong>
                </div>
                <div className="mini-risk-chip">
                    <span>Symbol</span>
                    <strong>{currentSymbol}</strong>
                </div>
                <div className="mini-risk-chip">
                    <span>Prix</span>
                    <strong>{livePrice ? livePrice.toFixed(2) : '—'}</strong>
                </div>
            </div>

            <div className="mini-risk-controls">
                <label>
                    Lot
                    <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={lotInput}
                        onChange={(event) => setLotInput(event.target.value)}
                    />
                </label>
                <label>
                    Spread
                    <input
                        type="number"
                        min="0"
                        step="1"
                        value={spreadInput}
                        onChange={(event) => setSpreadInput(event.target.value)}
                    />
                </label>
                <label>
                    SL pts
                    <input
                        type="number"
                        min="1"
                        step="1"
                        value={slInput}
                        onChange={(event) => setSlInput(event.target.value)}
                    />
                </label>
                <label>
                    TP pts
                    <input
                        type="number"
                        min="1"
                        step="1"
                        value={tpInput}
                        onChange={(event) => setTpInput(event.target.value)}
                    />
                </label>
            </div>

            <div className="mini-risk-metrics">
                <div className={`mini-risk-metric ${riskTone}`}>
                    <span>Risk</span>
                    <strong>{formatMoney(model.riskUsd)}</strong>
                    <small>{model.riskPct.toFixed(2)}%</small>
                </div>
                <div className="mini-risk-metric good">
                    <span>Reward</span>
                    <strong>{formatMoney(model.rewardUsd)}</strong>
                    <small>{model.rewardPct.toFixed(2)}%</small>
                </div>
                <div className="mini-risk-metric">
                    <span>R:R</span>
                    <strong>{model.rr.toFixed(2)}</strong>
                    <small>${model.usdPerPoint.toFixed(2)}/pt</small>
                </div>
            </div>

            <div className="mini-risk-foot">
                <span>Objectif risque 2%</span>
                <strong>SL max ≈ {model.targetSl} pts</strong>
            </div>

            <div className="mini-risk-live">
                <div className="mini-risk-live-status">
                    <span>MT5</span>
                    <strong style={{ color: uiBridgeColor }}>
                        {uiBridgeStatus}
                    </strong>
                    <span className={`mini-risk-guard-pill ${liveGuardArmed ? 'armed' : 'disarmed'}`}>
                        {liveGuardArmed ? 'ARMÉ' : 'DÉSARMÉ'}
                    </span>
                    <small>{mt5Status} • HB {heartbeatLabel}</small>
                    <small>Queue {pendingCommands} • AuthErr {authFailures}</small>
                </div>
                <button
                    className={`mini-risk-guard-btn ${liveGuardArmed ? 'disarm' : 'arm'}`}
                    onClick={() => toggleLiveGuard(!liveGuardArmed)}
                    disabled={liveGuardMutation.isPending}
                >
                    {liveGuardMutation.isPending
                        ? 'SYNC...'
                        : liveGuardArmed
                            ? 'DÉSARMER LIVE'
                            : 'ARMER LIVE'}
                </button>
                <div className="mini-risk-actions">
                    <button
                        className="mini-risk-btn buy"
                        disabled={orderDisabled}
                        onClick={() => submitLiveOrder('BUY')}
                    >
                        BUY LIVE
                    </button>
                    <button
                        className="mini-risk-btn sell"
                        disabled={orderDisabled}
                        onClick={() => submitLiveOrder('SELL')}
                    >
                        SELL LIVE
                    </button>
                </div>
                {!heartbeatOnline && (
                    <div className="mini-risk-feedback" style={{ color: 'var(--gold)' }}>
                        MT5 bridge sans heartbeat récent. Vérifie l’EA `Ari_MT5_AutoExecutor` (WebRequest + token).
                    </div>
                )}
                {!!feedback && <div className="mini-risk-feedback">{feedback}</div>}
            </div>
        </div>
    );
}
