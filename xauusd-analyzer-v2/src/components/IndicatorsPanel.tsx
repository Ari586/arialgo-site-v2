import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMarketStore } from '../store/marketStore';
import { calculateAllIndicators } from '../utils/indicators';
import { formatSymbolPrice } from '../utils/priceFormat';

const fetchHistory = async (symbol: string, timeframe: string) => {
    const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}&outputsize=1000`);
    const data = await res.json();
    return data.data || [];
};

type IndicatorCard = {
    label: string;
    value: string;
    signal: string;
    color: string;
    fill: number;
};

type FocusCard = {
    title: string;
    audience: string;
    liveLabel: string;
    liveValue: string;
    color: string;
    fill: number;
};

type PanelSettings = {
    rsiPeriod: number;
    bollingerStdDev: number;
    supertrendAtrPeriod: number;
    supertrendMultiplier: number;
};

type SettingsPreset = {
    id: 'scalp' | 'intraday' | 'swing';
    label: string;
    description: string;
    settings: PanelSettings;
};

type IndicatorDeskMode = 'compact' | 'full';
type IndicatorSectionKey = 'momentum' | 'trend' | 'volatility' | 'volume' | 'structure';
type IndicatorSectionMeta = {
    key: IndicatorSectionKey;
    title: string;
    description: string;
    accent: string;
};

const SETTINGS_STORAGE_KEY = 'ari_indicator_panel_settings_v1';
const INDICATOR_DESK_MODE_KEY = 'ari_indicator_desk_mode_v1';

const DEFAULT_SETTINGS: PanelSettings = {
    rsiPeriod: 14,
    bollingerStdDev: 2,
    supertrendAtrPeriod: 10,
    supertrendMultiplier: 3,
};

const SETTINGS_PRESETS: SettingsPreset[] = [
    {
        id: 'scalp',
        label: 'Scalp',
        description: 'More reactive for fast entries',
        settings: {
            rsiPeriod: 9,
            bollingerStdDev: 1.6,
            supertrendAtrPeriod: 7,
            supertrendMultiplier: 2.2,
        }
    },
    {
        id: 'intraday',
        label: 'Intraday',
        description: 'Balanced default profile',
        settings: { ...DEFAULT_SETTINGS }
    },
    {
        id: 'swing',
        label: 'Swing',
        description: 'Less noise, stronger confirmation',
        settings: {
            rsiPeriod: 21,
            bollingerStdDev: 2.4,
            supertrendAtrPeriod: 14,
            supertrendMultiplier: 4,
        }
    }
];

const INDICATOR_SECTIONS: IndicatorSectionMeta[] = [
    { key: 'momentum', title: 'Momentum Suite', description: 'RSI, MACD, oscillators and divergences', accent: '#f59e0b' },
    { key: 'trend', title: 'Trend Engine', description: 'EMA, Supertrend, Ichimoku and MTF confluence', accent: '#22c55e' },
    { key: 'volatility', title: 'Volatility Lab', description: 'ATR, Bollinger and squeeze behavior', accent: '#8b5cf6' },
    { key: 'volume', title: 'Volume Pressure', description: 'OBV, CVD and profile pressure zones', accent: '#06b6d4' },
    { key: 'structure', title: 'Market Structure', description: 'VWAP fairness and Fibonacci positioning', accent: '#ef4444' },
];

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function toFinite(value: unknown, fallback: number) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function normalizeSettings(input: Partial<PanelSettings> | null | undefined): PanelSettings {
    const rsiRaw = toFinite(input?.rsiPeriod, DEFAULT_SETTINGS.rsiPeriod);
    const bbRaw = toFinite(input?.bollingerStdDev, DEFAULT_SETTINGS.bollingerStdDev);
    const stAtrRaw = toFinite(input?.supertrendAtrPeriod, DEFAULT_SETTINGS.supertrendAtrPeriod);
    const stMulRaw = toFinite(input?.supertrendMultiplier, DEFAULT_SETTINGS.supertrendMultiplier);

    return {
        rsiPeriod: clamp(Math.round(rsiRaw), 5, 50),
        bollingerStdDev: parseFloat(clamp(bbRaw, 1, 4).toFixed(1)),
        supertrendAtrPeriod: clamp(Math.round(stAtrRaw), 5, 60),
        supertrendMultiplier: parseFloat(clamp(stMulRaw, 1, 10).toFixed(1)),
    };
}

function loadPanelSettings(): PanelSettings {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS;
    try {
        const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!raw) return DEFAULT_SETTINGS;
        const parsed = JSON.parse(raw) as Partial<PanelSettings>;
        return normalizeSettings(parsed);
    } catch {
        return DEFAULT_SETTINGS;
    }
}

function isPresetActive(current: PanelSettings, preset: PanelSettings) {
    return current.rsiPeriod === preset.rsiPeriod
        && current.bollingerStdDev === preset.bollingerStdDev
        && current.supertrendAtrPeriod === preset.supertrendAtrPeriod
        && current.supertrendMultiplier === preset.supertrendMultiplier;
}

function loadDeskMode(): IndicatorDeskMode {
    if (typeof window === 'undefined') return 'compact';
    try {
        const saved = String(window.localStorage.getItem(INDICATOR_DESK_MODE_KEY) || '').toLowerCase();
        return saved === 'full' ? 'full' : 'compact';
    } catch {
        return 'compact';
    }
}

function resolveSectionKey(label: string): IndicatorSectionKey {
    const normalized = String(label || '').toLowerCase();
    if (normalized.includes('rsi') || normalized.includes('macd') || normalized.includes('stochastic') || normalized.includes('williams') || normalized.includes('cci') || normalized.includes('mfi') || normalized.includes('adx')) {
        return 'momentum';
    }
    if (normalized.includes('ema') || normalized.includes('supertrend') || normalized.includes('ichimoku') || normalized.includes('mtf confluence')) {
        return 'trend';
    }
    if (normalized.includes('bollinger') || normalized.includes('atr') || normalized.includes('bb squeeze')) {
        return 'volatility';
    }
    if (normalized.includes('obv') || normalized.includes('cvd') || normalized.includes('volume profile')) {
        return 'volume';
    }
    return 'structure';
}

export default function IndicatorsPanel() {
    const currentSymbol = useMarketStore(state => state.currentSymbol);
    const currentTimeframe = useMarketStore(state => state.currentTimeframe);
    const livePrice = useMarketStore(state => state.prices[currentSymbol]);
    const [panelSettings, setPanelSettings] = useState<PanelSettings>(() => loadPanelSettings());
    const [deskMode, setDeskMode] = useState<IndicatorDeskMode>(() => loadDeskMode());
    const [openSection, setOpenSection] = useState<IndicatorSectionKey>('trend');
    const [showParameters, setShowParameters] = useState(false);
    const [showPlaybook, setShowPlaybook] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(panelSettings));
        } catch {
            // Ignore localStorage failures.
        }
    }, [panelSettings]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(INDICATOR_DESK_MODE_KEY, deskMode);
        } catch {
            // Ignore localStorage failures.
        }
    }, [deskMode]);

    const { data: history } = useQuery({
        queryKey: ['history', currentSymbol, currentTimeframe],
        queryFn: () => fetchHistory(currentSymbol, currentTimeframe),
        staleTime: 60000,
    });

    const indicators = useMemo(() => {
        if (!history || history.length < 30) return null;
        const candles = [...history];
        if (livePrice) {
            const last = { ...candles[candles.length - 1] };
            last.close = livePrice;
            last.high = Math.max(last.high, livePrice);
            last.low = Math.min(last.low, livePrice);
            candles[candles.length - 1] = last;
        }
        return calculateAllIndicators(candles, panelSettings);
    }, [history, livePrice, panelSettings]);

    if (!indicators) {
        return <div className="p-4" style={{ color: 'var(--text-secondary)' }}>Calcul des indicateurs...</div>;
    }

    const {
        rsi, macdLine, macdSignal,
        ema9, ema21, ema50, ema200, bbUpper, bbLower,
        atr, stochastic, adx, williamsR, cci, mfi, vwap,
        ichimoku, supertrend, rsiDivergence, stochRsi, obv, cvd, volumeProfile, bbSqueeze, fibonacci, mtfConfluence
    } = indicators;

    const effectivePrice = typeof livePrice === 'number' && livePrice > 0
        ? livePrice
        : (history?.[history.length - 1]?.close || 0);

    const formatPx = (value?: number | null, allowNegative = false) =>
        formatSymbolPrice(currentSymbol, value, { allowNegative, allowZero: false });

    const fibNearestPriceText = typeof fibonacci?.nearestPrice === 'number'
        ? formatPx(fibonacci.nearestPrice)
        : 'n/a';

    const rsiSignal = (rsi && rsi > 70) ? 'OVERBOUGHT' : (rsi && rsi < 30) ? 'OVERSOLD' : 'NEUTRAL';
    const macdSignalText = (macdLine !== null && macdSignal !== null)
        ? (macdLine > macdSignal ? 'BULLISH MOMENTUM' : 'BEARISH MOMENTUM')
        : 'NEUTRAL';
    const vwapSignal = (vwap !== null)
        ? (effectivePrice > vwap ? 'ABOVE FAIR VALUE' : 'BELOW FAIR VALUE')
        : 'NEUTRAL';
    const bbSignal = (bbUpper !== null && bbLower !== null)
        ? (effectivePrice > bbUpper ? 'VOLATILITY EXPANSION UP' : effectivePrice < bbLower ? 'VOLATILITY EXPANSION DOWN' : 'MEAN-REVERSION ZONE')
        : 'NEUTRAL';
    const stSignal = supertrend?.signal || 'NEUTRAL';
    const fibSignal = fibonacci
        ? `${fibonacci.trend}${fibonacci.inGoldenPocket ? ' | GOLDEN POCKET' : ''}`
        : 'NEUTRAL';

    const focusCards: FocusCard[] = [
        {
            title: 'RSI Indicators',
            audience: 'for traders who want clear overbought or oversold signals and momentum-based reversal entries.',
            liveLabel: 'Live',
            liveValue: `${rsi?.toFixed(2) || '---'} · ${rsiSignal} · p${panelSettings.rsiPeriod}`,
            color: rsiSignal === 'OVERBOUGHT' ? 'var(--sell)' : rsiSignal === 'OVERSOLD' ? 'var(--buy)' : 'var(--text-main)',
            fill: rsi || 50,
        },
        {
            title: 'VWAP Indicators',
            audience: 'for intraday traders who trade around fair value and session bias.',
            liveLabel: 'Live',
            liveValue: `${vwap !== null ? formatPx(vwap) : '---'} · ${vwapSignal}`,
            color: vwap !== null ? (effectivePrice > vwap ? 'var(--buy)' : 'var(--sell)') : 'var(--text-secondary)',
            fill: vwap !== null ? (effectivePrice > vwap ? 74 : 26) : 50,
        },
        {
            title: 'MACD Indicators',
            audience: 'for traders who confirm trend direction and time entries using momentum strength.',
            liveLabel: 'Live',
            liveValue: (macdLine !== null && macdSignal !== null)
                ? `${formatPx(macdLine, true)} / ${formatPx(macdSignal, true)} · ${macdSignalText}`
                : '---',
            color: (macdLine !== null && macdSignal !== null)
                ? (macdLine > macdSignal ? 'var(--buy)' : 'var(--sell)')
                : 'var(--text-secondary)',
            fill: (macdLine !== null && macdSignal !== null) ? (macdLine > macdSignal ? 72 : 28) : 50,
        },
        {
            title: 'Bollinger Bands Indicators',
            audience: 'for traders focused on volatility expansion, squeezes, and mean reversion setups.',
            liveLabel: 'Live',
            liveValue: (bbLower !== null && bbUpper !== null)
                ? `${formatPx(bbLower)} - ${formatPx(bbUpper)} · ${bbSignal} · σ${panelSettings.bollingerStdDev.toFixed(1)}`
                : '---',
            color: (bbLower !== null && bbUpper !== null)
                ? (effectivePrice > bbUpper ? 'var(--sell)' : effectivePrice < bbLower ? 'var(--buy)' : 'var(--gold)')
                : 'var(--text-secondary)',
            fill: (bbUpper !== null && bbLower !== null && bbUpper !== bbLower)
                ? ((effectivePrice - bbLower) / (bbUpper - bbLower)) * 100
                : 50,
        },
        {
            title: 'Supertrend Indicators',
            audience: 'for trend-followers who want simple visual direction and dynamic trailing stop logic.',
            liveLabel: 'Live',
            liveValue: supertrend
                ? `${formatPx(supertrend.value)} · ${stSignal} (${supertrend.direction}) · ATR ${panelSettings.supertrendAtrPeriod}×${panelSettings.supertrendMultiplier.toFixed(1)}`
                : '---',
            color: stSignal === 'BUY' ? 'var(--buy)' : stSignal === 'SELL' ? 'var(--sell)' : 'var(--text-secondary)',
            fill: stSignal === 'BUY' ? 76 : stSignal === 'SELL' ? 24 : 50,
        },
        {
            title: 'Fibonacci Indicators',
            audience: 'for traders planning pullbacks, targets, and structured risk placement using retracement levels.',
            liveLabel: 'Live',
            liveValue: fibonacci
                ? `${fibonacci.nearestLevel || 'n/a'} @ ${fibNearestPriceText} · ${fibSignal}`
                : '---',
            color: fibonacci?.trend === 'UP' ? 'var(--buy)' : fibonacci?.trend === 'DOWN' ? 'var(--sell)' : 'var(--text-secondary)',
            fill: fibonacci?.trend === 'UP' ? 70 : fibonacci?.trend === 'DOWN' ? 30 : 50,
        },
    ];

    const indItems: IndicatorCard[] = [
        { label: `RSI (${panelSettings.rsiPeriod})`, value: rsi?.toFixed(2) || '---', signal: (rsi && rsi > 70) ? 'SURACHAT' : (rsi && rsi < 30) ? 'SURVENTE' : 'NEUTRE', color: (rsi && rsi > 70) ? 'var(--sell)' : (rsi && rsi < 30) ? 'var(--buy)' : 'var(--text-main)', fill: rsi || 50 },
        { label: 'MACD', value: (macdLine !== null && macdSignal !== null) ? `${formatPx(macdLine, true)} | ${formatPx(macdSignal, true)}` : '---', signal: (macdLine !== null && macdSignal !== null) ? (macdLine > macdSignal ? 'ACHAT' : 'VENTE') : 'NEUTRE', color: (macdLine !== null && macdSignal !== null) ? (macdLine > macdSignal ? 'var(--buy)' : 'var(--sell)') : 'var(--text-secondary)', fill: (macdLine !== null && macdSignal !== null) ? (macdLine > macdSignal ? 70 : 30) : 50 },
        { label: 'EMA 9 / 21', value: (ema9 !== null && ema21 !== null) ? `${formatPx(ema9)} / ${formatPx(ema21)}` : '---', signal: (ema9 !== null && ema21 !== null) ? (ema9 > ema21 ? 'ACHAT' : 'VENTE') : 'NEUTRE', color: (ema9 !== null && ema21 !== null) ? (ema9 > ema21 ? 'var(--buy)' : 'var(--sell)') : 'var(--text-secondary)', fill: (ema9 !== null && ema21 !== null) ? (ema9 > ema21 ? 75 : 25) : 50 },
        { label: 'EMA 50 / 200', value: (ema50 !== null && ema200 !== null) ? `${formatPx(ema50)} / ${formatPx(ema200)}` : '---', signal: (ema50 !== null && ema200 !== null) ? (ema50 > ema200 ? 'ACHAT' : 'VENTE') : 'NEUTRE', color: (ema50 !== null && ema200 !== null) ? (ema50 > ema200 ? 'var(--buy)' : 'var(--sell)') : 'var(--text-secondary)', fill: (ema50 !== null && ema200 !== null) ? (ema50 > ema200 ? 80 : 20) : 50 },
        { label: `Bollinger (σ ${panelSettings.bollingerStdDev.toFixed(1)})`, value: (bbLower !== null && bbUpper !== null) ? `${formatPx(bbLower)} - ${formatPx(bbUpper)}` : '---', signal: (bbUpper !== null && bbLower !== null) ? (effectivePrice > bbUpper ? 'SURACHAT' : effectivePrice < bbLower ? 'SURVENTE' : 'NEUTRE') : 'NEUTRE', color: (bbUpper !== null && bbLower !== null) ? (effectivePrice > bbUpper ? 'var(--sell)' : effectivePrice < bbLower ? 'var(--buy)' : 'var(--text-main)') : 'var(--text-secondary)', fill: (bbUpper !== null && bbLower !== null && bbUpper !== bbLower) ? ((effectivePrice - bbLower) / (bbUpper - bbLower)) * 100 : 50 },
        { label: 'ATR (14)', value: atr !== null ? formatPx(atr) : '---', signal: 'VOLATILITE', color: 'var(--gold)', fill: atr ? Math.min((atr / Math.max(effectivePrice, 1)) * 5500, 100) : 50 },
        { label: 'Stochastic', value: stochastic?.k?.toFixed(2) || '---', signal: (stochastic?.k !== undefined) ? (stochastic.k > 80 ? 'SURACHAT' : stochastic.k < 20 ? 'SURVENTE' : 'NEUTRE') : 'NEUTRE', color: (stochastic?.k !== undefined) ? (stochastic.k > 80 ? 'var(--sell)' : stochastic.k < 20 ? 'var(--buy)' : 'var(--text-main)') : 'var(--text-secondary)', fill: stochastic?.k || 50 },
        { label: 'ADX', value: adx?.adx?.toFixed(2) || '---', signal: adx?.trendStrength || 'NEUTRE', color: (adx?.adx !== undefined && adx.adx > 25) ? 'var(--buy)' : 'var(--text-secondary)', fill: adx?.adx || 0 },
        { label: 'Williams %R', value: williamsR?.toFixed(2) || '---', signal: (williamsR !== null) ? (williamsR > -20 ? 'SURACHAT' : williamsR < -80 ? 'SURVENTE' : 'NEUTRE') : 'NEUTRE', color: (williamsR !== null) ? (williamsR > -20 ? 'var(--sell)' : williamsR < -80 ? 'var(--buy)' : 'var(--text-main)') : 'var(--text-secondary)', fill: 100 + (williamsR || -50) },
        { label: 'CCI (20)', value: cci?.toFixed(2) || '---', signal: (cci !== null) ? (cci > 100 ? 'SURACHAT' : cci < -100 ? 'SURVENTE' : 'NEUTRE') : 'NEUTRE', color: (cci !== null) ? (cci > 100 ? 'var(--sell)' : cci < -100 ? 'var(--buy)' : 'var(--text-main)') : 'var(--text-secondary)', fill: cci ? Math.min(Math.max((cci + 200) / 4, 0), 100) : 50 },
        { label: 'MFI (14)', value: mfi?.toFixed(2) || '---', signal: (mfi !== null) ? (mfi > 80 ? 'SURACHAT' : mfi < 20 ? 'SURVENTE' : 'NEUTRE') : 'NEUTRE', color: (mfi !== null) ? (mfi > 80 ? 'var(--sell)' : mfi < 20 ? 'var(--buy)' : 'var(--text-main)') : 'var(--text-secondary)', fill: mfi || 50 },
        { label: 'VWAP', value: vwap !== null ? formatPx(vwap) : '---', signal: (vwap !== null) ? (effectivePrice > vwap ? 'HAUSSIER' : 'BAISSIER') : 'NEUTRE', color: (vwap !== null) ? (effectivePrice > vwap ? 'var(--buy)' : 'var(--sell)') : 'var(--text-secondary)', fill: (vwap !== null && effectivePrice > vwap) ? 75 : 25 },
        { label: `Supertrend (ATR ${panelSettings.supertrendAtrPeriod} × ${panelSettings.supertrendMultiplier.toFixed(1)})`, value: supertrend ? `${formatPx(supertrend.value)} (${supertrend.direction})` : '---', signal: supertrend?.signal || 'NEUTRE', color: supertrend?.signal === 'BUY' ? 'var(--buy)' : supertrend?.signal === 'SELL' ? 'var(--sell)' : 'var(--text-secondary)', fill: supertrend?.signal === 'BUY' ? 74 : supertrend?.signal === 'SELL' ? 26 : 50 },
        { label: 'Ichimoku', value: ichimoku ? `${formatPx(ichimoku.tenkan)} / ${formatPx(ichimoku.kijun)}` : '---', signal: ichimoku?.signal || 'NEUTRE', color: ichimoku?.signal === 'BULLISH' ? 'var(--buy)' : ichimoku?.signal === 'BEARISH' ? 'var(--sell)' : 'var(--gold)', fill: ichimoku?.strength || 50 },
        { label: 'RSI Divergence', value: rsiDivergence?.signal || 'NONE', signal: rsiDivergence?.details || 'Aucune divergence', color: rsiDivergence?.signal === 'BULLISH' ? 'var(--buy)' : rsiDivergence?.signal === 'BEARISH' ? 'var(--sell)' : 'var(--text-secondary)', fill: rsiDivergence?.signal === 'BULLISH' ? (50 + (rsiDivergence?.strength || 0) / 2) : rsiDivergence?.signal === 'BEARISH' ? (50 - (rsiDivergence?.strength || 0) / 2) : 50 },
        { label: 'Stoch RSI', value: stochRsi ? `${stochRsi.k.toFixed(2)} / ${stochRsi.d.toFixed(2)}` : '---', signal: stochRsi?.signal || 'NEUTRE', color: stochRsi?.signal === 'BULLISH' || stochRsi?.signal === 'OVERSOLD' ? 'var(--buy)' : stochRsi?.signal === 'BEARISH' || stochRsi?.signal === 'OVERBOUGHT' ? 'var(--sell)' : 'var(--text-secondary)', fill: stochRsi?.k || 50 },
        { label: 'OBV', value: obv ? obv.value.toLocaleString() : '---', signal: obv?.trend || 'FLAT', color: obv?.trend === 'UP' ? 'var(--buy)' : obv?.trend === 'DOWN' ? 'var(--sell)' : 'var(--text-secondary)', fill: obv ? Math.max(0, Math.min(100, 50 + obv.slope)) : 50 },
        { label: 'CVD', value: cvd ? cvd.value.toLocaleString() : '---', signal: cvd?.trend || 'FLAT', color: cvd?.trend === 'UP' ? 'var(--buy)' : cvd?.trend === 'DOWN' ? 'var(--sell)' : 'var(--text-secondary)', fill: cvd ? Math.max(0, Math.min(100, 50 + cvd.slope)) : 50 },
        { label: 'Volume Profile', value: volumeProfile ? `POC ${formatPx(volumeProfile.poc)}` : '---', signal: volumeProfile?.skew || 'NEUTRE', color: volumeProfile?.skew === 'BUY' ? 'var(--buy)' : volumeProfile?.skew === 'SELL' ? 'var(--sell)' : 'var(--text-secondary)', fill: volumeProfile?.abovePoc ? 65 : 35 },
        { label: 'BB Squeeze', value: bbSqueeze ? `${bbSqueeze.state} (${bbSqueeze.intensity.toFixed(1)}%)` : '---', signal: bbSqueeze?.isSqueezing ? 'COMPRESSION' : 'EXPANSION', color: bbSqueeze?.isSqueezing ? 'var(--gold)' : 'var(--text-main)', fill: bbSqueeze?.isSqueezing ? 20 : 70 },
        { label: 'Fibonacci', value: fibonacci ? `${fibonacci.nearestLevel || 'n/a'} @ ${fibNearestPriceText}` : '---', signal: fibonacci ? `${fibonacci.trend}${fibonacci.inGoldenPocket ? ' | GP' : ''}` : 'NEUTRE', color: fibonacci?.trend === 'UP' ? 'var(--buy)' : fibonacci?.trend === 'DOWN' ? 'var(--sell)' : 'var(--text-secondary)', fill: fibonacci?.trend === 'UP' ? 70 : fibonacci?.trend === 'DOWN' ? 30 : 50 },
        { label: 'MTF Confluence', value: mtfConfluence ? `${mtfConfluence.signal} ${mtfConfluence.strength}%` : '---', signal: mtfConfluence ? `${mtfConfluence.bullish}/${mtfConfluence.bearish}/${mtfConfluence.neutral}` : 'n/a', color: mtfConfluence?.signal === 'BUY' ? 'var(--buy)' : mtfConfluence?.signal === 'SELL' ? 'var(--sell)' : 'var(--gold)', fill: mtfConfluence ? (mtfConfluence.signal === 'SELL' ? 100 - mtfConfluence.strength : mtfConfluence.strength) : 50 },
    ];

    const updateSetting = <K extends keyof PanelSettings>(key: K, value: number) => {
        setPanelSettings(prev => normalizeSettings({ ...prev, [key]: value }));
    };

    const activePreset = SETTINGS_PRESETS.find((preset) => isPresetActive(panelSettings, preset.settings))?.id ?? null;

    const signalCounts = (() => {
        let bullish = 0;
        let bearish = 0;
        let neutral = 0;

        indItems.forEach((item) => {
            const signal = String(item.signal || '').toUpperCase();
            if (/(ACHAT|BUY|BULL|HAUSSIER|OVERSOLD|SURVENTE|UP)/.test(signal)) {
                bullish += 1;
                return;
            }
            if (/(VENTE|SELL|BEAR|BAISSIER|OVERBOUGHT|SURACHAT|DOWN)/.test(signal)) {
                bearish += 1;
                return;
            }
            neutral += 1;
        });

        return { bullish, bearish, neutral };
    })();

    const groupedSections = (() => {
        const sectionBuckets: Record<IndicatorSectionKey, IndicatorCard[]> = {
            momentum: [],
            trend: [],
            volatility: [],
            volume: [],
            structure: [],
        };

        indItems.forEach((item) => {
            sectionBuckets[resolveSectionKey(item.label)].push(item);
        });

        return INDICATOR_SECTIONS.map((meta) => ({
            ...meta,
            items: sectionBuckets[meta.key],
        }));
    })();

    const renderIndicatorCard = (ind: IndicatorCard) => (
        <div key={ind.label} style={{
            background: 'var(--bg-tertiary)',
            padding: '10px',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '6px'
        }}>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 700 }}>{ind.label}</div>
            <div style={{ fontSize: '14px', fontFamily: 'var(--font-mono)', fontWeight: 'bold', color: ind.color }}>{ind.value}</div>
            <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(0, Math.min(100, ind.fill))}%`, height: '100%', background: ind.color, transition: 'width 0.3s ease' }} />
            </div>
            <div style={{ fontSize: '9px', fontWeight: 800, letterSpacing: '0.5px', color: ind.color, background: 'rgba(255,255,255,0.05)', display: 'inline-block', padding: '2px 6px', borderRadius: '999px', width: 'fit-content' }}>
                {ind.signal}
            </div>
        </div>
    );

    return (
        <div className="indicators-grid-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                padding: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>
                        INDICATOR DESK LAYOUT
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            onClick={() => setDeskMode('compact')}
                            style={{
                                border: deskMode === 'compact' ? '1px solid rgba(58,121,255,0.8)' : '1px solid var(--border)',
                                background: deskMode === 'compact' ? 'rgba(58,121,255,0.16)' : 'var(--bg-tertiary)',
                                color: deskMode === 'compact' ? 'var(--text-main)' : 'var(--text-secondary)',
                                borderRadius: '999px',
                                padding: '4px 10px',
                                fontSize: '10px',
                                fontWeight: 700,
                                cursor: 'pointer'
                            }}
                        >
                            Compact View
                        </button>
                        <button
                            type="button"
                            onClick={() => setDeskMode('full')}
                            style={{
                                border: deskMode === 'full' ? '1px solid rgba(58,121,255,0.8)' : '1px solid var(--border)',
                                background: deskMode === 'full' ? 'rgba(58,121,255,0.16)' : 'var(--bg-tertiary)',
                                color: deskMode === 'full' ? 'var(--text-main)' : 'var(--text-secondary)',
                                borderRadius: '999px',
                                padding: '4px 10px',
                                fontSize: '10px',
                                fontWeight: 700,
                                cursor: 'pointer'
                            }}
                        >
                            Full View
                        </button>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <span className="nt-badge-green">Bullish: {signalCounts.bullish}</span>
                    <span className="nt-badge-red">Bearish: {signalCounts.bearish}</span>
                    <span className="nt-badge-muted">Neutral: {signalCounts.neutral}</span>
                    <span className="nt-badge-blue">Indicators: {indItems.length}</span>
                </div>
            </div>

            <div style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                padding: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
            }}>
                <button
                    type="button"
                    onClick={() => setShowParameters((prev) => !prev)}
                    style={{
                        border: '1px solid var(--border)',
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-main)',
                        borderRadius: '8px',
                        padding: '8px 10px',
                        fontSize: '11px',
                        fontWeight: 800,
                        letterSpacing: '0.3px',
                        cursor: 'pointer',
                        textAlign: 'left'
                    }}
                >
                    {showParameters ? '▼' : '►'} Indicator Parameters
                </button>

                {showParameters && (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                                Ajustez les paramètres sans changer la logique de calcul.
                            </div>
                            <button
                                type="button"
                                onClick={() => setPanelSettings({ ...DEFAULT_SETTINGS })}
                                style={{
                                    border: '1px solid var(--border)',
                                    background: 'var(--bg-tertiary)',
                                    color: 'var(--text-secondary)',
                                    borderRadius: '999px',
                                    padding: '4px 10px',
                                    fontSize: '10px',
                                    fontWeight: 700,
                                    cursor: 'pointer'
                                }}
                            >
                                Reset Defaults
                            </button>
                        </div>

                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {SETTINGS_PRESETS.map((preset) => {
                                const active = activePreset === preset.id;
                                return (
                                    <button
                                        key={preset.id}
                                        type="button"
                                        title={preset.description}
                                        onClick={() => setPanelSettings({ ...preset.settings })}
                                        style={{
                                            border: active ? '1px solid rgba(58,121,255,0.8)' : '1px solid var(--border)',
                                            background: active ? 'rgba(58,121,255,0.16)' : 'var(--bg-tertiary)',
                                            color: active ? 'var(--text-main)' : 'var(--text-secondary)',
                                            borderRadius: '999px',
                                            padding: '4px 10px',
                                            fontSize: '10px',
                                            fontWeight: 700,
                                            cursor: 'pointer'
                                        }}
                                    >
                                        {preset.label}
                                    </button>
                                );
                            })}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px' }}>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 700 }}>
                                    RSI Period: <span style={{ color: 'var(--text-main)' }}>{panelSettings.rsiPeriod}</span>
                                </span>
                                <input
                                    type="range"
                                    min={5}
                                    max={50}
                                    step={1}
                                    value={panelSettings.rsiPeriod}
                                    onChange={(e) => updateSetting('rsiPeriod', Number(e.target.value))}
                                />
                            </label>

                            <label style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 700 }}>
                                    Bollinger StdDev: <span style={{ color: 'var(--text-main)' }}>{panelSettings.bollingerStdDev.toFixed(1)}</span>
                                </span>
                                <input
                                    type="range"
                                    min={1}
                                    max={4}
                                    step={0.1}
                                    value={panelSettings.bollingerStdDev}
                                    onChange={(e) => updateSetting('bollingerStdDev', Number(e.target.value))}
                                />
                            </label>

                            <label style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 700 }}>
                                    Supertrend ATR Period: <span style={{ color: 'var(--text-main)' }}>{panelSettings.supertrendAtrPeriod}</span>
                                </span>
                                <input
                                    type="range"
                                    min={5}
                                    max={60}
                                    step={1}
                                    value={panelSettings.supertrendAtrPeriod}
                                    onChange={(e) => updateSetting('supertrendAtrPeriod', Number(e.target.value))}
                                />
                            </label>

                            <label style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 700 }}>
                                    Supertrend Multiplier: <span style={{ color: 'var(--text-main)' }}>{panelSettings.supertrendMultiplier.toFixed(1)}</span>
                                </span>
                                <input
                                    type="range"
                                    min={1}
                                    max={10}
                                    step={0.1}
                                    value={panelSettings.supertrendMultiplier}
                                    onChange={(e) => updateSetting('supertrendMultiplier', Number(e.target.value))}
                                />
                            </label>
                        </div>
                    </>
                )}
            </div>

            <div style={{
                background: 'linear-gradient(140deg, rgba(41,98,255,0.08), rgba(245,176,65,0.08))',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '10px'
            }}>
                <button
                    type="button"
                    onClick={() => setShowPlaybook((prev) => !prev)}
                    style={{
                        border: '1px solid var(--border)',
                        background: 'var(--bg-secondary)',
                        color: 'var(--text-main)',
                        borderRadius: '8px',
                        padding: '8px 10px',
                        fontSize: '11px',
                        fontWeight: 800,
                        letterSpacing: '0.4px',
                        cursor: 'pointer',
                        width: '100%',
                        textAlign: 'left'
                    }}
                >
                    {showPlaybook ? '▼' : '►'} ARIALGO INDICATOR PLAYBOOK
                </button>

                {showPlaybook && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px', marginTop: '8px' }}>
                        {focusCards.map((card) => (
                            <div key={card.title} style={{
                                background: 'var(--bg-secondary)',
                                border: '1px solid var(--border)',
                                borderRadius: '8px',
                                padding: '8px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '6px'
                            }}>
                                <div style={{ fontSize: '12px', fontWeight: 800, color: card.color }}>{card.title}</div>
                                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>{card.audience}</div>
                                <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                                    <div style={{ width: `${Math.max(0, Math.min(100, card.fill))}%`, height: '100%', background: card.color, transition: 'width 0.3s ease' }} />
                                </div>
                                <div style={{ fontSize: '10px', fontWeight: 700, color: card.color }}>
                                    {card.liveLabel}: {card.liveValue}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {groupedSections.map((section) => {
                const isOpen = deskMode === 'full' || openSection === section.key;
                const avgFill = section.items.length
                    ? Math.round(section.items.reduce((acc, item) => acc + item.fill, 0) / section.items.length)
                    : 0;

                return (
                    <div key={section.key} style={{
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                        borderRadius: '10px',
                        padding: '10px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px'
                    }}>
                        <button
                            type="button"
                            onClick={() => {
                                if (deskMode === 'full') return;
                                setOpenSection((prev) => prev === section.key ? prev : section.key);
                            }}
                            style={{
                                border: '1px solid var(--border)',
                                background: 'var(--bg-tertiary)',
                                color: 'var(--text-main)',
                                borderRadius: '8px',
                                padding: '8px 10px',
                                display: 'grid',
                                gridTemplateColumns: '1fr auto',
                                gap: '8px',
                                alignItems: 'center',
                                textAlign: 'left',
                                cursor: deskMode === 'full' ? 'default' : 'pointer',
                            }}
                        >
                            <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: '12px', fontWeight: 800, color: section.accent }}>
                                    {deskMode === 'compact' ? (isOpen ? '▼ ' : '► ') : ''}{section.title}
                                </div>
                                <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{section.description}</div>
                            </div>
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                <span className="nt-badge-blue">{section.items.length} items</span>
                                <span className="nt-badge-muted">Avg {avgFill}%</span>
                            </div>
                        </button>

                        {isOpen && (
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                                gap: '8px',
                                maxHeight: deskMode === 'compact' ? '320px' : 'none',
                                overflowY: deskMode === 'compact' ? 'auto' : 'visible',
                                paddingRight: deskMode === 'compact' ? '2px' : 0,
                            }}>
                                {section.items.map(renderIndicatorCard)}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
