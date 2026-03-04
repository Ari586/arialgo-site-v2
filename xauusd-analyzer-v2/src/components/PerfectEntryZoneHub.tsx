import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMarketStore } from '../store/marketStore';
import { calculateAllIndicators, Candle as IndicatorCandle } from '../utils/indicators';
import { formatSymbolPrice } from '../utils/priceFormat';
import { subscribeLiveTick } from '../utils/liveTickBus';
import TradeActionCard from './TradeActionCard';
import { buildTradeVerdict } from '../utils/tradeVerdict';

type SectionKey = 'pez' | 'retracement' | 'screener' | 'smart' | 'oscillator' | 'technical';

type NavItem = {
    key: SectionKey;
    icon: string;
    label: string;
    accent: string;
    tags: string[];
};

type SettingRow = {
    parameter: string;
    range: string;
    defaultValue: string;
    description: string;
};

type FibStat = {
    level: string;
    price: number;
    zone: 'NZ1' | 'NZ2' | 'CZ1' | 'CZ2' | 'CZ3';
    touches: number;
    confidencePct: number;
    breakoutPct: number;
    hasStar: boolean;
};

type FlipZone = {
    id: string;
    from: 'SUPPORT' | 'RESISTANCE';
    to: 'SUPPORT' | 'RESISTANCE';
    low: number;
    high: number;
    confidencePct: number;
    flipped: boolean;
    tone: 'bull' | 'bear';
};

type TimeZoneProjection = {
    step: number;
    etaLabel: string;
    confidencePct: number;
};

type ScreenerRow = {
    symbol: string;
    timeframe: string;
    volatility: 'Low' | 'Moderate' | 'High';
    trend: 'Bullish' | 'Bearish' | 'Sideways';
    fibRange: string;
    trendStrength: number;
    buyZone: boolean;
    sellZone: boolean;
    price: number;
};

type PezChartBand = {
    level: string;
    price: number;
    zone: FibStat['zone'];
    y: number;
    confidencePct: number;
    breakoutPct: number;
};

type PezTvOverlayLine = {
    id: string;
    level: string;
    zone: FibStat['zone'];
    price: number;
    confidencePct: number;
    yPct: number;
};

type ModuleLineCategory =
    | 'fib'
    | 'pivot'
    | 'vwap'
    | 'volume'
    | 'breakout'
    | 'orderblock'
    | 'band'
    | 'trend';

type ModuleLineRole = 'support' | 'resistance' | 'neutral';

type ModuleTvOverlayLine = {
    id: string;
    label: string;
    price: number;
    color: string;
    category: ModuleLineCategory;
    role: ModuleLineRole;
    distanceBps: number;
    yPct: number;
    emphasis?: boolean;
};

type ModuleSparklineModel = {
    path: string;
    areaPath: string;
    trendClass: 'bull' | 'bear' | 'neutral';
    changePct: number;
};

type ModuleOverlayStats = {
    latestPrice: number;
    supportCount: number;
    resistanceCount: number;
    neutralCount: number;
    nearestSupport: ModuleTvOverlayLine | null;
    nearestResistance: ModuleTvOverlayLine | null;
    corridorBps: number | null;
    pressureBias: number;
    focusLines: ModuleTvOverlayLine[];
    sparkline: ModuleSparklineModel | null;
};

type EntryZonePrediction = {
    id: string;
    side: 'LONG' | 'SHORT';
    zone: FibStat['zone'];
    level: string;
    low: number;
    high: number;
    confidencePct: number;
    etaLabel: string;
    reason: string;
};

type AnalysisSetKey = 'SET1' | 'SET2' | 'SET3' | 'SET4';

type PezSettings = {
    fibPeriod: number;
    fibAnalysisSet: AnalysisSetKey;
    enableAdaptiveSrLookback: boolean;
    manualSrLookback: number;
    minSrLookbackToTest: number;
    maxSrLookbackToTest: number;
    showTimeZone: boolean;
    enableTimeAdaptiveLookback: boolean;
    manualTimeLookback: number;
    minTimeLookbackToTest: number;
    maxTimeLookbackToTest: number;
    showMarketPressureGauge: boolean;
    enableAdaptiveFibLevels: boolean;
    majorTrendPeriod: number;
    retracementPeriod: number;
    screenerSymbolCount: number;
    enableEntryAudioAlerts: boolean;
    entryAlertDistanceBps: number;
    entryAlertCooldownSec: number;
};

type NumericSettingKey =
    | 'fibPeriod'
    | 'manualSrLookback'
    | 'minSrLookbackToTest'
    | 'maxSrLookbackToTest'
    | 'manualTimeLookback'
    | 'minTimeLookbackToTest'
    | 'maxTimeLookbackToTest'
    | 'majorTrendPeriod'
    | 'retracementPeriod'
    | 'screenerSymbolCount'
    | 'entryAlertDistanceBps'
    | 'entryAlertCooldownSec';

const NAV_ITEMS: NavItem[] = [
    { key: 'pez', icon: '🎯', label: 'AriAlgo Entry Zones', accent: '#22d3ee', tags: ['arialgo', 'entry', 'fib'] },
    { key: 'retracement', icon: '🧬', label: 'AriAlgo Retracement', accent: '#a78bfa', tags: ['dual pivot', 'confidence'] },
    { key: 'screener', icon: '📋', label: 'AriAlgo Screener', accent: '#f59e0b', tags: ['dashboard', 'multi symbol'] },
    { key: 'smart', icon: '⚡', label: 'AriAlgo Smart Trading', accent: '#14b8a6', tags: ['breakout', 'tp zone'] },
    { key: 'oscillator', icon: '🧠', label: 'AriAlgo Oscillator Matrix', accent: '#fb7185', tags: ['statistical', 'bands'] },
    { key: 'technical', icon: '🛰️', label: 'AriAlgo Technical Suite', accent: '#60a5fa', tags: ['smc', 'ict', 'ai'] },
];

const MODULE_SECTION_META: Record<Exclude<SectionKey, 'pez'>, { icon: string; microLabel: string }> = {
    retracement: { icon: '🧬', microLabel: 'Dual Pivot & Fib Confidence' },
    screener: { icon: '📋', microLabel: 'Confluence Multi-Symbol' },
    smart: { icon: '⚡', microLabel: 'Breakout & Retest Engine' },
    oscillator: { icon: '🧠', microLabel: 'Statistical Oscillator Bands' },
    technical: { icon: '🛰️', microLabel: 'Unified Technical Stack' },
};

const DEFAULT_SCREENER_SYMBOLS = [
    'XAU/USD',   // Commodities
    'EUR/USD',   // Forex
    'BTC/USD',   // Crypto
    'AAPL/USD',  // Stocks
    'SPX500/USD',// Indices
    'WTI/USD',
    'SOL/USD',
    'NVDA/USD',
    'NAS100/USD',
    'US30/USD'
];
const ADAPTIVE_PERIODS = [21, 34, 55, 89, 144, 200];
const FIB_TIME_STEPS = [1, 2, 3, 5, 8, 13, 21, 34];
const LIVE_TICK_FRESH_MS = 1500;
const PEZ_SETTINGS_KEY = 'ari_pez_settings_v1';
const DEFAULT_PEZ_SETTINGS: PezSettings = {
    fibPeriod: 144,
    fibAnalysisSet: 'SET2',
    enableAdaptiveSrLookback: true,
    manualSrLookback: 55,
    minSrLookbackToTest: 13,
    maxSrLookbackToTest: 144,
    showTimeZone: true,
    enableTimeAdaptiveLookback: true,
    manualTimeLookback: 55,
    minTimeLookbackToTest: 13,
    maxTimeLookbackToTest: 144,
    showMarketPressureGauge: true,
    enableAdaptiveFibLevels: false,
    majorTrendPeriod: 144,
    retracementPeriod: 21,
    screenerSymbolCount: 7,
    enableEntryAudioAlerts: true,
    entryAlertDistanceBps: 8,
    entryAlertCooldownSec: 30,
};

const FIB_SET_RATIOS: Record<AnalysisSetKey, number[]> = {
    SET1: [0.236, 0.382, 0.5, 0.618, 0.786],
    SET2: [0.236, 0.382, 0.5, 0.618, 0.786, 0.886],
    SET3: [0.146, 0.236, 0.382, 0.5, 0.618, 0.786, 1],
    SET4: [0.25, 0.382, 0.5, 0.618, 0.707, 0.786, 0.886, 0.95],
};

const ANALYSIS_SET_LABELS: Record<AnalysisSetKey, string> = {
    SET1: 'Classic',
    SET2: 'Advanced Harmonic',
    SET3: 'Extended',
    SET4: 'Precision',
};

const ZONE_COLORS: Record<FibStat['zone'], { line: string; fill: string }> = {
    NZ1: { line: 'rgba(248, 113, 113, 0.95)', fill: 'rgba(248, 113, 113, 0.18)' },
    NZ2: { line: 'rgba(251, 146, 60, 0.95)', fill: 'rgba(251, 146, 60, 0.18)' },
    CZ1: { line: 'rgba(56, 189, 248, 0.95)', fill: 'rgba(56, 189, 248, 0.16)' },
    CZ2: { line: 'rgba(34, 211, 238, 0.95)', fill: 'rgba(34, 211, 238, 0.18)' },
    CZ3: { line: 'rgba(34, 197, 94, 0.95)', fill: 'rgba(34, 197, 94, 0.18)' },
};

const TV_SYMBOL_MAP: Record<string, string> = {
    // Commodities
    'XAU/USD': 'OANDA:XAUUSD',
    'XAG/USD': 'OANDA:XAGUSD',
    'WTI/USD': 'TVC:USOIL',
    // Forex
    'EUR/USD': 'OANDA:EURUSD',
    'GBP/USD': 'OANDA:GBPUSD',
    'USD/JPY': 'OANDA:USDJPY',
    'CHF/JPY': 'OANDA:CHFJPY',
    'AUD/USD': 'OANDA:AUDUSD',
    // Crypto
    'BTC/USD': 'BINANCE:BTCUSDT',
    'ETH/USD': 'BINANCE:ETHUSDT',
    'SOL/USD': 'BINANCE:SOLUSDT',
    // Stocks
    'AAPL/USD': 'NASDAQ:AAPL',
    'TSLA/USD': 'NASDAQ:TSLA',
    'NVDA/USD': 'NASDAQ:NVDA',
    // Indices
    'SPX500/USD': 'OANDA:SPX500USD',
    'NAS100/USD': 'OANDA:NAS100USD',
    'US30/USD': 'OANDA:US30USD',
};

const PEZ_MAIN_SETTINGS: SettingRow[] = [
    { parameter: 'Fibonacci Period', range: '21 - 200', defaultValue: '144', description: 'Sensibilité des pivots. Plus haut = tendances majeures, plus bas = swings courts.' },
    { parameter: 'Fibonacci Analysis Set', range: 'SET1 - SET4', defaultValue: 'SET2: Advanced Harmonic', description: 'Sélection de profils de niveaux (Classic, Harmonic, Extended, Precision).' },
];

const ADAPTIVE_SR_SETTINGS: SettingRow[] = [
    { parameter: 'Enable Adaptive S/R Lookback', range: 'On / Off', defaultValue: 'On', description: 'Active le moteur adaptatif qui teste plusieurs périodes automatiquement.' },
    { parameter: 'Manual S/R Lookback', range: '1 - 144', defaultValue: '55', description: 'Lookback fixe lorsque le mode adaptatif est coupé.' },
    { parameter: 'Min S/R Lookback to Test', range: '10 - 34', defaultValue: '13', description: 'Bornes basses de recherche pour signaux plus rapides.' },
    { parameter: 'Max S/R Lookback to Test', range: '34 - 200', defaultValue: '144', description: 'Bornes hautes pour signaux plus robustes.' },
];

const ADAPTIVE_TIME_SETTINGS: SettingRow[] = [
    { parameter: 'Show Time Zone', range: 'On / Off', defaultValue: 'On', description: 'Affiche les fenêtres temporelles Fibonacci projetées.' },
    { parameter: 'Enable Time Adaptive Lookback', range: 'On / Off', defaultValue: 'On', description: 'Auto-optimise le lookback pour les time zones.' },
    { parameter: 'Manual Time Lookback', range: '1 - 144', defaultValue: '55', description: 'Lookback fixe si l’adaptation est désactivée.' },
    { parameter: 'Min / Max Time Lookback', range: '13 - 144', defaultValue: '13 / 144', description: 'Plage de test du moteur temporel adaptatif.' },
];

const PEZ_VISIBILITY_SETTINGS: SettingRow[] = [
    { parameter: 'Show Pivot Lines', range: 'On / Off', defaultValue: 'Off', description: 'Affiche les lignes ZigZag de liaison des pivots.' },
    { parameter: 'Trend Line', range: 'On / Off + Color', defaultValue: 'On (White)', description: 'Affiche la direction de tendance active.' },
    { parameter: 'Levels Line', range: 'On / Off', defaultValue: 'On', description: 'Affiche les lignes de niveaux Fibonacci.' },
    { parameter: 'Labels Position', range: 'Left / Right', defaultValue: 'Left', description: 'Position des labels de niveaux.' },
    { parameter: 'Box Labels Position', range: 'Left / Mid / Right', defaultValue: 'Mid', description: 'Position des labels des boîtes de zones.' },
    { parameter: 'Font Sizes', range: '8 - 18 / Tiny-Large', defaultValue: '12 / Normal', description: 'Taille du texte des niveaux et boîtes.' },
];

const PEZ_DEBUG_SETTINGS: SettingRow[] = [
    { parameter: 'Show Pivot Fib Values', range: 'On / Off', defaultValue: 'Off', description: 'Affiche les valeurs Fibonacci calculées par pivot.' },
    { parameter: 'Show Pivot Time Fib Ranges', range: 'On / Off', defaultValue: 'Off', description: 'Affiche les plages temporelles Fibonacci aux pivots.' },
    { parameter: 'Show Fibonacci Time Zones', range: 'On / Off', defaultValue: 'Off', description: 'Montre les marqueurs temporels projetés.' },
];

const SCREENER_SETTINGS: SettingRow[] = [
    { parameter: 'Major Trend Period', range: '2 - 1404', defaultValue: '144', description: 'Pivots majeurs (A/B series), structure primaire du marché.' },
    { parameter: 'Retracement Period', range: '2 - 144', defaultValue: '21', description: 'Pivots mineurs (pullbacks) pour entrées retracement.' },
    { parameter: 'Enable Adaptive Fib Levels', range: 'On / Off', defaultValue: 'Off', description: 'Zones Fib recalculées statistiquement selon l’actif.' },
    { parameter: 'Noise Zones (NZ1/NZ2)', range: '5% - 25%', defaultValue: '10% / 10%', description: 'Zones statistiquement moins significatives.' },
    { parameter: 'Confidence Zones (CZ1-3)', range: '15% - 40%', defaultValue: '26.67% each', description: 'Zones à probabilité élevée de réaction.' },
];

const SMART_TRADING_SETTINGS: SettingRow[] = [
    { parameter: 'Fake Trend Break Sensitivity', range: '0.1 - 2.0', defaultValue: '1.0', description: 'Scale ATR pour buffer S/R et qualité des breakouts.' },
    { parameter: 'Volatility Sensitivity', range: '1.0 - 5.0', defaultValue: '3.0', description: 'Largeur des bandes supertrend (réactivité vs stabilité).' },
    { parameter: 'Use HTF Trend', range: 'On / Off', defaultValue: 'Off', description: 'Filtre des signaux par tendance timeframe supérieure.' },
    { parameter: 'Show Reversal Zone', range: 'On / Off', defaultValue: 'Off', description: 'Affiche les zones de re-entry (second chance).' },
    { parameter: 'Show TP Zone', range: 'On / Off', defaultValue: 'Off', description: 'Affiche les zones de take-profit dynamiques.' },
];

const OSCILLATOR_SETTINGS: SettingRow[] = [
    { parameter: 'Main Oscillator', range: 'RSI / MFI / Momentum / Stoch / Stoch RSI / CMF', defaultValue: 'RSI', description: 'Oscillateur principal du moteur statistique.' },
    { parameter: 'PH/PL Period', range: '2 - 200', defaultValue: '21', description: 'Sensibilité ZigZag pour tops/bottoms.' },
    { parameter: 'Lookback Pivots', range: '10 - 500', defaultValue: '100', description: 'Nombre de pivots historiques analysés.' },
    { parameter: 'Enable Data Decay', range: 'On / Off', defaultValue: 'On', description: 'Pondère davantage les données récentes.' },
    { parameter: 'Decay Rate', range: '0.1 - 1.0', defaultValue: '0.95', description: 'Force de l’adaptation récente (0.9-0.99 conseillé).' },
];

const TECHNICAL_SUITE_SETTINGS: SettingRow[] = [
    { parameter: 'ICT Killzone', range: 'On / Off', defaultValue: 'Off', description: 'Sessions Asia/London/New York avec timezone.' },
    { parameter: 'Smart Money Concepts', range: 'On / Off', defaultValue: 'Off', description: 'BOS, CHOCH, Order Blocks, FVG automatiques.' },
    { parameter: 'Fibonacci Levels', range: 'On / Off', defaultValue: 'Off', description: 'Retracement / Extension / Pivot auto.' },
    { parameter: 'Price Forecast', range: 'On / Off', defaultValue: 'Off', description: 'Projection IA conditionnée au backtest local.' },
    { parameter: 'Trend Finder', range: 'On / Off', defaultValue: 'On', description: 'Détection adaptative de tendance par confluence.' },
    { parameter: 'AI-Threshold', range: 'On / Off', defaultValue: 'On', description: 'Seuils probabilistes dynamiques pour hauts/bas.' },
];

function toEpochMs(time: number | string): number {
    const n = Number(time);
    if (Number.isFinite(n)) {
        if (n > 1e15) return Math.floor(n / 1e6); // nanoseconds
        if (n > 1e13) return Math.floor(n / 1e3); // microseconds
        if (n > 1e11) return Math.floor(n); // milliseconds
        return Math.floor(n * 1000);
    }
    const parsed = Date.parse(String(time));
    return Number.isFinite(parsed) ? parsed : Date.now();
}

function formatClockWithMs(timestampMs?: number | null): string {
    if (!Number.isFinite(Number(timestampMs))) return '—';
    const d = new Date(Number(timestampMs));
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
}

function formatBps(value?: number | null): string {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    const abs = Math.abs(n);
    const rounded = abs >= 100 ? abs.toFixed(0) : abs.toFixed(1);
    return `${rounded} bps`;
}

function timeframeToSeconds(tf: string): number {
    const value = Number.parseInt(tf, 10);
    if (!Number.isFinite(value) || value <= 0) return 60;
    if (tf.endsWith('s')) return value;
    if (tf.endsWith('min') || tf.endsWith('m')) return value * 60;
    if (tf.endsWith('h')) return value * 3600;
    return 60;
}

function toTradingViewInterval(tf: string): string {
    if (tf.endsWith('s')) return '1';
    if (tf === '1min' || tf === '1m') return '1';
    if (tf === '3min' || tf === '3m') return '3';
    if (tf === '5min' || tf === '5m') return '5';
    if (tf === '15min' || tf === '15m') return '15';
    if (tf === '30min' || tf === '30m') return '30';
    if (tf === '1h') return '60';
    if (tf === '4h') return '240';
    return '15';
}

function classifyVolatility(atr: number | null, price: number): 'Low' | 'Moderate' | 'High' {
    if (!atr || !price) return 'Low';
    const ratio = (atr / price) * 100;
    if (ratio < 0.2) return 'Low';
    if (ratio < 0.7) return 'Moderate';
    return 'High';
}

function clampInt(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, Math.round(value)));
}

function loadPezSettings(): PezSettings {
    if (typeof window === 'undefined') return DEFAULT_PEZ_SETTINGS;
    try {
        const raw = window.localStorage.getItem(PEZ_SETTINGS_KEY);
        if (!raw) return DEFAULT_PEZ_SETTINGS;
        const parsed = JSON.parse(raw) as Partial<PezSettings>;
        return {
            ...DEFAULT_PEZ_SETTINGS,
            ...parsed,
            fibPeriod: clampInt(Number(parsed.fibPeriod ?? DEFAULT_PEZ_SETTINGS.fibPeriod), 21, 200),
            manualSrLookback: clampInt(Number(parsed.manualSrLookback ?? DEFAULT_PEZ_SETTINGS.manualSrLookback), 1, 200),
            minSrLookbackToTest: clampInt(Number(parsed.minSrLookbackToTest ?? DEFAULT_PEZ_SETTINGS.minSrLookbackToTest), 10, 200),
            maxSrLookbackToTest: clampInt(Number(parsed.maxSrLookbackToTest ?? DEFAULT_PEZ_SETTINGS.maxSrLookbackToTest), 10, 300),
            manualTimeLookback: clampInt(Number(parsed.manualTimeLookback ?? DEFAULT_PEZ_SETTINGS.manualTimeLookback), 1, 200),
            minTimeLookbackToTest: clampInt(Number(parsed.minTimeLookbackToTest ?? DEFAULT_PEZ_SETTINGS.minTimeLookbackToTest), 10, 200),
            maxTimeLookbackToTest: clampInt(Number(parsed.maxTimeLookbackToTest ?? DEFAULT_PEZ_SETTINGS.maxTimeLookbackToTest), 10, 300),
            majorTrendPeriod: clampInt(Number(parsed.majorTrendPeriod ?? DEFAULT_PEZ_SETTINGS.majorTrendPeriod), 2, 1404),
            retracementPeriod: clampInt(Number(parsed.retracementPeriod ?? DEFAULT_PEZ_SETTINGS.retracementPeriod), 2, 300),
            screenerSymbolCount: clampInt(Number(parsed.screenerSymbolCount ?? DEFAULT_PEZ_SETTINGS.screenerSymbolCount), 1, 10),
            entryAlertDistanceBps: clampInt(Number(parsed.entryAlertDistanceBps ?? DEFAULT_PEZ_SETTINGS.entryAlertDistanceBps), 1, 150),
            entryAlertCooldownSec: clampInt(Number(parsed.entryAlertCooldownSec ?? DEFAULT_PEZ_SETTINGS.entryAlertCooldownSec), 5, 180),
        };
    } catch {
        return DEFAULT_PEZ_SETTINGS;
    }
}

function getAdaptiveCandidatePeriods(minValue: number, maxValue: number, fallback: number): number[] {
    const min = Math.min(minValue, maxValue);
    const max = Math.max(minValue, maxValue);
    const fromFibBase = [...ADAPTIVE_PERIODS, 13, 21, 34, 55, 89, 144, 200, 233]
        .filter((v, idx, arr) => arr.indexOf(v) === idx)
        .filter((v) => v >= min && v <= max)
        .sort((a, b) => a - b);
    if (fromFibBase.length > 0) return fromFibBase;
    return [clampInt(fallback, 10, 300)];
}

function formatRatioLabel(value: number): string {
    const raw = value.toFixed(3);
    return raw.replace(/0+$/, '').replace(/\.$/, '');
}

function getClosestLevelPrice(levels: Record<string, number>, targetRatio: number): number | null {
    const entries = Object.entries(levels);
    if (entries.length === 0) return null;
    let best: { ratio: number; price: number; distance: number } | null = null;
    for (const [level, price] of entries) {
        const ratio = Number(level);
        if (!Number.isFinite(ratio) || !Number.isFinite(price)) continue;
        const distance = Math.abs(ratio - targetRatio);
        if (!best || distance < best.distance) {
            best = { ratio, price, distance };
        }
    }
    return best ? best.price : null;
}

function computeAdaptiveFibStructure(
    candles: IndicatorCandle[],
    period: number,
    setKey: AnalysisSetKey,
    currentPrice: number
) {
    const lookback = Math.max(20, clampInt(period, 21, 200));
    const slice = candles.slice(-lookback);
    if (slice.length < 20) return null;

    let swingHigh = -Infinity;
    let swingLow = Infinity;
    let highIndex = -1;
    let lowIndex = -1;

    for (let i = 0; i < slice.length; i++) {
        if (slice[i].high > swingHigh) {
            swingHigh = slice[i].high;
            highIndex = i;
        }
        if (slice[i].low < swingLow) {
            swingLow = slice[i].low;
            lowIndex = i;
        }
    }
    if (!Number.isFinite(swingHigh) || !Number.isFinite(swingLow) || swingHigh <= swingLow) return null;

    const trend = highIndex > lowIndex ? 'UP' : lowIndex > highIndex ? 'DOWN' : 'RANGE';
    const range = swingHigh - swingLow;
    const ratios = FIB_SET_RATIOS[setKey];
    const levels: Record<string, number> = {};

    for (const ratio of ratios) {
        const key = formatRatioLabel(ratio);
        levels[key] = trend === 'DOWN'
            ? swingLow + (range * ratio)
            : swingHigh - (range * ratio);
    }

    const entries = Object.entries(levels).map(([name, price]) => ({ name, price }));
    entries.sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice));
    const nearest = entries[0] || null;

    const ratioForPocketA = ratios.reduce((prev, value) => Math.abs(value - 0.5) < Math.abs(prev - 0.5) ? value : prev, ratios[0]);
    const ratioForPocketB = ratios.reduce((prev, value) => Math.abs(value - 0.618) < Math.abs(prev - 0.618) ? value : prev, ratios[0]);
    const keyA = formatRatioLabel(ratioForPocketA);
    const keyB = formatRatioLabel(ratioForPocketB);
    const gpMin = Math.min(levels[keyA], levels[keyB]);
    const gpMax = Math.max(levels[keyA], levels[keyB]);
    const inGoldenPocket = currentPrice >= gpMin && currentPrice <= gpMax;

    return {
        trend,
        swingHigh,
        swingLow,
        levels,
        nearestLevel: nearest?.name || null,
        nearestPrice: nearest ? Number(nearest.price.toFixed(2)) : null,
        inGoldenPocket,
    };
}

async function fetchHistory(symbol: string, timeframe: string, outputsize = 360): Promise<IndicatorCandle[]> {
    const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}&outputsize=${encodeURIComponent(String(outputsize))}`);
    const data = await res.json();
    if (!Array.isArray(data?.data)) return [];
    return data.data as IndicatorCandle[];
}

function evaluateAdaptiveLookback(candles: IndicatorCandle[], period: number) {
    if (candles.length < period + 8) {
        return { period, touches: 0, reactions: 0, confidencePct: 0 };
    }

    let touches = 0;
    let reactions = 0;
    for (let i = period; i < candles.length - 4; i += 2) {
        const previous = candles.slice(i - period, i);
        const current = candles[i];
        const nextSlice = candles.slice(i + 1, i + 4);
        if (!current || nextSlice.length < 3) continue;

        const swingHigh = Math.max(...previous.map(c => c.high));
        const swingLow = Math.min(...previous.map(c => c.low));
        const range = Math.max(1e-9, swingHigh - swingLow);
        const tolerance = Math.max(range * 0.04, Math.abs(current.close) * 0.0008);

        const touchedHigh = current.high >= swingHigh - tolerance;
        const touchedLow = current.low <= swingLow + tolerance;

        if (touchedHigh) {
            touches += 1;
            const futureLow = Math.min(...nextSlice.map(c => c.low));
            if (current.close - futureLow > tolerance) reactions += 1;
        }
        if (touchedLow) {
            touches += 1;
            const futureHigh = Math.max(...nextSlice.map(c => c.high));
            if (futureHigh - current.close > tolerance) reactions += 1;
        }
    }

    return {
        period,
        touches,
        reactions,
        confidencePct: touches > 0 ? Math.round((reactions / touches) * 100) : 0
    };
}

function getTrendTone(direction: string | undefined): 'bull' | 'bear' | 'neutral' {
    const normalized = String(direction || '').toLowerCase();
    if (normalized.includes('hauss') || normalized.includes('bull')) return 'bull';
    if (normalized.includes('baiss') || normalized.includes('bear')) return 'bear';
    return 'neutral';
}

function SettingTable({ title, rows }: { title: string; rows: SettingRow[] }) {
    return (
        <div className="perspective-table-block">
            <h4>{title}</h4>
            <table>
                <thead>
                    <tr>
                        <th>Parameter</th>
                        <th>Range</th>
                        <th>Default</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={`${title}-${row.parameter}`}>
                            <td>{row.parameter}</td>
                            <td>{row.range}</td>
                            <td>{row.defaultValue}</td>
                            <td>{row.description}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default function PerfectEntryZoneHub() {
    const currentSymbol = useMarketStore((state) => state.currentSymbol);
    const currentTimeframe = useMarketStore((state) => state.currentTimeframe);
    const orderbook = useMarketStore((state) => state.orderbook);
    const prices = useMarketStore((state) => state.prices);
    const instruments = useMarketStore((state) => state.instruments);
    const [activeSection, setActiveSection] = React.useState<SectionKey>('pez');
    const [search, setSearch] = React.useState('');
    const [settings, setSettings] = React.useState<PezSettings>(() => loadPezSettings());
    const [pezLegendCollapsed, setPezLegendCollapsed] = React.useState(true);
    const [showPezOverlay, setShowPezOverlay] = React.useState(true);
    const [showModuleOverlay, setShowModuleOverlay] = React.useState(true);
    const [showModuleInsights, setShowModuleInsights] = React.useState(false);
    const [lastEntryAlertLabel, setLastEntryAlertLabel] = React.useState('—');
    const [pezRealtimePrice, setPezRealtimePrice] = React.useState(0);
    const [pezLastTickTs, setPezLastTickTs] = React.useState<number | null>(null);
    const [pezNowTs, setPezNowTs] = React.useState<number>(() => Date.now());
    const pezTvContainerRef = React.useRef<HTMLDivElement | null>(null);
    const moduleTvContainerRef = React.useRef<HTMLDivElement | null>(null);
    const audioContextRef = React.useRef<AudioContext | null>(null);
    const alertMemoryRef = React.useRef<Record<string, number>>({});
    const isAndroidChrome = React.useMemo(() => {
        if (typeof navigator === 'undefined') return false;
        const ua = navigator.userAgent || '';
        return /Android/i.test(ua)
            && /Chrome\/\d+/i.test(ua)
            && !/EdgA|OPR|SamsungBrowser|UCBrowser/i.test(ua);
    }, []);

    const livePrice = prices[currentSymbol] || 0;
    const realtimePrice = pezRealtimePrice > 0 ? pezRealtimePrice : livePrice;
    const pezTickAgeMs = pezLastTickTs ? Math.max(0, pezNowTs - pezLastTickTs) : null;

    React.useEffect(() => {
        const unsubscribe = subscribeLiveTick((tick) => {
            if (tick.symbol !== currentSymbol) return;
            const price = Number(tick.price);
            if (!Number.isFinite(price) || price <= 0) return;
            setPezRealtimePrice(price);
            setPezLastTickTs(toEpochMs(tick.timestamp ?? Date.now()));
        });
        return unsubscribe;
    }, [currentSymbol]);

    React.useEffect(() => {
        setPezRealtimePrice(0);
        setPezLastTickTs(null);
    }, [currentSymbol, currentTimeframe]);

    React.useEffect(() => {
        let rafId = 0;
        const loop = () => {
            setPezNowTs(Date.now());
            rafId = window.requestAnimationFrame(loop);
        };
        rafId = window.requestAnimationFrame(loop);
        return () => {
            if (rafId) window.cancelAnimationFrame(rafId);
        };
    }, [activeSection]);

    React.useEffect(() => {
        if (activeSection !== 'pez') {
            setShowModuleInsights(false);
        }
    }, [activeSection]);

    const updateSetting = React.useCallback(<K extends keyof PezSettings>(key: K, value: PezSettings[K]) => {
        setSettings((prev) => ({ ...prev, [key]: value }));
    }, []);

    const updateNumberSetting = React.useCallback((
        key: NumericSettingKey,
        value: string,
        min: number,
        max: number
    ) => {
        const next = clampInt(Number(value), min, max);
        setSettings((prev) => ({ ...prev, [key]: next }));
    }, []);

    React.useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(PEZ_SETTINGS_KEY, JSON.stringify(settings));
        } catch {
            // ignore persistence failures
        }
    }, [settings]);

    const getAudioContext = React.useCallback((): AudioContext | null => {
        if (typeof window === 'undefined') return null;
        if (audioContextRef.current) return audioContextRef.current;
        const audioCtor = (window.AudioContext
            || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
        if (!audioCtor) return null;
        audioContextRef.current = new audioCtor();
        return audioContextRef.current;
    }, []);

    const playEntryAlertTone = React.useCallback((side: 'LONG' | 'SHORT', inZone: boolean) => {
        const ctx = getAudioContext();
        if (!ctx) return;

        const now = ctx.currentTime;
        const pulses = inZone ? 2 : 1;
        const baseFreq = side === 'LONG' ? 920 : 560;
        const pulseGap = 0.16;

        for (let i = 0; i < pulses; i++) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const start = now + (i * pulseGap);
            const end = start + 0.12;

            osc.type = side === 'LONG' ? 'triangle' : 'sawtooth';
            osc.frequency.setValueAtTime(baseFreq + (i * 30), start);

            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(0.055, start + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, end);

            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(start);
            osc.stop(end + 0.01);
        }

        if (ctx.state === 'suspended') {
            ctx.resume().catch(() => {
                // Browser gesture policies can block audio until user interaction.
            });
        }
    }, [getAudioContext]);

    React.useEffect(() => {
        if (!settings.enableEntryAudioAlerts) return;
        const ctx = getAudioContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') {
            ctx.resume().catch(() => {
                // Browser gesture policies can block audio until user interaction.
            });
        }
    }, [getAudioContext, settings.enableEntryAudioAlerts]);

    React.useEffect(() => {
        return () => {
            const ctx = audioContextRef.current;
            if (ctx) {
                ctx.close().catch(() => {
                    // ignore close failures
                });
                audioContextRef.current = null;
            }
        };
    }, []);

    const historyOutputsize = Math.max(
        240,
        settings.fibPeriod * 3,
        settings.maxSrLookbackToTest * 2,
        settings.maxTimeLookbackToTest * 2
    );

    const { data: history = [] } = useQuery({
        queryKey: ['pez-history', currentSymbol, currentTimeframe, historyOutputsize],
        queryFn: () => fetchHistory(currentSymbol, currentTimeframe, historyOutputsize),
        staleTime: 10000,
        refetchInterval: currentTimeframe.endsWith('s') ? 2000 : 12000,
    });

    const indicators = React.useMemo(() => {
        if (!history || history.length < 30) return null;
        const cloned = history.map((c) => ({ ...c }));
        if (realtimePrice > 0 && cloned.length > 0) {
            const last = { ...cloned[cloned.length - 1] };
            last.close = realtimePrice;
            last.high = Math.max(last.high, realtimePrice);
            last.low = Math.min(last.low, realtimePrice);
            cloned[cloned.length - 1] = last;
        }
        return calculateAllIndicators(cloned);
    }, [history, realtimePrice]);

    const trendDirection = indicators?.trend?.direction as string | undefined;
    const trendTone = getTrendTone(trendDirection);
    const trendStrength = indicators?.trend?.strength as string | undefined;

    const pressureRatio = React.useMemo(() => {
        if (orderbook?.ratio != null) return Math.max(0, Math.min(1, orderbook.ratio));
        const signal = indicators?.proCombo?.signal as string | undefined;
        if (signal === 'BUY') return 0.62;
        if (signal === 'SELL') return 0.38;
        return 0.5;
    }, [indicators?.proCombo?.signal, orderbook?.ratio]);

    const buyPressurePct = Math.round(pressureRatio * 100);
    const sellPressurePct = 100 - buyPressurePct;
    const pressureTone: 'bull' | 'bear' | 'neutral' = pressureRatio > 0.55 ? 'bull' : pressureRatio < 0.45 ? 'bear' : 'neutral';

    const adaptiveResult = React.useMemo(() => {
        if (!history || history.length < 80) return null;
        const candidatePeriods = settings.enableAdaptiveSrLookback
            ? getAdaptiveCandidatePeriods(settings.minSrLookbackToTest, settings.maxSrLookbackToTest, settings.manualSrLookback)
            : [clampInt(settings.manualSrLookback, 1, 300)];
        const tested = candidatePeriods
            .map((period) => evaluateAdaptiveLookback(history, period))
            .filter((entry) => entry.touches > 2);
        if (tested.length === 0) return null;
        tested.sort((a, b) => (b.confidencePct - a.confidencePct) || (b.touches - a.touches));
        return tested[0];
    }, [
        history,
        settings.enableAdaptiveSrLookback,
        settings.manualSrLookback,
        settings.minSrLookbackToTest,
        settings.maxSrLookbackToTest
    ]);

    const adaptiveFib = React.useMemo(() => {
        if (!history || history.length < 30) return null;
        return computeAdaptiveFibStructure(
            history,
            settings.fibPeriod,
            settings.fibAnalysisSet,
            realtimePrice || history[history.length - 1]?.close || 0
        );
    }, [history, realtimePrice, settings.fibAnalysisSet, settings.fibPeriod]);

    const timeAdaptiveResult = React.useMemo(() => {
        if (!history || history.length < 80) return null;
        const candidatePeriods = settings.enableTimeAdaptiveLookback
            ? getAdaptiveCandidatePeriods(settings.minTimeLookbackToTest, settings.maxTimeLookbackToTest, settings.manualTimeLookback)
            : [clampInt(settings.manualTimeLookback, 1, 300)];
        const tested = candidatePeriods
            .map((period) => evaluateAdaptiveLookback(history, period))
            .filter((entry) => entry.touches > 1);
        if (tested.length === 0) return null;
        tested.sort((a, b) => (b.confidencePct - a.confidencePct) || (b.touches - a.touches));
        return tested[0];
    }, [
        history,
        settings.enableTimeAdaptiveLookback,
        settings.manualTimeLookback,
        settings.minTimeLookbackToTest,
        settings.maxTimeLookbackToTest
    ]);

    const fibStats = React.useMemo((): FibStat[] => {
        const atr = indicators?.atr as number | null | undefined;
        if (!history || history.length < 40) return [];
        const levels = (adaptiveFib?.levels as Record<string, number> | undefined)
            || (indicators?.fibonacci?.levels as Record<string, number> | undefined);
        if (!levels) return [];

        const levelRatios = Object.keys(levels)
            .map((level) => Number(level))
            .filter((ratio) => Number.isFinite(ratio))
            .sort((a, b) => a - b);

        const mapRatioToZone = (ratio: number): FibStat['zone'] => {
            if (levelRatios.length <= 1) return 'CZ2';
            const min = levelRatios[0];
            const max = levelRatios[levelRatios.length - 1];
            const spread = Math.max(1e-9, max - min);
            const normalized = (ratio - min) / spread;
            if (normalized <= 0.2) return 'NZ1';
            if (normalized <= 0.4) return 'CZ1';
            if (normalized <= 0.6) return 'CZ2';
            if (normalized <= 0.8) return 'CZ3';
            return 'NZ2';
        };

        return Object.entries(levels).map(([level, price]) => {
            const ratio = Number(level);
            const tolerance = Math.max((atr || 0) * 0.22, Math.abs(price) * 0.001);
            let touches = 0;
            let reactions = 0;
            let breakouts = 0;

            for (let i = 0; i < history.length - 4; i++) {
                const candle = history[i];
                const touched = candle.low <= (price + tolerance) && candle.high >= (price - tolerance);
                if (!touched) continue;
                touches += 1;

                const future = history[i + 3];
                if (!future) continue;

                const move = Math.abs(future.close - price);
                if (move > tolerance * 1.35) reactions += 1;

                const flippedUp = candle.close < price && future.close > price + tolerance;
                const flippedDown = candle.close > price && future.close < price - tolerance;
                if (flippedUp || flippedDown) breakouts += 1;
            }

            const confidencePct = touches > 0 ? Math.round((reactions / touches) * 100) : 0;
            const breakoutPct = touches > 0 ? Math.round((breakouts / touches) * 100) : 0;
            return {
                level,
                price,
                zone: Number.isFinite(ratio) ? mapRatioToZone(ratio) : 'CZ2',
                touches,
                confidencePct,
                breakoutPct,
                hasStar: confidencePct >= 65 && touches >= 4
            };
        }).sort((a, b) => b.confidencePct - a.confidencePct);
    }, [history, indicators?.atr, indicators?.fibonacci, adaptiveFib?.levels]);

    const pezChartModel = React.useMemo(() => {
        if (!history || history.length < 20) return null;
        const slice = history.slice(-220);
        if (slice.length < 12) return null;

        const fibLevels = (adaptiveFib?.levels as Record<string, number> | undefined)
            || (indicators?.fibonacci?.levels as Record<string, number> | undefined);
        if (!fibLevels || Object.keys(fibLevels).length === 0) return null;

        const normalizeLevel = (value: string): string => {
            const ratio = Number(value);
            return Number.isFinite(ratio) ? formatRatioLabel(ratio) : value;
        };

        const fibStatMap = new Map<string, FibStat>();
        for (const stat of fibStats) {
            fibStatMap.set(normalizeLevel(stat.level), stat);
        }

        const levelPrices = Object.values(fibLevels).filter((price) => Number.isFinite(price));
        if (levelPrices.length === 0) return null;

        const latestPrice = realtimePrice > 0 ? realtimePrice : slice[slice.length - 1].close;
        const lows = slice.map((candle) => candle.low);
        const highs = slice.map((candle) => candle.high);
        const minPrice = Math.min(...lows, ...levelPrices, latestPrice);
        const maxPrice = Math.max(...highs, ...levelPrices, latestPrice);
        const range = Math.max(1e-9, maxPrice - minPrice);

        const pad = Math.max(range * 0.07, range * 0.01);
        const yMax = maxPrice + pad;
        const yMin = minPrice - pad;
        const span = Math.max(1e-9, yMax - yMin);
        const toY = (price: number): number => ((yMax - price) / span) * 100;

        const bands: PezChartBand[] = Object.entries(fibLevels)
            .map(([level, price]) => {
                const normalized = normalizeLevel(level);
                const stat = fibStatMap.get(normalized);
                return {
                    level: normalized,
                    price,
                    zone: stat?.zone || 'CZ2',
                    y: toY(price),
                    confidencePct: stat?.confidencePct ?? 0,
                    breakoutPct: stat?.breakoutPct ?? 0,
                };
            })
            .sort((a, b) => a.price - b.price);

        const gpA = getClosestLevelPrice(fibLevels, 0.5);
        const gpB = getClosestLevelPrice(fibLevels, 0.618);
        const entryBand = gpA != null && gpB != null ? {
            topPct: Math.min(toY(gpA), toY(gpB)),
            heightPct: Math.max(2, Math.abs(toY(gpA) - toY(gpB))),
            low: Math.min(gpA, gpB),
            high: Math.max(gpA, gpB),
        } : null;

        const overlayLines: PezTvOverlayLine[] = bands
            .map((band) => ({
                id: `pez-${band.level}`,
                level: band.level,
                zone: band.zone,
                price: band.price,
                confidencePct: band.confidencePct,
                yPct: band.y,
            }))
            .filter((line) => line.yPct >= -1 && line.yPct <= 101)
            .sort((a, b) => a.yPct - b.yPct);

        const visibleOverlayLines = [...overlayLines]
            .sort((a, b) => Math.abs(a.price - latestPrice) - Math.abs(b.price - latestPrice))
            .slice(0, 9)
            .sort((a, b) => a.yPct - b.yPct);

        return {
            latestPrice,
            bands,
            overlayLines: visibleOverlayLines,
            entryBand,
        };
    }, [history, adaptiveFib?.levels, indicators?.fibonacci?.levels, indicators?.atr, realtimePrice, fibStats]);

    const flipZones = React.useMemo((): FlipZone[] => {
        const blocks = indicators?.orderBlocks as Array<{ type: 'BULLISH' | 'BEARISH'; low: number; high: number; age: number }> | undefined;
        if (!blocks || blocks.length === 0 || realtimePrice <= 0) return [];
        return blocks.slice(-5).reverse().map((zone, index) => {
            if (zone.type === 'BEARISH') {
                const flipped = realtimePrice > zone.high;
                return {
                    id: `flip-${index}-bear`,
                    from: 'RESISTANCE',
                    to: flipped ? 'SUPPORT' : 'RESISTANCE',
                    low: zone.low,
                    high: zone.high,
                    confidencePct: Math.max(40, Math.min(92, 78 - (zone.age * 2))),
                    flipped,
                    tone: flipped ? 'bull' : 'bear',
                };
            }
            const flipped = realtimePrice < zone.low;
            return {
                id: `flip-${index}-bull`,
                from: 'SUPPORT',
                to: flipped ? 'RESISTANCE' : 'SUPPORT',
                low: zone.low,
                high: zone.high,
                confidencePct: Math.max(40, Math.min(92, 76 - (zone.age * 2))),
                flipped,
                tone: flipped ? 'bear' : 'bull',
            };
        });
    }, [indicators?.orderBlocks, realtimePrice]);

    const timeZones = React.useMemo((): TimeZoneProjection[] => {
        if (!settings.showTimeZone) return [];
        if (!history || history.length === 0) return [];
        const lastCandle = history[history.length - 1];
        const lastMs = toEpochMs(lastCandle.time);
        const basePeriod = timeAdaptiveResult?.period || clampInt(settings.manualTimeLookback, 1, 300);
        const cadenceMultiplier = Math.max(1, Math.round(basePeriod / 13));
        const stepSec = timeframeToSeconds(currentTimeframe) * cadenceMultiplier;
        const baseConfidence = timeAdaptiveResult?.confidencePct || adaptiveResult?.confidencePct || 58;
        return FIB_TIME_STEPS.map((step) => {
            const eta = new Date(lastMs + (step * stepSec * 1000));
            const decay = Math.max(0, step - 1) * Math.max(2, Math.round(cadenceMultiplier * 1.5));
            return {
                step,
                etaLabel: eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                confidencePct: Math.max(35, Math.min(92, baseConfidence - decay)),
            };
        });
    }, [
        adaptiveResult?.confidencePct,
        currentTimeframe,
        history,
        settings.manualTimeLookback,
        settings.showTimeZone,
        timeAdaptiveResult?.confidencePct,
        timeAdaptiveResult?.period
    ]);

    const nextEntryPredictions = React.useMemo((): EntryZonePrediction[] => {
        if (!pezChartModel || pezChartModel.bands.length === 0) return [];
        const current = pezChartModel.latestPrice || realtimePrice;
        if (!Number.isFinite(current) || current <= 0) return [];

        const atr = Number(indicators?.atr || 0);
        const halfWidth = Math.max(
            atr > 0 ? atr * 0.22 : current * 0.0007,
            current * 0.00035
        );

        const nearestBands = [...pezChartModel.bands]
            .sort((a, b) => Math.abs(a.price - current) - Math.abs(b.price - current))
            .slice(0, 8);

        const buildPrediction = (band: PezChartBand, index: number): EntryZonePrediction => {
            const side: EntryZonePrediction['side'] = band.price <= current ? 'LONG' : 'SHORT';
            const distancePct = Math.abs((band.price - current) / current) * 100;

            let score = (band.confidencePct * 0.62) + ((100 - band.breakoutPct) * 0.12);
            score += band.zone === 'CZ3' ? 12 : band.zone === 'CZ2' ? 10 : band.zone === 'CZ1' ? 8 : 4;
            score -= Math.min(18, distancePct * 42);

            if ((side === 'LONG' && trendTone === 'bull') || (side === 'SHORT' && trendTone === 'bear')) score += 8;
            if ((side === 'LONG' && pressureTone === 'bull') || (side === 'SHORT' && pressureTone === 'bear')) score += 6;
            if ((side === 'LONG' && pressureTone === 'bear') || (side === 'SHORT' && pressureTone === 'bull')) score -= 4;

            const tz = timeZones[Math.min(index, Math.max(0, timeZones.length - 1))];
            const reason = side === 'LONG'
                ? `${band.zone} ${band.level} support retest`
                : `${band.zone} ${band.level} resistance retest`;

            return {
                id: `pred-${band.level}-${side}-${index}`,
                side,
                zone: band.zone,
                level: band.level,
                low: band.price - halfWidth,
                high: band.price + halfWidth,
                confidencePct: Math.max(35, Math.min(96, Math.round(score))),
                etaLabel: tz?.etaLabel || 'N/A',
                reason,
            };
        };

        const predictions = nearestBands.map((band, index) => buildPrediction(band, index));
        const longBest = predictions
            .filter((p) => p.side === 'LONG')
            .sort((a, b) => b.confidencePct - a.confidencePct)[0];
        const shortBest = predictions
            .filter((p) => p.side === 'SHORT')
            .sort((a, b) => b.confidencePct - a.confidencePct)[0];

        const merged = [longBest, shortBest, ...predictions.sort((a, b) => b.confidencePct - a.confidencePct)]
            .filter((p): p is EntryZonePrediction => Boolean(p));

        const unique: EntryZonePrediction[] = [];
        const seen = new Set<string>();
        for (const item of merged) {
            const key = `${item.side}-${item.level}`;
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(item);
            if (unique.length >= 3) break;
        }
        return unique;
    }, [pezChartModel, realtimePrice, indicators?.atr, trendTone, pressureTone, timeZones]);

    React.useEffect(() => {
        if (!settings.enableEntryAudioAlerts) return;
        if (nextEntryPredictions.length === 0) return;

        const current = realtimePrice || pezChartModel?.latestPrice || 0;
        if (!Number.isFinite(current) || current <= 0) return;

        const now = Date.now();
        const thresholdBps = Math.max(1, settings.entryAlertDistanceBps);
        const cooldownMs = Math.max(5, settings.entryAlertCooldownSec) * 1000;

        for (const prediction of nextEntryPredictions) {
            const mid = (prediction.low + prediction.high) / 2;
            if (!Number.isFinite(mid) || mid <= 0) continue;
            const distanceBps = Math.abs((current - mid) / current) * 10000;
            const inZone = current >= prediction.low && current <= prediction.high;
            const nearZone = inZone || distanceBps <= thresholdBps;
            if (!nearZone) continue;

            const key = `${currentSymbol}|${currentTimeframe}|${prediction.side}|${prediction.level}`;
            const lastAt = alertMemoryRef.current[key] || 0;
            if ((now - lastAt) < cooldownMs) continue;

            alertMemoryRef.current[key] = now;
            playEntryAlertTone(prediction.side, inZone);
            const proximityLabel = inZone ? 'inside zone' : `${distanceBps.toFixed(1)} bps`;
            setLastEntryAlertLabel(
                `${prediction.side} ${prediction.zone} ${prediction.level} (${proximityLabel})`
            );
            break;
        }
    }, [
        currentSymbol,
        currentTimeframe,
        realtimePrice,
        nextEntryPredictions,
        pezChartModel?.latestPrice,
        playEntryAlertTone,
        settings.enableEntryAudioAlerts,
        settings.entryAlertCooldownSec,
        settings.entryAlertDistanceBps
    ]);

    const screenerSymbols = React.useMemo(() => {
        const base = Array.isArray(instruments) && instruments.length > 0 ? instruments : DEFAULT_SCREENER_SYMBOLS;
        return base.slice(0, clampInt(settings.screenerSymbolCount, 1, 10));
    }, [instruments, settings.screenerSymbolCount]);

    const screenerHistorySize = React.useMemo(
        () => Math.max(260, settings.majorTrendPeriod * 2, settings.retracementPeriod * 8),
        [settings.majorTrendPeriod, settings.retracementPeriod]
    );

    const { data: screenerRows = [] } = useQuery({
        queryKey: [
            'pez-screener',
            screenerSymbols.join('|'),
            currentTimeframe,
            settings.enableAdaptiveFibLevels,
            settings.majorTrendPeriod,
            settings.retracementPeriod,
            settings.fibAnalysisSet,
            screenerHistorySize
        ],
        queryFn: async (): Promise<ScreenerRow[]> => {
            const rows = await Promise.all(screenerSymbols.map(async (symbol) => {
                const candles = await fetchHistory(symbol, currentTimeframe, screenerHistorySize);
                if (!candles || candles.length < 35) return null;
                const ind = calculateAllIndicators(candles);
                if (!ind) return null;

                const price = candles[candles.length - 1]?.close || 0;
                const trendDirectionLocal = String(ind.trend?.direction || '').toLowerCase();
                const trend: ScreenerRow['trend'] = trendDirectionLocal.includes('hauss') ? 'Bullish'
                    : trendDirectionLocal.includes('baiss') ? 'Bearish'
                        : 'Sideways';
                const adx = Number(ind.adx?.adx || 0);
                const volatility = classifyVolatility(ind.atr, price);
                const adaptiveFibLocal = settings.enableAdaptiveFibLevels
                    ? computeAdaptiveFibStructure(candles, settings.majorTrendPeriod, settings.fibAnalysisSet, price)
                    : null;
                const fibLevels = (adaptiveFibLocal?.levels as Record<string, number> | undefined)
                    || (ind.fibonacci?.levels as Record<string, number> | undefined);
                const fibNearestLevel = adaptiveFibLocal?.nearestLevel || ind.fibonacci?.nearestLevel;
                const fibRange = fibNearestLevel
                    ? `${settings.enableAdaptiveFibLevels ? 'A' : 'L'}${fibNearestLevel}`
                    : 'N/A';

                const gpA = fibLevels ? getClosestLevelPrice(fibLevels, 0.5) : null;
                const gpB = fibLevels ? getClosestLevelPrice(fibLevels, 0.618) : null;
                const gpLow = gpA != null && gpB != null ? Math.min(gpA, gpB) : null;
                const gpHigh = gpA != null && gpB != null ? Math.max(gpA, gpB) : null;
                const inGoldenPocket = gpLow != null && gpHigh != null && price >= gpLow && price <= gpHigh;
                const retracementProbe = evaluateAdaptiveLookback(candles, clampInt(settings.retracementPeriod, 2, 300));
                const retracementQualified = retracementProbe.touches >= 2 && retracementProbe.confidencePct >= 35;

                const ob = (ind.orderBlocks || []).slice(-3);
                const inBullBlock = ob.some((z: { type: string; low: number; high: number }) => z.type === 'BULLISH' && price >= z.low && price <= z.high);
                const inBearBlock = ob.some((z: { type: string; low: number; high: number }) => z.type === 'BEARISH' && price >= z.low && price <= z.high);
                const buyZone = retracementQualified && ((trend === 'Bullish' && inGoldenPocket) || inBullBlock);
                const sellZone = retracementQualified && ((trend === 'Bearish' && inGoldenPocket) || inBearBlock);
                const trendStrengthScore = Math.round(Math.max(adx, retracementProbe.confidencePct));

                return {
                    symbol,
                    timeframe: currentTimeframe,
                    volatility,
                    trend,
                    fibRange,
                    trendStrength: trendStrengthScore,
                    buyZone,
                    sellZone,
                    price,
                } satisfies ScreenerRow;
            }));
            return rows.filter((row): row is ScreenerRow => row !== null);
        },
        staleTime: 30000,
        refetchInterval: 45000,
    });

    const globalSignal = indicators?.proCombo?.signal as string | undefined;
    const globalSignalLabel = globalSignal === 'BUY' ? 'BULLISH'
        : globalSignal === 'SELL' ? 'BEARISH'
            : 'NEUTRAL';
    const globalSignalClass = globalSignal === 'BUY' ? 'bull'
        : globalSignal === 'SELL' ? 'bear'
            : 'neutral';
    const primaryPrediction = nextEntryPredictions[0] || null;
    const actionableVerdict = React.useMemo(() => {
        const hintSignal = primaryPrediction
            ? (primaryPrediction.side === 'LONG' ? 'BUY' : 'SELL')
            : globalSignal || 'HOLD';
        const priceRef = Number(realtimePrice || pezChartModel?.latestPrice || 0);
        const entryFromZone = primaryPrediction ? (primaryPrediction.low + primaryPrediction.high) / 2 : null;
        const atrSafe = Number(indicators?.atr || 0);
        const stopFromZone = primaryPrediction
            ? (primaryPrediction.side === 'LONG'
                ? primaryPrediction.low - Math.max(atrSafe * 0.7, priceRef * 0.0007)
                : primaryPrediction.high + Math.max(atrSafe * 0.7, priceRef * 0.0007))
            : null;
        const takeFromZone = primaryPrediction
            ? (primaryPrediction.side === 'LONG'
                ? primaryPrediction.high + Math.max(atrSafe * 1.4, priceRef * 0.0012)
                : primaryPrediction.low - Math.max(atrSafe * 1.4, priceRef * 0.0012))
            : null;
        const confidenceHint = primaryPrediction?.confidencePct ?? Number(indicators?.proCombo?.score || 50);
        const pressureBias = ((buyPressurePct - sellPressurePct) / 100);
        const trendBias = Number(indicators?.trend?.bullishPct ?? 50) - 50;
        const reasons = [
            primaryPrediction
                ? `${primaryPrediction.zone} ${primaryPrediction.level} · ${primaryPrediction.reason}`
                : `Global signal: ${globalSignalLabel}`,
            `Pressure ${buyPressurePct}% BUY / ${sellPressurePct}% SELL`,
            `Trend tone: ${trendTone}`
        ];

        return buildTradeVerdict({
            currentPrice: priceRef,
            signalHint: hintSignal,
            confidenceHint,
            atr: atrSafe,
            trendBias,
            pressureBias,
            entryHint: entryFromZone,
            stopLossHint: stopFromZone,
            takeProfitHint: takeFromZone,
            reasons,
            timeframe: currentTimeframe,
            horizonOverride: primaryPrediction?.etaLabel ? `ETA ${primaryPrediction.etaLabel}` : undefined
        });
    }, [buyPressurePct, currentTimeframe, globalSignal, globalSignalLabel, indicators?.atr, indicators?.proCombo?.score, indicators?.trend?.bullishPct, nextEntryPredictions, pezChartModel?.latestPrice, pressureTone, realtimePrice, sellPressurePct, trendTone]);

    const filteredNav = React.useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return NAV_ITEMS;
        return NAV_ITEMS.filter((item) => (
            item.label.toLowerCase().includes(query) || item.tags.some((tag) => tag.toLowerCase().includes(query))
        ));
    }, [search]);

    React.useEffect(() => {
        if (filteredNav.length === 0) return;
        const hasActive = filteredNav.some((item) => item.key === activeSection);
        if (!hasActive) setActiveSection(filteredNav[0].key);
    }, [activeSection, filteredNav]);

    const activeNav = NAV_ITEMS.find((item) => item.key === activeSection) || NAV_ITEMS[0];
    const pezTvSymbol = React.useMemo(
        () => TV_SYMBOL_MAP[currentSymbol] || `OANDA:${String(currentSymbol).replace('/', '')}`,
        [currentSymbol]
    );
    const pezTvInterval = React.useMemo(() => toTradingViewInterval(currentTimeframe), [currentTimeframe]);
    const useModuleIframeTv = activeSection !== 'pez' && isAndroidChrome;
    const moduleTvIframeSrc = React.useMemo(() => {
        if (!useModuleIframeTv) return '';
        const rootTheme = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null;
        const tvTheme = rootTheme === 'light' ? 'light' : 'dark';
        const toolbarbg = tvTheme === 'dark' ? (rootTheme === 'cyber' ? '120b1f' : '1f2937') : 'f1f3f6';
        const studies = encodeURIComponent(JSON.stringify(['Pivot Points Standard@tv-basicstudies']));
        return `https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(pezTvSymbol)}&interval=${encodeURIComponent(pezTvInterval)}&hidesidetoolbar=0&symboledit=0&saveimage=0&toolbarbg=${toolbarbg}&theme=${tvTheme}&style=1&timezone=Etc%2FUTC&studies=${studies}&withdateranges=1&hideideas=1&locale=fr`;
    }, [useModuleIframeTv, pezTvSymbol, pezTvInterval]);

    const moduleTvOverlayLines = React.useMemo((): ModuleTvOverlayLine[] => {
        if (activeSection === 'pez') return [];
        if (!history || history.length < 25) return [];

        const latestPrice = realtimePrice > 0 ? realtimePrice : (history[history.length - 1]?.close || 0);
        if (!Number.isFinite(latestPrice) || latestPrice <= 0) return [];

        const rawLines: Array<Omit<ModuleTvOverlayLine, 'yPct' | 'role' | 'distanceBps'>> = [];
        const pushLine = (
            id: string,
            label: string,
            price: number | null | undefined,
            color: string,
            category: ModuleLineCategory,
            emphasis = false
        ) => {
            const value = Number(price);
            if (!Number.isFinite(value) || value <= 0) return;
            rawLines.push({ id, label, price: value, color, category, emphasis });
        };

        const fibLevels = (adaptiveFib?.levels as Record<string, number> | undefined)
            || (indicators?.fibonacci?.levels as Record<string, number> | undefined);
        const includeFibCore = activeSection === 'retracement'
            || activeSection === 'smart'
            || activeSection === 'technical'
            || activeSection === 'screener';

        if (includeFibCore && fibLevels) {
            const fibCoreRatios = [0.382, 0.5, 0.618, 0.786];
            fibCoreRatios.forEach((ratio) => {
                pushLine(
                    `fib-core-${ratio}`,
                    `Fib ${formatRatioLabel(ratio)}`,
                    getClosestLevelPrice(fibLevels, ratio),
                    ratio === 0.5 || ratio === 0.618 ? 'rgba(52, 211, 153, 0.95)' : 'rgba(56, 189, 248, 0.95)',
                    'fib',
                    ratio === 0.5 || ratio === 0.618
                );
            });
        }

        if (activeSection === 'retracement') {
            fibStats
                .slice(0, 8)
                .forEach((stat) => {
                    pushLine(
                        `retrace-${stat.zone}-${stat.level}`,
                        `${stat.zone} ${stat.level}`,
                        stat.price,
                        ZONE_COLORS[stat.zone].line,
                        'fib',
                        stat.hasStar
                    );
                });
        }

        const pivotPoints = indicators?.pivotPoints as
            | { pivot?: number; r1?: number; r2?: number; s1?: number; s2?: number }
            | undefined;
        const includePivots = activeSection === 'retracement'
            || activeSection === 'screener'
            || activeSection === 'smart'
            || activeSection === 'technical';
        if (includePivots && pivotPoints) {
            pushLine('pivot-p', 'Pivot P', pivotPoints.pivot, '#fbbf24', 'pivot', true);
            pushLine('pivot-r1', 'R1', pivotPoints.r1, '#f87171', 'pivot');
            pushLine('pivot-r2', 'R2', pivotPoints.r2, '#ef4444', 'pivot');
            pushLine('pivot-s1', 'S1', pivotPoints.s1, '#22c55e', 'pivot');
            pushLine('pivot-s2', 'S2', pivotPoints.s2, '#16a34a', 'pivot');
        }

        if (activeSection === 'screener' || activeSection === 'technical') {
            pushLine('vwap-session', 'VWAP', Number(indicators?.vwapSession ?? indicators?.vwap), '#38bdf8', 'vwap', true);
            pushLine('vp-poc', 'POC', Number(indicators?.volumeProfile?.poc), '#e879f9', 'volume', true);
            pushLine('vp-vah', 'VAH', Number(indicators?.volumeProfile?.vah), '#fb923c', 'volume');
            pushLine('vp-val', 'VAL', Number(indicators?.volumeProfile?.val), '#34d399', 'volume');
        }

        if (activeSection === 'smart') {
            const atr = Number(indicators?.atr || 0);
            if (atr > 0) {
                pushLine('smart-break-up', 'Breakout+ATR', latestPrice + (atr * 1.2), '#22c55e', 'breakout', true);
                pushLine('smart-break-down', 'Breakout-ATR', latestPrice - (atr * 1.2), '#ef4444', 'breakout', true);
            }
            (indicators?.orderBlocks || [])
                .slice(-3)
                .forEach((zone: { type?: string; low?: number; high?: number }, index: number) => {
                    const tone = zone.type === 'BULLISH' ? '#34d399' : '#f87171';
                    const tag = zone.type === 'BULLISH' ? 'Bull OB' : 'Bear OB';
                    pushLine(`smart-ob-h-${index}`, `${tag} High`, zone.high, tone, 'orderblock');
                    pushLine(`smart-ob-l-${index}`, `${tag} Low`, zone.low, tone, 'orderblock');
                });
        }

        if (activeSection === 'oscillator') {
            pushLine('osc-bb-upper', 'BB Upper', Number(indicators?.bbUpper), '#fb7185', 'band');
            pushLine('osc-bb-middle', 'BB Mid', Number(indicators?.bbMiddle), '#93c5fd', 'band', true);
            pushLine('osc-bb-lower', 'BB Lower', Number(indicators?.bbLower), '#2dd4bf', 'band');
            pushLine('osc-ema21', 'EMA 21', Number(indicators?.ema21), '#38bdf8', 'trend');
        }

        if (activeSection === 'technical') {
            const st = indicators?.supertrend as { signal?: string; value?: number } | undefined;
            const stColor = st?.signal === 'BUY' ? '#22c55e' : '#ef4444';
            pushLine('tech-supertrend', `Supertrend ${st?.signal || ''}`.trim(), Number(st?.value), stColor, 'trend', true);
            pushLine('tech-ema50', 'EMA 50', Number(indicators?.ema50), '#6366f1', 'trend');
            pushLine('tech-ema200', 'EMA 200', Number(indicators?.ema200), '#8b5cf6', 'trend');
        }

        const deduped: Array<Omit<ModuleTvOverlayLine, 'yPct' | 'role' | 'distanceBps'>> = [];
        const seen = new Set<string>();
        for (const line of rawLines) {
            const key = `${line.category}-${line.label}-${line.price.toFixed(3)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(line);
        }
        if (deduped.length === 0) return [];

        const selected = deduped
            .sort((a, b) => Math.abs(a.price - latestPrice) - Math.abs(b.price - latestPrice))
            .slice(0, 14);
        const recent = history.slice(-240);
        const lows = recent.map((c) => Number(c.low)).filter((v) => Number.isFinite(v));
        const highs = recent.map((c) => Number(c.high)).filter((v) => Number.isFinite(v));
        const linePrices = selected.map((l) => l.price);
        const minPrice = Math.min(...lows, ...linePrices, latestPrice);
        const maxPrice = Math.max(...highs, ...linePrices, latestPrice);
        if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice)) return [];

        const pad = Math.max((maxPrice - minPrice) * 0.08, latestPrice * 0.0015);
        const yMax = maxPrice + pad;
        const yMin = minPrice - pad;
        const span = Math.max(1e-9, yMax - yMin);
        const neutralBand = Math.max(latestPrice * 0.00035, 1e-9);

        return selected
            .map((line) => {
                const role: ModuleLineRole = Math.abs(line.price - latestPrice) <= neutralBand
                    ? 'neutral'
                    : line.price < latestPrice
                        ? 'support'
                        : 'resistance';
                return {
                    ...line,
                    role,
                    distanceBps: Math.abs((line.price - latestPrice) / latestPrice) * 10000,
                    yPct: ((yMax - line.price) / span) * 100,
                };
            })
            .filter((line) => line.yPct >= -2 && line.yPct <= 102)
            .sort((a, b) => a.yPct - b.yPct);
    }, [
        activeSection,
        history,
        realtimePrice,
        adaptiveFib?.levels,
        indicators?.fibonacci?.levels,
        indicators?.pivotPoints,
        indicators?.vwapSession,
        indicators?.vwap,
        indicators?.volumeProfile,
        indicators?.atr,
        indicators?.bbUpper,
        indicators?.bbMiddle,
        indicators?.bbLower,
        indicators?.ema21,
        indicators?.ema50,
        indicators?.ema200,
        indicators?.supertrend,
        indicators?.orderBlocks,
        fibStats
    ]);

    const moduleOverlayStats = React.useMemo((): ModuleOverlayStats | null => {
        if (activeSection === 'pez') return null;
        if (moduleTvOverlayLines.length === 0) return null;

        const latestPrice = realtimePrice > 0
            ? realtimePrice
            : (history[history.length - 1]?.close || 0);
        if (!Number.isFinite(latestPrice) || latestPrice <= 0) return null;

        const supports = moduleTvOverlayLines
            .filter((line) => line.role === 'support')
            .sort((a, b) => a.distanceBps - b.distanceBps);
        const resistances = moduleTvOverlayLines
            .filter((line) => line.role === 'resistance')
            .sort((a, b) => a.distanceBps - b.distanceBps);
        const neutralCount = moduleTvOverlayLines.filter((line) => line.role === 'neutral').length;

        const nearestSupport = supports[0] || null;
        const nearestResistance = resistances[0] || null;
        const corridorBps = nearestSupport && nearestResistance
            ? Math.abs((nearestResistance.price - nearestSupport.price) / latestPrice) * 10000
            : null;

        const sparkSample = history.slice(-96).map((candle) => Number(candle.close)).filter((v) => Number.isFinite(v));
        if (sparkSample.length > 0 && realtimePrice > 0) {
            sparkSample[sparkSample.length - 1] = realtimePrice;
        }

        let sparkline: ModuleSparklineModel | null = null;
        if (sparkSample.length >= 2) {
            const min = Math.min(...sparkSample);
            const max = Math.max(...sparkSample);
            const span = Math.max(1e-9, max - min);
            const points = sparkSample.map((value, index) => {
                const x = (index / (sparkSample.length - 1)) * 100;
                const y = 34 - (((value - min) / span) * 28);
                return { x, y };
            });
            const path = points
                .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
                .join(' ');
            const areaPath = `${path} L100 36 L0 36 Z`;
            const first = sparkSample[0];
            const last = sparkSample[sparkSample.length - 1];
            const changePct = first > 0 ? ((last - first) / first) * 100 : 0;
            const trendClass: ModuleSparklineModel['trendClass'] = changePct > 0.04 ? 'bull' : changePct < -0.04 ? 'bear' : 'neutral';
            sparkline = { path, areaPath, trendClass, changePct };
        }

        return {
            latestPrice,
            supportCount: supports.length,
            resistanceCount: resistances.length,
            neutralCount,
            nearestSupport,
            nearestResistance,
            corridorBps,
            pressureBias: clampInt(buyPressurePct, 0, 100),
            focusLines: [...moduleTvOverlayLines].sort((a, b) => a.distanceBps - b.distanceBps).slice(0, 6),
            sparkline,
        };
    }, [activeSection, moduleTvOverlayLines, realtimePrice, history, buyPressurePct]);

    const moduleCorridor = React.useMemo(() => {
        if (!moduleOverlayStats?.nearestSupport || !moduleOverlayStats?.nearestResistance) return null;
        const support = moduleOverlayStats.nearestSupport;
        const resistance = moduleOverlayStats.nearestResistance;
        if (support.price >= resistance.price) return null;
        const topPct = Math.min(support.yPct, resistance.yPct);
        const bottomPct = Math.max(support.yPct, resistance.yPct);
        const heightPct = Math.max(3.5, bottomPct - topPct);
        return {
            topPct,
            heightPct,
            low: support.price,
            high: resistance.price,
            widthBps: moduleOverlayStats.corridorBps,
        };
    }, [moduleOverlayStats]);

    React.useEffect(() => {
        if (activeSection !== 'pez' && useModuleIframeTv) {
            return;
        }
        const host = activeSection === 'pez' ? pezTvContainerRef.current : moduleTvContainerRef.current;
        if (!host) return;

        host.innerHTML = '';
        const hostRect = host.getBoundingClientRect();
        const fallbackHeight = activeSection === 'pez' ? 340 : 520;
        const widgetWidth = Math.max(320, Math.floor(hostRect.width || host.clientWidth || 320));
        const widgetHeight = Math.max(280, Math.floor(hostRect.height || host.clientHeight || fallbackHeight));
        const widgetRoot = document.createElement('div');
        widgetRoot.className = 'tradingview-widget-container';
        widgetRoot.style.width = '100%';
        widgetRoot.style.height = '100%';

        const widgetMount = document.createElement('div');
        widgetMount.className = 'tradingview-widget-container__widget';
        widgetMount.style.width = '100%';
        widgetMount.style.height = '100%';

        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.async = true;
        script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
        const rootTheme = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null;
        const tvTheme = rootTheme === 'light' ? 'light' : 'dark';
        script.text = JSON.stringify({
            autosize: false,
            width: widgetWidth,
            height: widgetHeight,
            symbol: pezTvSymbol,
            interval: pezTvInterval,
            timezone: 'Etc/UTC',
            theme: tvTheme,
            style: '1',
            locale: 'fr',
            allow_symbol_change: false,
            hide_top_toolbar: false,
            hide_legend: false,
            withdateranges: true,
            save_image: false,
            studies: ['Pivot Points Standard@tv-basicstudies'],
            support_host: 'https://www.tradingview.com'
        });

        widgetRoot.appendChild(widgetMount);
        widgetRoot.appendChild(script);
        host.appendChild(widgetRoot);

        return () => {
            host.innerHTML = '';
        };
    }, [activeSection, pezTvInterval, pezTvSymbol, useModuleIframeTv]);

    const renderModuleTradingView = (title: string, description: string, accent: string) => (
        <div className="perspective-panel" style={{ ['--perspective-accent' as string]: accent }}>
            <div className="perspective-panel-head">
                <div className="perspective-title-wrap">
                    <div className="perspective-icon">📈</div>
                    <div>
                        <h3>{title}</h3>
                        <p>{description}</p>
                    </div>
                </div>
                <div className="perspective-live-pill neutral">
                    <span>Niveaux</span>
                    <strong>{moduleTvOverlayLines.length}</strong>
                </div>
            </div>
            <div className="perspective-chip-row">
                <span className="perspective-chip">TV: {pezTvSymbol}</span>
                <span className="perspective-chip">TF: {currentTimeframe}</span>
                <span className="perspective-chip">Price: {formatSymbolPrice(currentSymbol, realtimePrice || 0)}</span>
            </div>
            <div className="module-tv-stage" data-section={activeSection}>
                <div className="module-tv-tools">
                    <button
                        type="button"
                        className="ari-pez-tv-tool-btn"
                        onClick={() => setShowModuleInsights((prev) => !prev)}
                    >
                        {showModuleInsights ? 'Masquer détails' : 'Afficher détails'}
                    </button>
                    <button
                        type="button"
                        className="ari-pez-tv-tool-btn"
                        onClick={() => setShowModuleOverlay((prev) => !prev)}
                    >
                        {showModuleOverlay ? 'Masquer lignes techniques' : 'Afficher lignes techniques'}
                    </button>
                    <div className={`ari-pez-tv-realtime ${pezTickAgeMs != null && pezTickAgeMs <= LIVE_TICK_FRESH_MS ? 'fresh' : 'stale'}`}>
                        <span>{formatSymbolPrice(currentSymbol, realtimePrice || 0)}</span>
                        <small>{formatClockWithMs(pezLastTickTs)}</small>
                        <strong>{pezTickAgeMs != null ? `${pezTickAgeMs} ms` : '—'}</strong>
                    </div>
                </div>
                {useModuleIframeTv ? (
                    <iframe
                        title={`TradingView ${activeSection}`}
                        src={moduleTvIframeSrc}
                        className="chart-tv-iframe-fallback"
                        allowFullScreen
                    />
                ) : (
                    <div ref={moduleTvContainerRef} className="chart-tv-host" />
                )}
                {showModuleOverlay && moduleCorridor && (
                    <div
                        className="module-tv-corridor"
                        style={{ top: `${moduleCorridor.topPct}%`, height: `${moduleCorridor.heightPct}%` }}
                    >
                        <span>
                            Zone {formatSymbolPrice(currentSymbol, moduleCorridor.low)} - {formatSymbolPrice(currentSymbol, moduleCorridor.high)}
                            {' · '}
                            {formatBps(moduleCorridor.widthBps)}
                        </span>
                    </div>
                )}
                {showModuleOverlay && moduleTvOverlayLines.length > 0 && (
                    <div className="chart-tv-level-overlay">
                        {moduleTvOverlayLines.map((line) => (
                            <div
                                key={line.id}
                                className={`chart-tv-level-line ${line.emphasis ? 'emphasis' : ''} ${line.role}`}
                                data-category={line.category}
                                style={{ top: `${line.yPct}%`, borderTopColor: line.color, borderTopWidth: line.emphasis ? '2px' : '1.5px' }}
                            >
                                <span className="chart-tv-level-tag" style={{ color: line.color, borderColor: line.color }}>
                                    {line.label} · {formatSymbolPrice(currentSymbol, line.price)}
                                    <small>{line.role.toUpperCase()} · {formatBps(line.distanceBps)}</small>
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            {showModuleInsights && (
                <>
                    <div className="module-tv-brief">
                        <div className={`module-tv-spark ${moduleOverlayStats?.sparkline?.trendClass || 'neutral'}`}>
                            <div className="module-tv-spark-head">
                                <strong>{activeSection !== 'pez' ? MODULE_SECTION_META[activeSection].icon : '📈'} {activeSection !== 'pez' ? MODULE_SECTION_META[activeSection].microLabel : 'Module'}</strong>
                                <span>{moduleOverlayStats?.sparkline ? `${moduleOverlayStats.sparkline.changePct >= 0 ? '+' : ''}${moduleOverlayStats.sparkline.changePct.toFixed(2)}%` : '—'}</span>
                            </div>
                            {moduleOverlayStats?.sparkline ? (
                                <svg viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
                                    <path className="spark-area" d={moduleOverlayStats.sparkline.areaPath} />
                                    <path className="spark-line" d={moduleOverlayStats.sparkline.path} />
                                </svg>
                            ) : (
                                <div className="module-tv-spark-empty">Pas de donnees sparkline</div>
                            )}
                        </div>
                        <div className="module-tv-metric-grid">
                            <div className="module-tv-metric">
                                <span>Support Proche</span>
                                <strong>{moduleOverlayStats?.nearestSupport ? formatSymbolPrice(currentSymbol, moduleOverlayStats.nearestSupport.price) : '—'}</strong>
                                <small>{moduleOverlayStats?.nearestSupport ? formatBps(moduleOverlayStats.nearestSupport.distanceBps) : 'N/A'}</small>
                            </div>
                            <div className="module-tv-metric">
                                <span>Resistance Proche</span>
                                <strong>{moduleOverlayStats?.nearestResistance ? formatSymbolPrice(currentSymbol, moduleOverlayStats.nearestResistance.price) : '—'}</strong>
                                <small>{moduleOverlayStats?.nearestResistance ? formatBps(moduleOverlayStats.nearestResistance.distanceBps) : 'N/A'}</small>
                            </div>
                            <div className="module-tv-metric">
                                <span>Largeur Zone</span>
                                <strong>{formatBps(moduleOverlayStats?.corridorBps)}</strong>
                                <small>{moduleOverlayStats ? `${moduleOverlayStats.supportCount}S / ${moduleOverlayStats.resistanceCount}R / ${moduleOverlayStats.neutralCount}N` : 'N/A'}</small>
                            </div>
                            <div className="module-tv-metric pressure">
                                <span>Pression Marche</span>
                                <strong>{moduleOverlayStats ? `${moduleOverlayStats.pressureBias}% Buy` : '—'}</strong>
                                <div className="module-tv-pressure-track">
                                    <div className="module-tv-pressure-buy" style={{ width: `${moduleOverlayStats?.pressureBias ?? 50}%` }} />
                                </div>
                                <small>{moduleOverlayStats ? `${100 - moduleOverlayStats.pressureBias}% Sell` : 'N/A'}</small>
                            </div>
                        </div>
                    </div>
                    {moduleOverlayStats && moduleOverlayStats.focusLines.length > 0 && (
                        <div className="module-tv-line-ladder">
                            {moduleOverlayStats.focusLines.map((line) => (
                                <div key={`ladder-${line.id}`} className={`module-tv-line-chip ${line.role}`}>
                                    <span>{line.label}</span>
                                    <strong>{formatSymbolPrice(currentSymbol, line.price)}</strong>
                                    <small>{formatBps(line.distanceBps)}</small>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );

    const renderPEZSection = () => (
        <>
            <div className="perspective-panel" style={{ ['--perspective-accent' as string]: activeNav.accent }}>
                <div className="perspective-panel-head">
                    <div className="perspective-title-wrap">
                        <div className="perspective-icon">🧠</div>
                        <div>
                            <h3>AriAlgo Adaptive Fibonacci Engine</h3>
                            <p>Le moteur teste plusieurs lookbacks et sélectionne la période la plus robuste statistiquement.</p>
                        </div>
                    </div>
                    <div className={`perspective-live-pill ${trendTone}`}>
                        <span>Trend</span>
                        <strong>{trendDirection || 'NEUTRE'}</strong>
                    </div>
                </div>
                <p className="perspective-description">
                    AriAlgo Entry Zones applique une logique adaptative: les niveaux Fibonacci, les zones S/R et les time-zones
                    sont recalculés en fonction du comportement historique réel de {currentSymbol}.
                </p>

                <div className="perspective-chip-row">
                    <span className="perspective-chip">
                        S/R: {settings.enableAdaptiveSrLookback ? (adaptiveResult ? `${adaptiveResult.period} (${adaptiveResult.confidencePct}%)` : 'warming up') : `manual ${settings.manualSrLookback}`}
                    </span>
                    <span className="perspective-chip">Fib Set: {settings.fibAnalysisSet} ({ANALYSIS_SET_LABELS[settings.fibAnalysisSet]})</span>
                    <span className="perspective-chip">
                        Fib Nearest: {adaptiveFib?.nearestLevel ? `${adaptiveFib.nearestLevel} @ ${formatSymbolPrice(currentSymbol, adaptiveFib.nearestPrice || realtimePrice)}` : 'N/A'}
                    </span>
                    <span className="perspective-chip">
                        Time: {settings.showTimeZone ? (settings.enableTimeAdaptiveLookback ? (timeAdaptiveResult ? `${timeAdaptiveResult.period} (${timeAdaptiveResult.confidencePct}%)` : 'warming up') : `manual ${settings.manualTimeLookback}`) : 'off'}
                    </span>
                    <span className="perspective-chip">Trend Strength: {trendStrength || 'N/A'}</span>
                    <span className="perspective-chip soft">Symbol: {currentSymbol}</span>
                    <span className="perspective-chip soft">Timeframe: {currentTimeframe}</span>
                </div>
            </div>

            <div className="perspective-panel" style={{ ['--perspective-accent' as string]: '#22d3ee' }}>
                <div className="perspective-panel-head">
                    <div className="perspective-title-wrap">
                        <div className="perspective-icon">📉</div>
                        <div>
                            <h3>AriAlgo Perfect Entry Map</h3>
                            <p>Graphique de zones d’entrée avec overlay NZ/CZ, ligne live et bande parfaite (0.5 - 0.618).</p>
                        </div>
                    </div>
                </div>

                {!pezChartModel ? (
                    <div className="perspective-empty">Données insuffisantes pour afficher la cartographie AriAlgo Entry Zone.</div>
                ) : (
                    <div className={`ari-pez-chart-layout ${pezLegendCollapsed ? 'expanded' : ''}`}>
                        <div className="ari-pez-chart-canvas">
                            <div className="ari-pez-tv-stage">
                                <div className="ari-pez-tv-tools">
                                    <button
                                        type="button"
                                        className="ari-pez-tv-tool-btn"
                                        onClick={() => setPezLegendCollapsed((prev) => !prev)}
                                    >
                                        {pezLegendCollapsed ? 'Afficher zones' : 'Masquer zones'}
                                    </button>
                                    <button
                                        type="button"
                                        className="ari-pez-tv-tool-btn"
                                        onClick={() => setShowPezOverlay((prev) => !prev)}
                                    >
                                        {showPezOverlay ? 'Masquer overlay' : 'Afficher overlay'}
                                    </button>
                                    <div className={`ari-pez-tv-realtime ${pezTickAgeMs != null && pezTickAgeMs <= LIVE_TICK_FRESH_MS ? 'fresh' : 'stale'}`}>
                                        <span>{formatSymbolPrice(currentSymbol, realtimePrice || pezChartModel?.latestPrice || 0)}</span>
                                        <small>{formatClockWithMs(pezLastTickTs)}</small>
                                        <strong>{pezTickAgeMs != null ? `${pezTickAgeMs} ms` : '—'}</strong>
                                    </div>
                                </div>
                                <div ref={pezTvContainerRef} className="chart-tv-host" />
                                {showPezOverlay && pezChartModel.entryBand && (
                                    <div
                                        className="ari-pez-tv-entry-zone"
                                        style={{
                                            top: `${pezChartModel.entryBand.topPct}%`,
                                            height: `${pezChartModel.entryBand.heightPct}%`
                                        }}
                                    >
                                        <span>Entry Zone</span>
                                    </div>
                                )}
                                {showPezOverlay && pezChartModel.overlayLines.length > 0 && (
                                    <div className="chart-tv-level-overlay">
                                        {pezChartModel.overlayLines.map((line) => {
                                            const color = ZONE_COLORS[line.zone].line;
                                            return (
                                                <div
                                                    key={line.id}
                                                    className="chart-tv-level-line"
                                                    style={{ top: `${line.yPct}%`, borderTopColor: color, borderTopWidth: '1.8px' }}
                                                >
                                                    <span className="chart-tv-level-tag" style={{ color, borderColor: color }}>
                                                        {line.zone} {line.level} · {line.confidencePct}% · {formatSymbolPrice(currentSymbol, line.price)}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                        {!pezLegendCollapsed && (
                            <div className="ari-pez-legend">
                                <div className="ari-pez-legend-title">Live Entry Intelligence</div>
                                {pezChartModel.entryBand ? (
                                    <div className="ari-pez-entry-pill">
                                        Entry Zone:
                                        {' '}
                                        {formatSymbolPrice(currentSymbol, pezChartModel.entryBand.low)}
                                        {' '}
                                        →
                                        {' '}
                                        {formatSymbolPrice(currentSymbol, pezChartModel.entryBand.high)}
                                    </div>
                                ) : (
                                    <div className="ari-pez-entry-pill" style={{ borderColor: 'rgba(71,85,105,0.82)', color: '#c3d2ea' }}>
                                        Entry Zone: pending
                                    </div>
                                )}

                                <div className="ari-pez-zone-list">
                                    {[...pezChartModel.bands]
                                        .sort((a, b) => Math.abs(a.price - pezChartModel.latestPrice) - Math.abs(b.price - pezChartModel.latestPrice))
                                        .slice(0, 5)
                                        .map((band) => (
                                            <div key={`ari-pez-band-legend-${band.level}`} className="ari-pez-zone-item">
                                                <span style={{ color: ZONE_COLORS[band.zone].line }}>{band.zone} {band.level}</span>
                                                <span>{formatSymbolPrice(currentSymbol, band.price)}</span>
                                                <span>{band.confidencePct}% conf</span>
                                            </div>
                                        ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="perspective-feature-grid">
                <div className="perspective-feature-card">
                    <h4>Dynamic S/R Flip</h4>
                    <p>Zones résistance/support qui changent d’état après un breakout validé.</p>
                </div>
                <div className="perspective-feature-card">
                    <h4>Perfect Time Zones</h4>
                    <p>Projection de fenêtres de volatilité via la séquence Fibonacci.</p>
                </div>
                <div className="perspective-feature-card">
                    <h4>Market Pressure Gauge</h4>
                    <p>Mesure en temps réel de la dominance acheteurs vs vendeurs.</p>
                </div>
            </div>

            <div className="perspective-panel" style={{ ['--perspective-accent' as string]: '#06b6d4' }}>
                <div className="perspective-panel-head">
                    <div className="perspective-title-wrap">
                        <div className="perspective-icon">🔮</div>
                        <div>
                            <h3>Next Entry Zone Predictions</h3>
                            <p>Prévisions des prochaines zones d’entrée selon distance, tendance, pression et time-zones.</p>
                        </div>
                    </div>
                </div>
                {nextEntryPredictions.length === 0 ? (
                    <div className="perspective-empty">Prévisions en attente de suffisamment de structure de marché.</div>
                ) : (
                    <div className="ari-pez-prediction-grid">
                        {nextEntryPredictions.map((prediction) => (
                            <div
                                key={prediction.id}
                                className={`ari-pez-prediction-card ${prediction.side === 'LONG' ? 'long' : 'short'}`}
                            >
                                <div className="ari-pez-prediction-head">
                                    <span>{prediction.side}</span>
                                    <strong>{prediction.confidencePct}%</strong>
                                </div>
                                <div className="ari-pez-prediction-price">
                                    {formatSymbolPrice(currentSymbol, prediction.low)} → {formatSymbolPrice(currentSymbol, prediction.high)}
                                </div>
                                <div className="ari-pez-prediction-meta">
                                    <span>{prediction.zone} {prediction.level}</span>
                                    <span>ETA {prediction.etaLabel}</span>
                                </div>
                                <div className="ari-pez-prediction-reason">{prediction.reason}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {settings.showMarketPressureGauge ? (
                <div className="perspective-panel" style={{ ['--perspective-accent' as string]: '#22d3ee' }}>
                    <div className="perspective-panel-head">
                        <div className="perspective-title-wrap">
                            <div className="perspective-icon">📊</div>
                            <div>
                                <h3>Market Pressure Gauge</h3>
                                <p>Confirmation instantanée du momentum et points d’essoufflement potentiels.</p>
                            </div>
                        </div>
                        <div className={`perspective-live-pill ${pressureTone}`}>
                            <span>Pressure</span>
                            <strong>{pressureTone === 'bull' ? 'BUY' : pressureTone === 'bear' ? 'SELL' : 'BALANCED'}</strong>
                        </div>
                    </div>
                    <div style={{ marginTop: '10px', border: '1px solid rgba(56, 80, 119, 0.72)', borderRadius: '10px', padding: '10px', background: 'rgba(8, 16, 28, 0.8)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px', color: '#d6e3fb' }}>
                            <span>Buy Power {buyPressurePct}%</span>
                            <span>Sell Power {sellPressurePct}%</span>
                        </div>
                        <div style={{ height: '12px', borderRadius: '999px', overflow: 'hidden', background: 'rgba(255,255,255,0.08)', display: 'flex' }}>
                            <div style={{ width: `${buyPressurePct}%`, background: 'linear-gradient(90deg, rgba(0,192,135,0.9), rgba(34,197,94,0.9))' }} />
                            <div style={{ width: `${sellPressurePct}%`, background: 'linear-gradient(90deg, rgba(244,63,94,0.9), rgba(239,68,68,0.9))' }} />
                        </div>
                    </div>
                </div>
            ) : (
                <div className="perspective-panel" style={{ ['--perspective-accent' as string]: '#475569' }}>
                    <div className="perspective-empty">
                        Market Pressure Gauge désactivé (active-le dans les réglages live).
                    </div>
                </div>
            )}

            <div className="system-explainer-grid">
                <div className="system-explainer-card">
                    <h3>Support/Resistance Flip</h3>
                    {flipZones.length === 0 ? (
                        <div className="perspective-empty">Zones de flip en attente de structure de marché.</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {flipZones.map((zone) => (
                                <div key={zone.id} style={{
                                    border: `1px solid ${zone.tone === 'bull' ? 'rgba(34,197,94,0.6)' : 'rgba(244,63,94,0.6)'}`,
                                    borderRadius: '8px',
                                    padding: '8px',
                                    background: zone.tone === 'bull' ? 'rgba(16,54,36,0.5)' : 'rgba(62,25,35,0.5)'
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '12px' }}>
                                        <strong>{zone.from} → {zone.to}</strong>
                                        <span>{zone.confidencePct}%</span>
                                    </div>
                                    <div style={{ fontSize: '11px', marginTop: '2px' }}>
                                        Zone: {formatSymbolPrice(currentSymbol, zone.low)} - {formatSymbolPrice(currentSymbol, zone.high)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <div className="system-explainer-card">
                    <h3>Perfect Time Zones</h3>
                    {settings.showTimeZone ? (
                        <div style={{ display: 'grid', gap: '8px' }}>
                            {timeZones.slice(0, 6).map((zone) => (
                                <div key={`tz-${zone.step}`} style={{ border: '1px solid rgba(56, 80, 119, 0.7)', borderRadius: '8px', padding: '8px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                                        <strong>Fib T+{zone.step}</strong>
                                        <span>{zone.confidencePct}%</span>
                                    </div>
                                    <div style={{ fontSize: '11px', color: '#a9bfdf', marginTop: '2px' }}>ETA: {zone.etaLabel}</div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="perspective-empty">Time Zones désactivées.</div>
                    )}
                </div>
            </div>

            <div className="perspective-playbook-grid">
                <div className="perspective-playbook long">
                    <h4>Buy Signals (Long)</h4>
                    <p>
                        Confirmer une dynamique haussière, attendre le flip d’une zone rouge en support vert puis un retest
                        de la zone. Privilégier les entrées lorsque la jauge de pression reste orientée acheteurs.
                    </p>
                </div>
                <div className="perspective-playbook short">
                    <h4>Sell Signals (Short)</h4>
                    <p>
                        Confirmer une dynamique baissière, attendre le flip d’une zone verte en résistance rouge puis un retest
                        de la zone. Privilégier les entrées lorsque la pression vendeuse domine.
                    </p>
                </div>
            </div>

            <details className="perspective-accordion" open>
                <summary>Complete Settings Reference — AriAlgo Entry Zones</summary>
                <div className="settings-block">
                    <div className="perspective-table-stack">
                        <SettingTable title="Main Settings" rows={PEZ_MAIN_SETTINGS} />
                        <SettingTable title="Adaptive S/R System" rows={ADAPTIVE_SR_SETTINGS} />
                        <SettingTable title="Adaptive Time System" rows={ADAPTIVE_TIME_SETTINGS} />
                        <SettingTable title="Visibility Settings" rows={PEZ_VISIBILITY_SETTINGS} />
                        <SettingTable title="How to Calculate / Debug" rows={PEZ_DEBUG_SETTINGS} />
                    </div>
                </div>
            </details>
        </>
    );

    const renderRetracementSection = () => (
        <>
            <div className="perspective-panel" style={{ ['--perspective-accent' as string]: '#a78bfa' }}>
                <div className="perspective-panel-head">
                    <div className="perspective-title-wrap">
                        <div className="perspective-icon">🧭</div>
                        <div>
                            <h3>Dual-Pivot Engine</h3>
                            <p>Séparation pivots majeurs (trend) et pivots mineurs (retracements) pour filtrer les vraies zones d’entrée.</p>
                        </div>
                    </div>
                    <div className={`perspective-live-pill ${globalSignalClass}`}>
                        <span>Signal</span>
                        <strong>{globalSignalLabel}</strong>
                    </div>
                </div>
                <p className="perspective-description">
                    Les zones sont classées en NZ1/NZ2 (noise) et CZ1/CZ2/CZ3 (confidence). Chaque zone est enrichie avec
                    le taux de réaction historique et la probabilité de breakout.
                </p>
            </div>

            {renderModuleTradingView(
                'Retracement TradingView',
                'Vue prix + lignes Fibonacci, pivots et zones de confiance retracement.',
                '#a78bfa'
            )}

            <div className="perspective-panel" style={{ ['--perspective-accent' as string]: '#a78bfa' }}>
                <div className="perspective-panel-head">
                    <div className="perspective-title-wrap">
                        <div className="perspective-icon">⭐</div>
                        <div>
                            <h3>Adaptive Fibonacci Confidence Zones</h3>
                            <p>Statistiques historiques réelles sur les niveaux Fibonacci actifs.</p>
                        </div>
                    </div>
                </div>
                {fibStats.length === 0 ? (
                    <div className="perspective-empty">Données insuffisantes pour calculer les zones statistiques.</div>
                ) : (
                    <div className="perspective-table-block" style={{ marginTop: '10px' }}>
                        <h4>Zone Metrics ({currentSymbol})</h4>
                        <table>
                            <thead>
                                <tr>
                                    <th>Zone</th>
                                    <th>Level</th>
                                    <th>Price</th>
                                    <th>Total</th>
                                    <th>Conf%</th>
                                    <th>Breakout%</th>
                                    <th>Star</th>
                                </tr>
                            </thead>
                            <tbody>
                                {fibStats.map((row) => (
                                    <tr key={`fibstat-${row.level}`}>
                                        <td>{row.zone}</td>
                                        <td>{row.level}</td>
                                        <td>{formatSymbolPrice(currentSymbol, row.price)}</td>
                                        <td>{row.touches}</td>
                                        <td>{row.confidencePct}%</td>
                                        <td>{row.breakoutPct}%</td>
                                        <td>{row.hasStar ? '★' : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </>
    );

    const renderScreenerSection = () => (
        <>
            <div className="perspective-panel" style={{ ['--perspective-accent' as string]: '#f59e0b' }}>
                <div className="perspective-panel-head">
                    <div className="perspective-title-wrap">
                        <div className="perspective-icon">📋</div>
                        <div>
                            <h3>AriAlgo Screener — Multi Symbol Dashboard</h3>
                            <p>Surveille jusqu’à 10 symboles / timeframes avec confluence instantanée.</p>
                        </div>
                    </div>
                    <div className="perspective-live-pill neutral">
                        <span>Updated</span>
                        <strong>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</strong>
                    </div>
                </div>
                <p className="perspective-description">
                    Colonnes clés: Volatility, Trend, Fib Range, Trend Strength (ADX), Buy Zone, Sell Zone.
                    Workflow: scanner la confluence puis ouvrir le symbole en analyse détaillée.
                </p>
            </div>

            {renderModuleTradingView(
                'Screener TradingView',
                'Contexte visuel du symbole actif avec lignes confluence (VWAP, pivots, volume profile).',
                '#f59e0b'
            )}

            <div className="perspective-table-block">
                <h4>Live Screener Table ({currentTimeframe})</h4>
                <table>
                    <thead>
                        <tr>
                            <th>Symbol</th>
                            <th>Volatility</th>
                            <th>Trend</th>
                            <th>Fib Range</th>
                            <th>Trend Strength</th>
                            <th>Buy Zone</th>
                            <th>Sell Zone</th>
                        </tr>
                    </thead>
                    <tbody>
                        {screenerRows.map((row) => (
                            <tr key={`screen-${row.symbol}`}>
                                <td>{row.symbol}<br /><span className="nt-price-sub mono-text">{formatSymbolPrice(row.symbol, row.price)}</span></td>
                                <td>
                                    <span className={row.volatility === 'High' ? 'nt-badge-red' : row.volatility === 'Moderate' ? 'nt-badge-yellow' : 'nt-badge-blue'}>
                                        {row.volatility}
                                    </span>
                                </td>
                                <td>
                                    <span className={row.trend === 'Bullish' ? 'nt-badge-green' : row.trend === 'Bearish' ? 'nt-badge-red' : 'nt-badge-yellow'}>
                                        {row.trend}
                                    </span>
                                </td>
                                <td><span className="nt-badge-blue mono-text">{row.fibRange}</span></td>
                                <td><span className="nt-badge-blue mono-text">{row.trendStrength}</span></td>
                                <td>
                                    {row.buyZone ? (
                                        <span className="nt-badge-green">ACTIVE</span>
                                    ) : (
                                        <span className="nt-badge-muted">OFF</span>
                                    )}
                                </td>
                                <td>
                                    {row.sellZone ? (
                                        <span className="nt-badge-red">ACTIVE</span>
                                    ) : (
                                        <span className="nt-badge-muted">OFF</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <details className="perspective-accordion" open>
                <summary>Screener Settings Reference</summary>
                <div className="settings-block">
                    <div className="perspective-table-stack">
                        <SettingTable title="Trend & Adaptive Zone Config" rows={SCREENER_SETTINGS} />
                    </div>
                </div>
            </details>
        </>
    );

    const renderSmartSection = () => (
        <>
            <div className="perspective-panel" style={{ ['--perspective-accent' as string]: '#14b8a6' }}>
                <div className="perspective-panel-head">
                    <div className="perspective-title-wrap">
                        <div className="perspective-icon">⚡</div>
                        <div>
                            <h3>AriAlgo Smart Trading — Breakout Intelligence</h3>
                            <p>Niveaux ajustés à la volatilité, force de breakout notée, zones de re-entry et TP dynamiques.</p>
                        </div>
                    </div>
                </div>
                <div className="perspective-playbook-grid">
                    <div className="perspective-playbook long">
                        <h4>Buy Workflow</h4>
                        <p>Attendre un Break/Strong Break au-dessus résistance, puis retest Teal Reversal Zone pour entrée conservatrice.</p>
                    </div>
                    <div className="perspective-playbook short">
                        <h4>Sell Workflow</h4>
                        <p>Attendre un Break/Strong Break sous support, puis retest Maroon Reversal Zone. TP sur zone grise dynamique.</p>
                    </div>
                </div>
            </div>

            {renderModuleTradingView(
                'Smart TradingView',
                'Lignes breakout ATR, order blocks et pivots pour valider les breaks/retests.',
                '#14b8a6'
            )}

            <details className="perspective-accordion" open>
                <summary>AriAlgo Smart Trading Settings Reference</summary>
                <div className="settings-block">
                    <div className="perspective-table-stack">
                        <SettingTable title="Main + HTF + Zone Settings" rows={SMART_TRADING_SETTINGS} />
                    </div>
                </div>
            </details>
        </>
    );

    const renderOscillatorSection = () => (
        <>
            <div className="perspective-panel" style={{ ['--perspective-accent' as string]: '#fb7185' }}>
                <div className="perspective-panel-head">
                    <div className="perspective-title-wrap">
                        <div className="perspective-icon">🧠</div>
                        <div>
                            <h3>AriAlgo Oscillator Matrix — Statistical Brain</h3>
                            <p>Analyse de centaines de pivots pour identifier les plages d’oscillateur réellement efficaces.</p>
                        </div>
                    </div>
                </div>
                <p className="perspective-description">
                    Le moteur construit des bandes dynamiques overbought/oversold (Peak/Trough Zones) avec Data Decay,
                    puis affiche une matrice de probabilité (Count, Conf%, Avg Drop/Rise, Avg Time).
                </p>
            </div>

            {renderModuleTradingView(
                'Oscillator Context TradingView',
                'Bandes Bollinger + EMA pour contextualiser les zones statistiques de l’oscillateur.',
                '#fb7185'
            )}

            <details className="perspective-accordion" open>
                <summary>AriAlgo Oscillator Matrix Settings Reference</summary>
                <div className="settings-block">
                    <div className="perspective-table-stack">
                        <SettingTable title="Oscillator & Statistical Engine Settings" rows={OSCILLATOR_SETTINGS} />
                    </div>
                </div>
            </details>
        </>
    );

    const renderTechnicalSection = () => (
        <>
            <div className="perspective-panel" style={{ ['--perspective-accent' as string]: '#60a5fa' }}>
                <div className="perspective-panel-head">
                    <div className="perspective-title-wrap">
                        <div className="perspective-icon">🛰️</div>
                        <div>
                            <h3>AriAlgo Technical Suite — All-in-One AI Toolkit</h3>
                            <p>Dashboard unifié: SMC/ICT, Fibonacci auto, forecast IA, trend finder, probabilistic highs/lows.</p>
                        </div>
                    </div>
                </div>
                <div className="perspective-feature-grid">
                    <div className="perspective-feature-card">
                        <h4>SMC / ICT</h4>
                        <p>BOS, CHOCH, Order Blocks, FVG, Killzones et Daily Bias.</p>
                    </div>
                    <div className="perspective-feature-card">
                        <h4>Predictive Tools</h4>
                        <p>Forecast + AI-Threshold + Trend Finder adaptatif.</p>
                    </div>
                    <div className="perspective-feature-card">
                        <h4>Auto Levels</h4>
                        <p>Fibonacci retracement/extension + support/résistance automatiques.</p>
                    </div>
                </div>
            </div>

            {renderModuleTradingView(
                'Technical Suite TradingView',
                'Supertrend, EMA, VWAP, pivots et volume profile sur le chart actif.',
                '#60a5fa'
            )}

            <details className="perspective-accordion" open>
                <summary>Technical Analysis Settings Reference</summary>
                <div className="settings-block">
                    <div className="perspective-table-stack">
                        <SettingTable title="AI-Powered Algorithm Features" rows={TECHNICAL_SUITE_SETTINGS} />
                    </div>
                </div>
            </details>
        </>
    );

    const renderSection = () => {
        switch (activeSection) {
            case 'pez':
                return renderPEZSection();
            case 'retracement':
                return renderRetracementSection();
            case 'screener':
                return renderScreenerSection();
            case 'smart':
                return renderSmartSection();
            case 'oscillator':
                return renderOscillatorSection();
            case 'technical':
                return renderTechnicalSection();
            default:
                return renderPEZSection();
        }
    };

    const activeIndex = NAV_ITEMS.findIndex((item) => item.key === activeNav.key);
    const prevNav = NAV_ITEMS[(activeIndex - 1 + NAV_ITEMS.length) % NAV_ITEMS.length];
    const nextNav = NAV_ITEMS[(activeIndex + 1) % NAV_ITEMS.length];
    const pulseLabel = pressureTone === 'bull'
        ? 'Buy pressure dominant'
        : pressureTone === 'bear'
            ? 'Sell pressure dominant'
            : 'Pressure balanced';

    return (
        <div className="card perspective-card perspective-card-full perspective-social-card">
            <div className="perspective-hub perspective-social-hub">
                <aside className="perspective-sidebar nt-panel perspective-social-sidebar">
                    <div className="perspective-sidebar-brand nt-panel">
                        <div className="brand-icon">🛰️</div>
                        <div>
                            <strong>AriAlgo Network Desk</strong>
                            <span>Social interface for live quant modules</span>
                        </div>
                    </div>

                    <div className="perspective-search">
                        <input
                            className="nt-input"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search module / concept..."
                        />
                    </div>

                    <div className="perspective-nav-group nt-panel">
                        <h4>Channels</h4>
                        <div className="perspective-list">
                            {filteredNav.map((item) => (
                                <button
                                    key={item.key}
                                    className={`perspective-nav-btn ${activeSection === item.key ? 'active' : ''}`}
                                    style={{ ['--perspective-accent' as string]: item.accent }}
                                    onClick={() => setActiveSection(item.key)}
                                >
                                    <span>{item.icon}</span>
                                    <span>{item.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="perspective-nav-group nt-panel">
                        <h4>Live Snapshot</h4>
                        <ul>
                            <li>Symbol: {currentSymbol}</li>
                            <li>Timeframe: {currentTimeframe}</li>
                            <li>Price: {formatSymbolPrice(currentSymbol, realtimePrice)}</li>
                            <li>S/R: {settings.enableAdaptiveSrLookback ? (adaptiveResult ? `${adaptiveResult.period} (${adaptiveResult.confidencePct}%)` : 'warming up') : `manual ${settings.manualSrLookback}`}</li>
                            <li>Time: {settings.showTimeZone ? (settings.enableTimeAdaptiveLookback ? (timeAdaptiveResult ? `${timeAdaptiveResult.period} (${timeAdaptiveResult.confidencePct}%)` : 'warming up') : `manual ${settings.manualTimeLookback}`) : 'off'}</li>
                            <li>Fib Set: {settings.fibAnalysisSet}</li>
                            <li>Alert: {settings.enableEntryAudioAlerts ? `ON (${settings.entryAlertDistanceBps} bps)` : 'OFF'}</li>
                            <li>Last Alert: {lastEntryAlertLabel}</li>
                        </ul>
                    </div>

                    <div className="perspective-nav-group nt-panel">
                        <h4>Live Settings</h4>
                        <div className="nt-sidebar-form">
                            <label className="nt-field">
                                Fibonacci Period
                                <input
                                    type="number"
                                    min={21}
                                    max={200}
                                    value={settings.fibPeriod}
                                    onChange={(e) => updateNumberSetting('fibPeriod', e.target.value, 21, 200)}
                                />
                            </label>
                            <label className="nt-field">
                                Fibonacci Analysis Set
                                <select
                                    value={settings.fibAnalysisSet}
                                    onChange={(e) => updateSetting('fibAnalysisSet', e.target.value as AnalysisSetKey)}
                                >
                                    <option value="SET1">SET1 - {ANALYSIS_SET_LABELS.SET1}</option>
                                    <option value="SET2">SET2 - {ANALYSIS_SET_LABELS.SET2}</option>
                                    <option value="SET3">SET3 - {ANALYSIS_SET_LABELS.SET3}</option>
                                    <option value="SET4">SET4 - {ANALYSIS_SET_LABELS.SET4}</option>
                                </select>
                            </label>
                            <label className="nt-field-check">
                                <input
                                    type="checkbox"
                                    checked={settings.enableAdaptiveSrLookback}
                                    onChange={(e) => updateSetting('enableAdaptiveSrLookback', e.target.checked)}
                                />
                                Enable Adaptive S/R Lookback
                            </label>
                            <div className="nt-grid-2">
                                <label className="nt-field">
                                    S/R Min
                                    <input
                                        type="number"
                                        min={10}
                                        max={300}
                                        value={settings.minSrLookbackToTest}
                                        onChange={(e) => updateNumberSetting('minSrLookbackToTest', e.target.value, 10, 300)}
                                    />
                                </label>
                                <label className="nt-field">
                                    S/R Max
                                    <input
                                        type="number"
                                        min={10}
                                        max={300}
                                        value={settings.maxSrLookbackToTest}
                                        onChange={(e) => updateNumberSetting('maxSrLookbackToTest', e.target.value, 10, 300)}
                                    />
                                </label>
                            </div>
                            <label className="nt-field">
                                Manual S/R Lookback
                                <input
                                    type="number"
                                    min={1}
                                    max={300}
                                    value={settings.manualSrLookback}
                                    onChange={(e) => updateNumberSetting('manualSrLookback', e.target.value, 1, 300)}
                                />
                            </label>
                            <label className="nt-field-check">
                                <input
                                    type="checkbox"
                                    checked={settings.showTimeZone}
                                    onChange={(e) => updateSetting('showTimeZone', e.target.checked)}
                                />
                                Show Time Zones
                            </label>
                            <label className="nt-field-check">
                                <input
                                    type="checkbox"
                                    checked={settings.enableTimeAdaptiveLookback}
                                    onChange={(e) => updateSetting('enableTimeAdaptiveLookback', e.target.checked)}
                                />
                                Enable Time Adaptive Lookback
                            </label>
                            <div className="nt-grid-2">
                                <label className="nt-field">
                                    Time Min
                                    <input
                                        type="number"
                                        min={10}
                                        max={300}
                                        value={settings.minTimeLookbackToTest}
                                        onChange={(e) => updateNumberSetting('minTimeLookbackToTest', e.target.value, 10, 300)}
                                    />
                                </label>
                                <label className="nt-field">
                                    Time Max
                                    <input
                                        type="number"
                                        min={10}
                                        max={300}
                                        value={settings.maxTimeLookbackToTest}
                                        onChange={(e) => updateNumberSetting('maxTimeLookbackToTest', e.target.value, 10, 300)}
                                    />
                                </label>
                            </div>
                            <label className="nt-field">
                                Manual Time Lookback
                                <input
                                    type="number"
                                    min={1}
                                    max={300}
                                    value={settings.manualTimeLookback}
                                    onChange={(e) => updateNumberSetting('manualTimeLookback', e.target.value, 1, 300)}
                                />
                            </label>
                            <label className="nt-field-check">
                                <input
                                    type="checkbox"
                                    checked={settings.showMarketPressureGauge}
                                    onChange={(e) => updateSetting('showMarketPressureGauge', e.target.checked)}
                                />
                                Show Market Pressure Gauge
                            </label>
                            <label className="nt-field-check">
                                <input
                                    type="checkbox"
                                    checked={settings.enableAdaptiveFibLevels}
                                    onChange={(e) => updateSetting('enableAdaptiveFibLevels', e.target.checked)}
                                />
                                Enable Adaptive Fib Levels (Screener)
                            </label>
                            <div className="nt-grid-2">
                                <label className="nt-field">
                                    Major Trend
                                    <input
                                        type="number"
                                        min={2}
                                        max={1404}
                                        value={settings.majorTrendPeriod}
                                        onChange={(e) => updateNumberSetting('majorTrendPeriod', e.target.value, 2, 1404)}
                                    />
                                </label>
                                <label className="nt-field">
                                    Retracement
                                    <input
                                        type="number"
                                        min={2}
                                        max={300}
                                        value={settings.retracementPeriod}
                                        onChange={(e) => updateNumberSetting('retracementPeriod', e.target.value, 2, 300)}
                                    />
                                </label>
                            </div>
                            <label className="nt-field">
                                Screener Symbols
                                <input
                                    type="number"
                                    min={1}
                                    max={10}
                                    value={settings.screenerSymbolCount}
                                    onChange={(e) => updateNumberSetting('screenerSymbolCount', e.target.value, 1, 10)}
                                />
                            </label>
                            <label className="nt-field-check">
                                <input
                                    type="checkbox"
                                    checked={settings.enableEntryAudioAlerts}
                                    onChange={(e) => updateSetting('enableEntryAudioAlerts', e.target.checked)}
                                />
                                Enable Entry Audio Alerts
                            </label>
                            <div className="nt-grid-2">
                                <label className="nt-field">
                                    Alert Distance (bps)
                                    <input
                                        type="number"
                                        min={1}
                                        max={150}
                                        value={settings.entryAlertDistanceBps}
                                        onChange={(e) => updateNumberSetting('entryAlertDistanceBps', e.target.value, 1, 150)}
                                    />
                                </label>
                                <label className="nt-field">
                                    Alert Cooldown (sec)
                                    <input
                                        type="number"
                                        min={5}
                                        max={180}
                                        value={settings.entryAlertCooldownSec}
                                        onChange={(e) => updateNumberSetting('entryAlertCooldownSec', e.target.value, 5, 180)}
                                    />
                                </label>
                            </div>
                            <div className="nt-form-note">
                                Note: certains navigateurs exigent une interaction utilisateur avant de jouer le son.
                            </div>
                            <button
                                type="button"
                                className="perspective-nav-btn"
                                onClick={() => setSettings(DEFAULT_PEZ_SETTINGS)}
                            >
                                <span>↺</span>
                                <span>Reset Default Settings</span>
                            </button>
                        </div>
                    </div>
                </aside>

                <div className="perspective-content perspective-content-social">
                    <div className="perspective-content-head">
                        <div>
                            <h2>{activeNav.icon} {activeNav.label}</h2>
                            <p>
                                Flux d'analyse live avec zones adaptatives, confluence statistique et exécution orientée setup.
                            </p>
                        </div>
                        <div className={`perspective-global-signal ${globalSignalClass}`}>
                            <span>GLOBAL SIGNAL</span>
                            <strong>{globalSignalLabel}</strong>
                        </div>
                    </div>

                    <TradeActionCard
                        title="Actionable Trade Verdict"
                        modelLabel={`AriAlgo ${activeNav.label}`}
                        symbol={currentSymbol}
                        verdict={actionableVerdict}
                    />

                    <div className="perspective-social-composer nt-panel">
                        <div className="perspective-social-avatar" aria-hidden="true">{activeNav.icon}</div>
                        <div className="perspective-social-composer-copy">
                            <strong>{activeNav.label}</strong>
                            <p>
                                {currentSymbol} | {currentTimeframe} | Buy {buyPressurePct}% / Sell {sellPressurePct}% | {pulseLabel}
                            </p>
                        </div>
                        <div className="perspective-social-composer-actions">
                            <button
                                type="button"
                                className="perspective-nav-btn"
                                style={{ ['--perspective-accent' as string]: prevNav.accent }}
                                onClick={() => setActiveSection(prevNav.key)}
                            >
                                <span>◀</span>
                                <span>{prevNav.label}</span>
                            </button>
                            <button
                                type="button"
                                className="perspective-nav-btn"
                                style={{ ['--perspective-accent' as string]: nextNav.accent }}
                                onClick={() => setActiveSection(nextNav.key)}
                            >
                                <span>{nextNav.label}</span>
                                <span>▶</span>
                            </button>
                        </div>
                    </div>

                    <div className="perspective-social-chipbar">
                        <span className="perspective-chip soft">Symbol: {currentSymbol}</span>
                        <span className="perspective-chip soft">TF: {currentTimeframe}</span>
                        <span className="perspective-chip soft">Trend: {trendDirection || 'N/A'} {trendStrength ? `(${trendStrength})` : ''}</span>
                        <span className="perspective-chip soft">Fib Set: {settings.fibAnalysisSet}</span>
                        {activeNav.tags.map((tag) => (
                            <span key={`active-tag-${tag}`} className="perspective-chip">{tag}</span>
                        ))}
                    </div>

                    <div className="perspective-social-grid">
                        <section className="perspective-feed-column">
                            {renderSection()}
                        </section>

                        <aside className="perspective-rail-column">
                            <div className="perspective-panel" style={{ ['--perspective-accent' as string]: '#22d3ee' }}>
                                <div className="perspective-panel-head">
                                    <div className="perspective-title-wrap">
                                        <div className="perspective-icon">📡</div>
                                        <div>
                                            <h3>Pulse Monitor</h3>
                                            <p>Etat temps reel du module actif.</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="social-rail-kpi">
                                    <div>
                                        <span>Signal</span>
                                        <strong>{globalSignalLabel}</strong>
                                    </div>
                                    <div>
                                        <span>Pressure</span>
                                        <strong>{buyPressurePct}% Buy</strong>
                                    </div>
                                </div>
                                <div className="social-rail-pressure-track" aria-hidden="true">
                                    <div className="social-rail-pressure-buy" style={{ width: `${buyPressurePct}%` }} />
                                </div>
                                <div className="social-rail-footnote">
                                    Sell side {sellPressurePct}% | Last alert: {lastEntryAlertLabel}
                                </div>
                            </div>

                            <div className="perspective-panel" style={{ ['--perspective-accent' as string]: '#60a5fa' }}>
                                <div className="perspective-panel-head">
                                    <div className="perspective-title-wrap">
                                        <div className="perspective-icon">🧾</div>
                                        <div>
                                            <h3>Quick Context</h3>
                                            <p>Contexte execution sans quitter le feed.</p>
                                        </div>
                                    </div>
                                </div>
                                <ul className="social-rail-list">
                                    <li><span>Symbol</span><strong>{currentSymbol}</strong></li>
                                    <li><span>Timeframe</span><strong>{currentTimeframe}</strong></li>
                                    <li><span>Price</span><strong>{formatSymbolPrice(currentSymbol, realtimePrice)}</strong></li>
                                    <li>
                                        <span>Adaptive S/R</span>
                                        <strong>
                                            {settings.enableAdaptiveSrLookback
                                                ? (adaptiveResult ? `${adaptiveResult.period} (${adaptiveResult.confidencePct}%)` : 'warming up')
                                                : `manual ${settings.manualSrLookback}`}
                                        </strong>
                                    </li>
                                    <li>
                                        <span>Adaptive Time</span>
                                        <strong>
                                            {settings.showTimeZone
                                                ? (settings.enableTimeAdaptiveLookback
                                                    ? (timeAdaptiveResult ? `${timeAdaptiveResult.period} (${timeAdaptiveResult.confidencePct}%)` : 'warming up')
                                                    : `manual ${settings.manualTimeLookback}`)
                                                : 'off'}
                                        </strong>
                                    </li>
                                </ul>
                            </div>

                            <div className="perspective-panel" style={{ ['--perspective-accent' as string]: '#a78bfa' }}>
                                <div className="perspective-panel-head">
                                    <div className="perspective-title-wrap">
                                        <div className="perspective-icon">🚀</div>
                                        <div>
                                            <h3>Hot Channels</h3>
                                            <p>Basculer rapidement entre modules.</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="social-rail-channel-grid">
                                    {NAV_ITEMS.map((item) => (
                                        <button
                                            key={`rail-${item.key}`}
                                            type="button"
                                            className={`perspective-nav-btn ${item.key === activeSection ? 'active' : ''}`}
                                            style={{ ['--perspective-accent' as string]: item.accent }}
                                            onClick={() => setActiveSection(item.key)}
                                        >
                                            <span>{item.icon}</span>
                                            <span>{item.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </aside>
                    </div>
                </div>
            </div>
        </div>
    );
}
