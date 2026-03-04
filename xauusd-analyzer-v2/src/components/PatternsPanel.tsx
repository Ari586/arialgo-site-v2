import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMarketStore } from '../store/marketStore';
import { calculateAllIndicators } from '../utils/indicators';
import { formatSymbolPrice } from '../utils/priceFormat';

type Tone = 'bullish' | 'bearish' | 'neutral';

type DetectedPattern = {
    name: string;
    type: Tone;
    emoji?: string;
    category?: string;
    confidence?: number;
    template?: string;
    timestamp?: number;
    nextAction?: 'BUY' | 'SELL' | 'WAIT';
    entryPrice?: number;
    stopLoss?: number;
    takeProfit?: number;
    riskReward?: number;
    horizonBars?: number;
};

type CatalogItem = {
    name: string;
    aliases: string[];
    template: string;
    tone: Tone;
};

type CatalogGroup = {
    category: string;
    items: CatalogItem[];
};

const fetchHistory = async (symbol: string, timeframe: string) => {
    const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}&outputsize=1000`);
    const data = await res.json();
    return data.data || [];
};

const normalizeLabel = (value: string) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const PATTERN_CATALOG: CatalogGroup[] = [
    {
        category: 'Reversal',
        items: [
            { name: 'Épaule-Tête-Épaule', aliases: ['head and shoulders', 'ete'], template: 'ete', tone: 'bearish' },
            { name: 'Épaule-Tête-Épaule inversée', aliases: ['inverse head and shoulders', 'ete inversee'], template: 'eteInv', tone: 'bullish' },
            { name: 'Double Top', aliases: ['double top'], template: 'doubleTop', tone: 'bearish' },
            { name: 'Double Bottom', aliases: ['double bottom'], template: 'doubleBottom', tone: 'bullish' },
            { name: 'Triple Top', aliases: ['triple top'], template: 'doubleTop', tone: 'bearish' },
            { name: 'Triple Bottom', aliases: ['triple bottom'], template: 'doubleBottom', tone: 'bullish' },
            { name: 'Biseau ascendant', aliases: ['rising wedge', 'biseau ascendant'], template: 'wedgeUp', tone: 'bearish' },
            { name: 'Biseau descendant', aliases: ['falling wedge', 'biseau descendant'], template: 'wedgeDown', tone: 'bullish' },
            { name: 'Diamond Top/Bottom', aliases: ['diamond', 'diamond top', 'diamond bottom'], template: 'diamond', tone: 'neutral' },
        ]
    },
    {
        category: 'Continuation',
        items: [
            { name: 'Triangle ascendant', aliases: ['ascending triangle'], template: 'triangleAsc', tone: 'bullish' },
            { name: 'Triangle descendant', aliases: ['descending triangle'], template: 'triangleDesc', tone: 'bearish' },
            { name: 'Triangle symétrique', aliases: ['symmetrical triangle'], template: 'triangleSym', tone: 'neutral' },
            { name: 'Drapeau', aliases: ['flag', 'bull flag', 'bear flag'], template: 'flagBull', tone: 'neutral' },
            { name: 'Fanion', aliases: ['pennant'], template: 'pennant', tone: 'neutral' },
            { name: 'Rectangle', aliases: ['rectangle', 'range'], template: 'range', tone: 'neutral' },
            { name: 'Canal haussier', aliases: ['ascending channel', 'canal haussier'], template: 'channelUp', tone: 'bullish' },
            { name: 'Canal baissier', aliases: ['descending channel', 'canal baissier'], template: 'channelDown', tone: 'bearish' },
        ]
    },
    {
        category: 'Candlestick',
        items: [
            { name: 'Marteau', aliases: ['hammer'], template: 'hammer', tone: 'bullish' },
            { name: 'Marteau inversé', aliases: ['inverted hammer'], template: 'hammer', tone: 'bullish' },
            { name: 'Englobante haussière', aliases: ['bullish engulfing'], template: 'engulfBull', tone: 'bullish' },
            { name: 'Morning Star', aliases: ['morning star'], template: 'morningStar', tone: 'bullish' },
            { name: 'Harami haussier', aliases: ['bullish harami'], template: 'insideBar', tone: 'bullish' },
            { name: 'Piercing Line', aliases: ['piercing line'], template: 'engulfBull', tone: 'bullish' },
            { name: 'Étoile filante', aliases: ['shooting star'], template: 'shootingStar', tone: 'bearish' },
            { name: 'Englobante baissière', aliases: ['bearish engulfing'], template: 'engulfBear', tone: 'bearish' },
            { name: 'Evening Star', aliases: ['evening star'], template: 'eveningStar', tone: 'bearish' },
            { name: 'Harami baissier', aliases: ['bearish harami'], template: 'insideBar', tone: 'bearish' },
            { name: 'Dark Cloud Cover', aliases: ['dark cloud cover'], template: 'engulfBear', tone: 'bearish' },
            { name: 'Doji', aliases: ['doji'], template: 'doji', tone: 'neutral' },
            { name: 'Spinning Top', aliases: ['spinning top', 'toupie'], template: 'doji', tone: 'neutral' },
            { name: 'Long-legged Doji', aliases: ['long legged doji'], template: 'doji', tone: 'neutral' },
        ]
    },
    {
        category: 'Harmonic',
        items: [
            { name: 'Gartley', aliases: ['gartley'], template: 'harmonic', tone: 'neutral' },
            { name: 'Bat', aliases: ['bat pattern'], template: 'harmonic', tone: 'neutral' },
            { name: 'Butterfly', aliases: ['butterfly pattern'], template: 'harmonic', tone: 'neutral' },
            { name: 'Crab', aliases: ['crab pattern'], template: 'harmonic', tone: 'neutral' },
            { name: 'Cypher', aliases: ['cypher pattern'], template: 'harmonic', tone: 'neutral' },
            { name: 'AB=CD', aliases: ['ab cd', 'ab=cd'], template: 'harmonic', tone: 'neutral' },
        ]
    },
    {
        category: 'Waves',
        items: [
            { name: 'Elliott Wave', aliases: ['elliott wave'], template: 'wave', tone: 'neutral' },
            { name: 'Wolfe Wave', aliases: ['wolfe wave'], template: 'wave', tone: 'neutral' },
        ]
    },
    {
        category: 'Volume',
        items: [
            { name: 'Breakout volume', aliases: ['breakout volume', 'breakout avec explosion de volume'], template: 'volumeBreakout', tone: 'neutral' },
            { name: 'Volume climax', aliases: ['volume climax'], template: 'volumeClimax', tone: 'neutral' },
            { name: 'Accumulation/Distribution', aliases: ['accumulation', 'distribution'], template: 'volumeBreakout', tone: 'neutral' },
        ]
    },
    {
        category: 'Algorithmic',
        items: [
            { name: 'Breakout range', aliases: ['breakout range'], template: 'breakoutUp', tone: 'neutral' },
            {
                name: 'Brisee Micro-Resistance',
                aliases: ['micro resistance break', 'microresistance break', 'brisee microresistance', 'brisee micro resistance'],
                template: 'breakoutUp',
                tone: 'bullish'
            },
            {
                name: 'Brisee Micro-Support',
                aliases: ['micro support break', 'microsupport break', 'brisee microsupport', 'brisee micro support'],
                template: 'breakoutDown',
                tone: 'bearish'
            },
            {
                name: 'Rejet Micro-Resistance',
                aliases: ['micro resistance rejection', 'rejet microresistance', 'rejet micro resistance'],
                template: 'shootingStar',
                tone: 'bearish'
            },
            {
                name: 'Reprise Micro-Support',
                aliases: ['micro support reclaim', 'reprise microsupport', 'reprise micro support'],
                template: 'hammer',
                tone: 'bullish'
            },
            { name: 'Pullback EMA', aliases: ['pullback ema'], template: 'pullbackEma', tone: 'neutral' },
            { name: 'Mean reversion', aliases: ['mean reversion'], template: 'meanReversion', tone: 'neutral' },
            { name: 'Inside Bar', aliases: ['inside bar'], template: 'insideBar', tone: 'neutral' },
            { name: 'Outside Bar', aliases: ['outside bar'], template: 'outsideBar', tone: 'neutral' },
        ]
    }
];

const INDICATOR_CATALOG: Array<{ category: string; items: string[] }> = [
    {
        category: 'Tendance',
        items: [
            'SMA', 'EMA', 'WMA', 'Hull MA', 'ATR', 'DMI', 'ADX', 'Parabolic SAR', 'SuperTrend', 'Ichimoku',
            'MACD', 'MACD Histogram', 'TRIX', 'TEMA', 'DEMA', 'Momentum', 'ROC', 'Linear Regression',
            'Linear Regression Slope', 'Standard Error', 'Moving Average Envelope', 'Keltner Channels', 'ZigZag'
        ]
    },
    {
        category: 'Oscillation',
        items: [
            'RSI', 'Stochastic', 'Slow Stochastic', 'Stoch RSI', 'CCI', 'Williams %R', 'Ultimate Oscillator',
            'Awesome Oscillator', 'Accelerator Oscillator', 'Chande Momentum Oscillator', 'DeMarker',
            'Fisher Transform', 'KST', 'Price Oscillator', 'Elder Ray Index'
        ]
    },
    {
        category: 'Volatilité',
        items: [
            'Bollinger Bands', 'Bollinger Bandwidth', 'ATR', 'Volatility Index', 'Chaikin Volatility',
            'Donchian Channel', 'Standard Deviation'
        ]
    },
    {
        category: 'Volume',
        items: [
            'Volume', 'OBV', 'Accumulation/Distribution', 'Chaikin Money Flow', 'MFI', 'Ease of Movement',
            'Volume Oscillator', 'VWAP', 'VWMA'
        ]
    },
    {
        category: 'Prix/Autres',
        items: [
            'Pivot Points', 'Camarilla Pivots', 'Typical Price', 'Median Price', 'Weighted Close',
            'Heikin Ashi', 'Renko', 'Kagi', 'Point & Figure', 'Spread', 'Correlation Coefficient'
        ]
    },
];

const aliasIndex: Map<string, CatalogItem> = (() => {
    const map = new Map<string, CatalogItem>();
    PATTERN_CATALOG.forEach(group => {
        group.items.forEach(item => {
            map.set(normalizeLabel(item.name), item);
            item.aliases.forEach(alias => map.set(normalizeLabel(alias), item));
        });
    });
    return map;
})();

const toneColor = (tone: Tone) => (
    tone === 'bullish' ? 'var(--buy)' : tone === 'bearish' ? 'var(--sell)' : 'var(--text-secondary)'
);

const toneBg = (tone: Tone) => (
    tone === 'bullish' ? 'var(--buy-bg)' : tone === 'bearish' ? 'var(--sell-bg)' : 'rgba(255,255,255,0.05)'
);

function PatternThumbnail({ template, tone }: { template: string; tone: Tone }) {
    const stroke = tone === 'bullish' ? '#00e676' : tone === 'bearish' ? '#ff5252' : '#9aa0a6';
    const accent = tone === 'bullish' ? '#8ef8c1' : tone === 'bearish' ? '#ff9a9a' : '#c2c7d0';

    const render = () => {
        switch (template) {
            case 'doubleTop':
                return <polyline points="6,60 20,34 34,58 50,30 66,56 92,68" fill="none" stroke={stroke} strokeWidth="3" />;
            case 'doubleBottom':
                return <polyline points="6,34 20,60 34,38 50,64 66,40 92,28" fill="none" stroke={stroke} strokeWidth="3" />;
            case 'triangleAsc':
                return <><line x1="8" y1="60" x2="88" y2="60" stroke={accent} strokeWidth="2" /><line x1="8" y1="60" x2="88" y2="24" stroke={stroke} strokeWidth="3" /></>;
            case 'triangleDesc':
                return <><line x1="8" y1="24" x2="88" y2="24" stroke={accent} strokeWidth="2" /><line x1="8" y1="24" x2="88" y2="60" stroke={stroke} strokeWidth="3" /></>;
            case 'triangleSym':
            case 'pennant':
                return <><line x1="8" y1="62" x2="88" y2="28" stroke={stroke} strokeWidth="3" /><line x1="8" y1="20" x2="88" y2="52" stroke={accent} strokeWidth="2.5" /></>;
            case 'flagBull':
                return <><line x1="10" y1="66" x2="30" y2="22" stroke={stroke} strokeWidth="3" /><rect x="34" y="24" width="42" height="24" fill="none" stroke={accent} strokeWidth="2.5" /></>;
            case 'flagBear':
                return <><line x1="10" y1="18" x2="30" y2="62" stroke={stroke} strokeWidth="3" /><rect x="34" y="24" width="42" height="24" fill="none" stroke={accent} strokeWidth="2.5" /></>;
            case 'channelUp':
                return <><line x1="8" y1="58" x2="92" y2="30" stroke={accent} strokeWidth="2.5" /><line x1="8" y1="72" x2="92" y2="44" stroke={accent} strokeWidth="2.5" /><polyline points="8,68 26,56 44,60 62,46 80,50 92,42" fill="none" stroke={stroke} strokeWidth="3" /></>;
            case 'channelDown':
                return <><line x1="8" y1="28" x2="92" y2="56" stroke={accent} strokeWidth="2.5" /><line x1="8" y1="16" x2="92" y2="44" stroke={accent} strokeWidth="2.5" /><polyline points="8,22 26,34 44,30 62,44 80,40 92,50" fill="none" stroke={stroke} strokeWidth="3" /></>;
            case 'wedgeUp':
                return <><line x1="8" y1="60" x2="92" y2="36" stroke={accent} strokeWidth="2.5" /><line x1="8" y1="72" x2="92" y2="50" stroke={stroke} strokeWidth="3" /></>;
            case 'wedgeDown':
                return <><line x1="8" y1="22" x2="92" y2="44" stroke={accent} strokeWidth="2.5" /><line x1="8" y1="36" x2="92" y2="56" stroke={stroke} strokeWidth="3" /></>;
            case 'ete':
                return <polyline points="8,60 22,44 34,54 48,26 62,54 76,44 92,60" fill="none" stroke={stroke} strokeWidth="3" />;
            case 'eteInv':
                return <polyline points="8,30 22,46 34,36 48,64 62,36 76,46 92,30" fill="none" stroke={stroke} strokeWidth="3" />;
            case 'engulfBull':
                return <><rect x="24" y="24" width="10" height="30" fill="none" stroke="#ff8a8a" strokeWidth="2" /><rect x="44" y="18" width="18" height="42" fill="none" stroke="#74f1b5" strokeWidth="2.5" /></>;
            case 'engulfBear':
                return <><rect x="24" y="18" width="10" height="42" fill="none" stroke="#74f1b5" strokeWidth="2" /><rect x="44" y="24" width="18" height="30" fill="none" stroke="#ff8a8a" strokeWidth="2.5" /></>;
            case 'hammer':
                return <><line x1="50" y1="14" x2="50" y2="66" stroke={stroke} strokeWidth="3" /><rect x="38" y="22" width="24" height="18" fill="none" stroke={accent} strokeWidth="2.5" /></>;
            case 'shootingStar':
                return <><line x1="50" y1="10" x2="50" y2="62" stroke={stroke} strokeWidth="3" /><rect x="38" y="42" width="24" height="14" fill="none" stroke={accent} strokeWidth="2.5" /></>;
            case 'morningStar':
            case 'eveningStar':
                return <polyline points="12,54 30,32 46,48 62,26 84,40" fill="none" stroke={stroke} strokeWidth="3" />;
            case 'doji':
                return <><line x1="50" y1="12" x2="50" y2="66" stroke={stroke} strokeWidth="3" /><line x1="38" y1="38" x2="62" y2="38" stroke={accent} strokeWidth="3" /></>;
            case 'insideBar':
                return <><rect x="24" y="18" width="24" height="44" fill="none" stroke={accent} strokeWidth="2.5" /><rect x="54" y="28" width="16" height="24" fill="none" stroke={stroke} strokeWidth="2.5" /></>;
            case 'outsideBar':
                return <><rect x="30" y="28" width="16" height="24" fill="none" stroke={accent} strokeWidth="2.5" /><rect x="50" y="16" width="24" height="48" fill="none" stroke={stroke} strokeWidth="2.5" /></>;
            case 'breakoutUp':
                return <><line x1="8" y1="52" x2="92" y2="52" stroke={accent} strokeWidth="2" strokeDasharray="4 3" /><polyline points="12,64 34,58 56,54 76,50 92,26" fill="none" stroke={stroke} strokeWidth="3" /></>;
            case 'breakoutDown':
                return <><line x1="8" y1="30" x2="92" y2="30" stroke={accent} strokeWidth="2" strokeDasharray="4 3" /><polyline points="12,18 34,24 56,28 76,30 92,62" fill="none" stroke={stroke} strokeWidth="3" /></>;
            case 'pullbackEma':
                return <><path d="M8,52 C24,34 42,62 58,44 C72,30 84,34 92,26" fill="none" stroke={accent} strokeWidth="2.5" /><polyline points="10,34 30,22 46,28 62,22 78,24 92,18" fill="none" stroke={stroke} strokeWidth="3" /></>;
            case 'meanReversion':
                return <><line x1="8" y1="40" x2="92" y2="40" stroke={accent} strokeWidth="2" /><polyline points="10,20 26,60 42,24 58,56 74,30 90,44" fill="none" stroke={stroke} strokeWidth="3" /></>;
            case 'volumeBreakout':
                return <><rect x="16" y="54" width="8" height="18" fill={accent} /><rect x="30" y="48" width="8" height="24" fill={accent} /><rect x="44" y="44" width="8" height="28" fill={accent} /><rect x="58" y="30" width="8" height="42" fill={stroke} /><rect x="72" y="18" width="8" height="54" fill={stroke} /></>;
            case 'volumeClimax':
                return <><rect x="18" y="56" width="8" height="16" fill={accent} /><rect x="32" y="52" width="8" height="20" fill={accent} /><rect x="46" y="44" width="8" height="28" fill={accent} /><rect x="60" y="12" width="10" height="60" fill={stroke} /><rect x="76" y="46" width="8" height="26" fill={accent} /></>;
            case 'harmonic':
                return <polyline points="8,56 24,30 40,50 58,20 76,46 92,32" fill="none" stroke={stroke} strokeWidth="3" />;
            case 'wave':
                return <polyline points="6,62 18,46 30,58 42,38 54,50 66,28 78,42 92,20" fill="none" stroke={stroke} strokeWidth="3" />;
            case 'diamond':
                return <polygon points="20,38 50,16 80,38 50,60" fill="none" stroke={stroke} strokeWidth="3" />;
            case 'range':
                return <><line x1="8" y1="24" x2="92" y2="24" stroke={accent} strokeWidth="2.5" /><line x1="8" y1="58" x2="92" y2="58" stroke={accent} strokeWidth="2.5" /><polyline points="10,48 24,34 42,46 58,32 74,44 90,36" fill="none" stroke={stroke} strokeWidth="2.8" /></>;
            default:
                return <polyline points="6,58 24,40 38,46 56,30 74,34 92,20" fill="none" stroke={stroke} strokeWidth="3" />;
        }
    };

    return (
        <svg width="102" height="76" viewBox="0 0 100 76" style={{ borderRadius: '7px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
            {render()}
        </svg>
    );
}

type IndicatorState = 'live' | 'proxy' | 'catalog';

function getIndicatorState(indicators: any, name: string): IndicatorState {
    if (!indicators) return 'catalog';
    const key = normalizeLabel(name);
    const hasTrendCore = indicators.ema9 !== null && indicators.ema21 !== null;
    const hasVolatilityCore = indicators.atr !== null || indicators.bbUpper !== null || indicators.keltner != null;
    const hasVolumeCore = indicators.obv != null || indicators.cvd != null || indicators.volumeProfile != null;
    const hasMomentumCore = indicators.rsi !== null || indicators.macdLine !== null || indicators.stochastic != null;

    if (key === 'rsi') return indicators.rsi !== null ? 'live' : 'catalog';
    if (key === 'stoch rsi') return indicators.stochRsi != null ? 'live' : 'catalog';
    if (key === 'stochastic' || key === 'slow stochastic') return indicators.stochastic != null ? 'live' : 'catalog';
    if (key === 'cci') return indicators.cci !== null ? 'live' : 'catalog';
    if (key === 'williams r') return indicators.williamsR !== null ? 'live' : 'catalog';
    if (key === 'mfi') return indicators.mfi !== null ? 'live' : 'catalog';
    if (key === 'adx' || key === 'dmi') return indicators.adx != null ? 'live' : 'catalog';
    if (key === 'ema') return hasTrendCore ? 'live' : 'catalog';
    if (key === 'macd' || key === 'macd histogram') return indicators.macdLine !== null ? 'live' : 'catalog';
    if (key === 'atr') return indicators.atr !== null ? 'live' : 'catalog';
    if (key === 'bollinger bands' || key === 'bollinger bandwidth') return indicators.bbUpper !== null ? 'live' : 'catalog';
    if (key === 'ichimoku') return indicators.ichimoku != null ? 'live' : 'catalog';
    if (key === 'keltner channels') return indicators.keltner != null ? 'live' : 'catalog';
    if (key === 'pivot points') return indicators.pivotPoints != null ? 'live' : 'catalog';
    if (key === 'obv') return indicators.obv != null ? 'live' : 'catalog';
    if (key === 'vwap') return indicators.vwap != null ? 'live' : 'catalog';
    if (key === 'volume') return 'live';

    // proxy mappings: available via closely related computed blocks
    if ([
        'sma', 'wma', 'hull ma', 'triangular moving average', 'moving average envelope',
        'parabolic sar', 'supertrend', 'trix', 'tema', 'dema', 'momentum', 'roc',
        'linear regression', 'linear regression slope', 'standard error', 'zigzag'
    ].includes(key)) return hasTrendCore ? 'proxy' : 'catalog';

    if ([
        'ultimate oscillator', 'awesome oscillator', 'accelerator oscillator',
        'chande momentum oscillator', 'demarker', 'fisher transform', 'kst',
        'price oscillator', 'elder ray index'
    ].includes(key)) return hasMomentumCore ? 'proxy' : 'catalog';

    if ([
        'volatility index', 'chaikin volatility', 'donchian channel', 'standard deviation'
    ].includes(key)) return hasVolatilityCore ? 'proxy' : 'catalog';

    if ([
        'accumulation distribution', 'chaikin money flow', 'ease of movement',
        'volume oscillator', 'vwma', 'volume weighted moving average'
    ].includes(key)) return hasVolumeCore ? 'proxy' : 'catalog';

    if ([
        'camarilla pivots', 'typical price', 'median price', 'weighted close',
        'heikin ashi', 'renko', 'kagi', 'point figure', 'spread', 'correlation coefficient'
    ].includes(key)) return hasTrendCore ? 'proxy' : 'catalog';

    return 'catalog';
}

export default function PatternsPanel() {
    const currentSymbol = useMarketStore(state => state.currentSymbol);
    const currentTimeframe = useMarketStore(state => state.currentTimeframe);

    const { data: history } = useQuery({
        queryKey: ['history', currentSymbol, currentTimeframe],
        queryFn: () => fetchHistory(currentSymbol, currentTimeframe),
        staleTime: 60000,
        refetchInterval: currentTimeframe.endsWith('s') ? 1200 : 5000,
    });

    const indicators = useMemo(() => {
        if (!history || history.length < 30) return null;
        // Use confirmed candle history only for pattern detection.
        return calculateAllIndicators([...history]);
    }, [history]);

    if (!indicators) return null;

    const rawPatterns = (indicators.patterns || []) as DetectedPattern[];
    const detectedPatterns = rawPatterns.map((p) => {
        const alias = normalizeLabel(p.name || '');
        const catalogItem = aliasIndex.get(alias);
        return {
            ...p,
            category: p.category || (catalogItem ? PATTERN_CATALOG.find(g => g.items.includes(catalogItem))?.category : 'Pattern'),
            template: p.template || catalogItem?.template || 'default',
            confidence: p.confidence ?? 60,
            nextAction: p.nextAction || (p.type === 'bullish' ? 'BUY' : p.type === 'bearish' ? 'SELL' : 'WAIT'),
            riskReward: Number.isFinite(Number(p.riskReward)) ? Number(p.riskReward) : null,
            horizonBars: Number.isFinite(Number(p.horizonBars)) ? Number(p.horizonBars) : null,
        };
    });
    const latestPatternMs = detectedPatterns.reduce((max, p) => {
        const ts = Number(p.timestamp || 0);
        return Number.isFinite(ts) && ts > max ? ts : max;
    }, 0);
    const latestPatternLabel = latestPatternMs > 0
        ? new Date(latestPatternMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : null;

    const detectedAliasSet = new Set<string>();
    detectedPatterns.forEach((p) => {
        detectedAliasSet.add(normalizeLabel(p.name));
        const item = aliasIndex.get(normalizeLabel(p.name));
        if (item) {
            detectedAliasSet.add(normalizeLabel(item.name));
            item.aliases.forEach(a => detectedAliasSet.add(normalizeLabel(a)));
        }
    });

    const recentOrderBlocks = (indicators.orderBlocks || []).slice(-2).reverse();
    const recentFvgs = (indicators.fvgs || []).slice(-2).reverse();
    const fib = indicators.fibonacci;
    const formatPx = (value?: number | null) => formatSymbolPrice(currentSymbol, value);

    const structureItems: Array<{ label: string; value: string; tone: Tone }> = [];
    recentOrderBlocks.forEach((ob: any, idx: number) => {
        structureItems.push({
            label: `Order Block ${idx + 1}`,
            value: `${ob.type} ${formatPx(Number(ob.low))} - ${formatPx(Number(ob.high))}`,
            tone: ob.type === 'BULLISH' ? 'bullish' : 'bearish'
        });
    });
    recentFvgs.forEach((gap: any, idx: number) => {
        structureItems.push({
            label: `FVG ${idx + 1}`,
            value: `${gap.type} ${formatPx(Number(gap.low))} - ${formatPx(Number(gap.high))}`,
            tone: gap.type === 'BULLISH' ? 'bullish' : 'bearish'
        });
    });
    if (fib) {
        structureItems.push({
            label: 'Fibonacci',
            value: `${fib.trend} | nearest ${fib.nearestLevel || 'n/a'} @ ${formatPx(Number(fib.nearestPrice))}${fib.inGoldenPocket ? ' | GOLDEN POCKET' : ''}`,
            tone: fib.trend === 'UP' ? 'bullish' : fib.trend === 'DOWN' ? 'bearish' : 'neutral'
        });
    }

    return (
        <div style={{ padding: '4px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {detectedPatterns.length === 0 && structureItems.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '14px', fontSize: '13px', fontStyle: 'italic' }}>
                    Aucun pattern détecté ({currentTimeframe})
                </div>
            ) : (
                <>
                    {detectedPatterns.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                <div style={{ fontSize: '10px', letterSpacing: '0.6px', color: 'var(--text-secondary)', fontWeight: 700 }}>
                                    PATTERNS DÉTECTÉS ({detectedPatterns.length})
                                </div>
                                {latestPatternLabel && (
                                    <div style={{
                                        fontSize: '10px',
                                        color: 'var(--gold)',
                                        border: '1px solid rgba(212,175,55,0.45)',
                                        background: 'rgba(212,175,55,0.10)',
                                        borderRadius: '999px',
                                        padding: '2px 8px'
                                    }}>
                                        Dernier: {latestPatternLabel}
                                    </div>
                                )}
                            </div>
                            {detectedPatterns.map((p, i) => (
                                <div key={`p-${i}`} style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    background: toneBg(p.type),
                                    border: `1px solid ${p.type === 'bullish' ? 'rgba(0,230,118,0.35)' : p.type === 'bearish' ? 'rgba(255,82,82,0.35)' : 'var(--border)'}`,
                                    padding: '10px',
                                    borderRadius: '9px'
                                }}>
                                    <PatternThumbnail template={p.template || 'default'} tone={p.type} />
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                            <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-main)' }}>
                                                {p.emoji ? `${p.emoji} ` : ''}{p.name}
                                            </div>
                                            <div style={{ fontSize: '10px', color: toneColor(p.type), fontWeight: 700 }}>
                                                {Math.round(p.confidence || 60)}%
                                            </div>
                                        </div>
                                        <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                            {(p.category || 'Pattern').toUpperCase()} • {p.type === 'bullish' ? 'HAUSSIER' : p.type === 'bearish' ? 'BAISSIER' : 'NEUTRE'}
                                        </div>
                                        {(p.nextAction === 'BUY' || p.nextAction === 'SELL') && Number.isFinite(Number(p.entryPrice)) && Number.isFinite(Number(p.stopLoss)) && Number.isFinite(Number(p.takeProfit)) && (
                                            <div style={{
                                                marginTop: '6px',
                                                fontSize: '10px',
                                                color: 'var(--text-main)',
                                                fontFamily: 'var(--font-mono)',
                                                display: 'flex',
                                                flexWrap: 'wrap',
                                                gap: '7px',
                                                lineHeight: 1.5
                                            }}>
                                                <span style={{
                                                    padding: '1px 6px',
                                                    borderRadius: '999px',
                                                    border: `1px solid ${p.nextAction === 'BUY' ? 'rgba(0,230,118,0.45)' : 'rgba(255,82,82,0.45)'}`,
                                                    background: p.nextAction === 'BUY' ? 'rgba(0,230,118,0.14)' : 'rgba(255,82,82,0.14)',
                                                    color: p.nextAction === 'BUY' ? 'var(--buy)' : 'var(--sell)',
                                                    fontWeight: 700
                                                }}>
                                                    {p.nextAction}
                                                </span>
                                                <span>Entry {formatPx(p.entryPrice)}</span>
                                                <span>SL {formatPx(p.stopLoss)}</span>
                                                <span>TP {formatPx(p.takeProfit)}</span>
                                                {Number.isFinite(Number(p.riskReward)) && (
                                                    <span>R:R {Number(p.riskReward).toFixed(2)}</span>
                                                )}
                                                {Number.isFinite(Number(p.horizonBars)) && (
                                                    <span>Horizon {Math.round(Number(p.horizonBars))} bars</span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {structureItems.length > 0 && (
                        <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px' }}>
                            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 700, marginBottom: '6px' }}>
                                STRUCTURE (OB / FVG / FIB)
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {structureItems.map((item, idx) => (
                                    <div key={`s-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '11px' }}>
                                        <span style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
                                        <span style={{ color: toneColor(item.tone), textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                                            {item.value}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}

            <details style={{ border: '1px solid var(--border)', borderRadius: '8px', background: 'rgba(255,255,255,0.02)' }}>
                <summary style={{ cursor: 'pointer', padding: '10px', fontSize: '11px', fontWeight: 700, color: 'var(--text-main)' }}>
                    Bibliothèque visuelle Patterns + Indicateurs
                </summary>
                <div style={{ padding: '0 10px 10px 10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                        Les cartes vertes/rouges marquées montrent les patterns détectés en temps réel.
                    </div>
                    {PATTERN_CATALOG.map((group) => (
                        <div key={group.category}>
                            <div style={{ fontSize: '10px', color: 'var(--gold)', fontWeight: 700, marginBottom: '6px' }}>
                                {group.category.toUpperCase()}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '8px' }}>
                                {group.items.map((item) => {
                                    const isDetected = detectedAliasSet.has(normalizeLabel(item.name)) || item.aliases.some(a => detectedAliasSet.has(normalizeLabel(a)));
                                    const tone = isDetected
                                        ? ((detectedPatterns.find(p => normalizeLabel(p.name) === normalizeLabel(item.name))?.type || item.tone) as Tone)
                                        : item.tone;
                                    return (
                                        <div key={`${group.category}-${item.name}`} style={{
                                            border: `1px solid ${isDetected ? toneColor(tone) : 'var(--border)'}`,
                                            borderRadius: '8px',
                                            padding: '7px',
                                            background: isDetected ? toneBg(tone) : 'rgba(255,255,255,0.02)'
                                        }}>
                                            <PatternThumbnail template={item.template} tone={tone} />
                                            <div style={{ marginTop: '6px', fontSize: '11px', color: isDetected ? toneColor(tone) : 'var(--text-main)', fontWeight: 700 }}>
                                                {item.name}
                                            </div>
                                            <div style={{ fontSize: '10px', color: isDetected ? toneColor(tone) : 'var(--text-secondary)' }}>
                                                {isDetected ? 'Détecté' : 'En veille'}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}

                    <div>
                        <div style={{ fontSize: '10px', color: 'var(--gold)', fontWeight: 700, marginBottom: '6px' }}>
                            INDICATEURS
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                            Vert = calcul direct • Orange = proxy moteur • Gris = catalogue
                        </div>
                        {INDICATOR_CATALOG.map((group) => (
                            <div key={`ind-${group.category}`} style={{ marginBottom: '8px' }}>
                                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px' }}>{group.category}</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                    {group.items.map((item) => {
                                        const state = getIndicatorState(indicators, item);
                                        const color = state === 'live' ? 'var(--buy)' : state === 'proxy' ? 'var(--gold)' : 'var(--text-secondary)';
                                        const border = state === 'live'
                                            ? 'rgba(0,230,118,0.5)'
                                            : state === 'proxy'
                                                ? 'rgba(212,175,55,0.55)'
                                                : 'var(--border)';
                                        const background = state === 'live'
                                            ? 'rgba(0,230,118,0.08)'
                                            : state === 'proxy'
                                                ? 'rgba(212,175,55,0.1)'
                                                : 'rgba(255,255,255,0.03)';
                                        return (
                                            <span key={`${group.category}-${item}`} style={{
                                                fontSize: '10px',
                                                border: `1px solid ${border}`,
                                                color,
                                                background,
                                                borderRadius: '999px',
                                                padding: '3px 7px'
                                            }}>
                                                {item}{state === 'proxy' ? ' (proxy)' : ''}
                                            </span>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </details>
        </div>
    );
}
