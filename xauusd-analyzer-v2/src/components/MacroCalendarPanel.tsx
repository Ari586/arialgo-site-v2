import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMarketStore } from '../store/marketStore';

type MacroImportance = 'high' | 'medium' | 'low';
type MacroImpact = 'bullish' | 'bearish' | 'neutral';
type MacroStatus = 'upcoming' | 'past';

type MacroEvent = {
    id: string;
    title: string;
    country: string;
    flag: string;
    importance: MacroImportance;
    previous: string | null;
    expected: string | null;
    actual: string | null;
    timestamp: number;
    status: MacroStatus;
    countdown: string;
    impact: MacroImpact;
};

type MacroCalendarResponse = {
    success?: boolean;
    symbol?: string;
    source?: string;
    generatedAt?: string;
    total?: number;
    events?: MacroEvent[];
};

function formatRelativeTime(targetTs: number, nowTs: number) {
    const deltaMs = targetTs - nowTs;
    const abs = Math.abs(deltaMs);
    const mins = Math.round(abs / 60000);
    const hours = Math.round(abs / 3600000);
    const days = Math.round(abs / 86400000);

    if (deltaMs >= 0) {
        if (days >= 1) return `In ${days}d`;
        if (hours >= 1) return `In ${hours}h`;
        return `In ${Math.max(1, mins)}m`;
    }
    if (days >= 1) return `${days}d ago`;
    if (hours >= 1) return `${hours}h ago`;
    return `${Math.max(1, mins)}m ago`;
}

function importanceStyle(level: MacroImportance) {
    if (level === 'high') return { dot: '#ef4444', label: 'HIGH', glyph: '●●●' };
    if (level === 'medium') return { dot: '#f59e0b', label: 'MED', glyph: '●●○' };
    return { dot: '#d1d5db', label: 'LOW', glyph: '●○○' };
}

function impactStyle(impact: MacroImpact) {
    if (impact === 'bullish') return { icon: '▲', color: 'var(--buy)' };
    if (impact === 'bearish') return { icon: '▼', color: 'var(--sell)' };
    return { icon: '•', color: 'var(--text-secondary)' };
}

function formatEventClock(ts: number) {
    try {
        return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
        return '--:--';
    }
}

async function fetchMacroCalendar(symbol: string) {
    const res = await fetch(`/api/macro-calendar?symbol=${encodeURIComponent(symbol)}`);
    return res.json() as Promise<MacroCalendarResponse>;
}

export default function MacroCalendarPanel() {
    const currentSymbol = useMarketStore((state) => state.currentSymbol);
    const [nowTs, setNowTs] = React.useState(() => Date.now());

    React.useEffect(() => {
        const timer = window.setInterval(() => setNowTs(Date.now()), 30000);
        return () => window.clearInterval(timer);
    }, []);

    const { data, isLoading } = useQuery({
        queryKey: ['macro-calendar', currentSymbol],
        queryFn: () => fetchMacroCalendar(currentSymbol),
        staleTime: 30_000,
        refetchInterval: 60_000
    });

    const events = Array.isArray(data?.events) ? data!.events! : [];
    const preview = events.slice(0, 18);
    const highCount = preview.filter((e) => e.importance === 'high').length;
    const mediumCount = preview.filter((e) => e.importance === 'medium').length;
    const lowCount = preview.filter((e) => e.importance === 'low').length;
    const upcomingCount = preview.filter((e) => e.status === 'upcoming').length;

    if (isLoading) {
        return <div style={{ padding: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>Loading macro events...</div>;
    }

    if (!preview.length) {
        return <div style={{ padding: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>No macro events available.</div>;
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '11px' }}>
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap'
                }}
            >
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '10px' }}>
                    <span style={{ color: '#ef4444' }}>● {highCount}</span>
                    <span style={{ color: '#f59e0b' }}>● {mediumCount}</span>
                    <span style={{ color: '#d1d5db' }}>● {lowCount}</span>
                    <span style={{ color: 'var(--text-secondary)' }}>Upcoming {upcomingCount}</span>
                </div>
                <span style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>{data?.source || 'macro-feed'}</span>
            </div>
            <div
                style={{
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))',
                    overflow: 'hidden'
                }}
            >
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: '58px 58px minmax(150px,1fr) 76px 76px 76px 72px',
                        gap: '6px',
                        padding: '8px 10px',
                        fontSize: '10px',
                        letterSpacing: '0.4px',
                        color: 'var(--text-secondary)',
                        borderBottom: '1px solid var(--border)',
                        background: 'rgba(255,255,255,0.02)',
                        position: 'sticky',
                        top: 0,
                        zIndex: 2
                    }}
                >
                    <span>TIME</span>
                    <span>IMPACT</span>
                    <span>EVENT</span>
                    <span style={{ textAlign: 'right' }}>PREV</span>
                    <span style={{ textAlign: 'right' }}>EXP</span>
                    <span style={{ textAlign: 'right' }}>ACT</span>
                    <span style={{ textAlign: 'right' }}>STATUS</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '306px', overflowY: 'auto', paddingRight: '4px' }}>
                {preview.map((event) => {
                    const importance = importanceStyle(event.importance);
                    const impact = impactStyle(event.impact);
                    const when = formatRelativeTime(Number(event.timestamp || 0), nowTs);
                    return (
                        <div
                            key={event.id}
                            style={{
                                display: 'grid',
                                gridTemplateColumns: '58px 58px minmax(150px,1fr) 76px 76px 76px 72px',
                                gap: '6px',
                                alignItems: 'center',
                                padding: '8px 10px',
                                borderBottom: '1px solid rgba(255,255,255,0.06)'
                            }}
                        >
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>{formatEventClock(event.timestamp)}</span>
                            <span style={{ color: importance.dot, fontFamily: 'var(--font-mono)', fontSize: '10px' }} title={importance.label}>
                                {importance.glyph}
                            </span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                                <span style={{ fontSize: '11px', flexShrink: 0 }}>{event.flag}</span>
                                <span style={{ color: 'var(--text-main)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {event.title}
                                </span>
                            </span>
                            <span style={{ textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{event.previous || '-'}</span>
                            <span style={{ textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{event.expected || '-'}</span>
                            <span style={{ textAlign: 'right', color: event.actual ? 'var(--text-main)' : 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{event.actual || '-'}</span>
                            <span style={{ textAlign: 'right', display: 'inline-flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px', color: impact.color, fontSize: '10px' }}>
                                {impact.icon} {when}
                            </span>
                        </div>
                    );
                })}
                </div>
            </div>
        </div>
    );
}
