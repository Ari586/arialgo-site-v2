import React from 'react';

type SessionKey = 'tokyo' | 'london' | 'newYork' | 'sydney';

interface SessionConfig {
    key: SessionKey;
    id: string;
    label: string;
    timeZone: string;
    startHour: number;
    endHour: number;
    color: string;
}

interface SegmentRange {
    start: number;
    end: number;
}

const SESSION_CONFIGS: SessionConfig[] = [
    { key: 'tokyo', id: 'TOKYO', label: 'Tokyo', timeZone: 'Asia/Tokyo', startHour: 9, endHour: 18, color: '#4fa3ff' },
    { key: 'london', id: 'LONDON', label: 'Londres', timeZone: 'Europe/London', startHour: 8, endHour: 17, color: '#22c55e' },
    { key: 'newYork', id: 'NEW_YORK', label: 'New York', timeZone: 'America/New_York', startHour: 8, endHour: 17, color: '#f59e0b' },
    { key: 'sydney', id: 'SYDNEY', label: 'Sydney', timeZone: 'Australia/Sydney', startHour: 8, endHour: 17, color: '#a855f7' },
];

function getLocalHourMinute(date: Date, timeZone: string): { hour: number; minute: number; label: string } {
    try {
        const formatter = new Intl.DateTimeFormat('en-GB', {
            timeZone,
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
        });
        const parts = formatter.formatToParts(date);
        const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
        const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
        return {
            hour,
            minute,
            label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        };
    } catch {
        return { hour: 0, minute: 0, label: '--:--' };
    }
}

function isWithinSessionMinutes(currentMinutes: number, startMinutes: number, endMinutes: number): boolean {
    if (startMinutes === endMinutes) return true;
    if (startMinutes < endMinutes) return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function isSessionOpenAt(date: Date, cfg: SessionConfig): boolean {
    const local = getLocalHourMinute(date, cfg.timeZone);
    const currentMinutes = (local.hour * 60) + local.minute;
    return isWithinSessionMinutes(currentMinutes, cfg.startHour * 60, cfg.endHour * 60);
}

function computeSegmentsForLocalDay(cfg: SessionConfig, dayStart: Date): SegmentRange[] {
    const segments: SegmentRange[] = [];
    let inSegment = isSessionOpenAt(dayStart, cfg);
    let segmentStart = inSegment ? 0 : -1;

    for (let minute = 1; minute <= 1440; minute += 1) {
        const sample = new Date(dayStart.getTime() + (minute * 60000));
        const open = minute < 1440 ? isSessionOpenAt(sample, cfg) : false;
        if (open === inSegment) continue;

        if (inSegment && segmentStart >= 0) {
            segments.push({ start: segmentStart, end: minute });
        } else if (open) {
            segmentStart = minute;
        }
        inSegment = open;
    }

    return segments;
}

function isMinuteInsideSegments(minute: number, segments: SegmentRange[]): boolean {
    return segments.some((segment) => minute >= segment.start && minute < segment.end);
}

function minutesUntilNextOpen(nowMinute: number, openNow: boolean, todaySegments: SegmentRange[], tomorrowSegments: SegmentRange[]): number | null {
    if (openNow) return 0;
    const nextToday = todaySegments.find((segment) => segment.start > nowMinute);
    if (nextToday) return nextToday.start - nowMinute;
    if (tomorrowSegments.length > 0) return (1440 - nowMinute) + tomorrowSegments[0].start;
    return null;
}

function formatMinute(minute: number): string {
    const normalized = ((minute % 1440) + 1440) % 1440;
    const hours = Math.floor(normalized / 60);
    const mins = normalized % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function formatDuration(totalMinutes: number): string {
    const safe = Math.max(0, Math.round(totalMinutes));
    const hours = Math.floor(safe / 60);
    const mins = safe % 60;
    if (hours <= 0) return `${mins}m`;
    if (mins <= 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
}

function formatSegments(segments: SegmentRange[]): string {
    if (segments.length <= 0) return 'N/A';
    return segments.map((segment) => `${formatMinute(segment.start)}-${formatMinute(segment.end)}`).join(', ');
}

function minuteToAngle(minute: number): number {
    return ((minute / 1440) * 360) - 90;
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number): { x: number; y: number } {
    const angleRad = (angleDeg * Math.PI) / 180;
    return {
        x: cx + (radius * Math.cos(angleRad)),
        y: cy + (radius * Math.sin(angleRad)),
    };
}

function describeArc(cx: number, cy: number, radius: number, startMinute: number, endMinute: number): string {
    const startAngle = minuteToAngle(startMinute);
    const endAngle = minuteToAngle(endMinute);
    const start = polarToCartesian(cx, cy, radius, startAngle);
    const end = polarToCartesian(cx, cy, radius, endAngle);
    const sweep = endMinute - startMinute;
    const largeArcFlag = sweep > 720 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

export default function TradingSessionsPanel() {
    const [now, setNow] = React.useState<Date>(() => new Date());

    React.useEffect(() => {
        const timer = window.setInterval(() => setNow(new Date()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    const userTimeZone = React.useMemo(() => {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        } catch {
            return 'UTC';
        }
    }, []);

    const nowDateKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    const nowMinute = (now.getHours() * 60) + now.getMinutes();

    const sessionRows = React.useMemo(() => {
        const dayStart = new Date(now);
        dayStart.setHours(0, 0, 0, 0);

        const tomorrowStart = new Date(dayStart.getTime() + (24 * 60 * 60 * 1000));

        return SESSION_CONFIGS.map((cfg) => {
            const todaySegments = computeSegmentsForLocalDay(cfg, dayStart);
            const tomorrowSegments = computeSegmentsForLocalDay(cfg, tomorrowStart);
            const openNow = isMinuteInsideSegments(nowMinute, todaySegments);
            const nextOpenMinutes = minutesUntilNextOpen(nowMinute, openNow, todaySegments, tomorrowSegments);
            const localClock = getLocalHourMinute(now, cfg.timeZone).label;

            return {
                ...cfg,
                todaySegments,
                openNow,
                nextOpenMinutes,
                localClock,
                windowLabel: formatSegments(todaySegments),
            };
        });
    }, [nowDateKey, nowMinute]);

    const activeSessions = sessionRows.filter((row) => row.openNow);
    const overlapLondonNewYork = sessionRows.find((s) => s.key === 'london')?.openNow && sessionRows.find((s) => s.key === 'newYork')?.openNow;
    const overlapSydneyTokyo = sessionRows.find((s) => s.key === 'sydney')?.openNow && sessionRows.find((s) => s.key === 'tokyo')?.openNow;

    const nextSession = sessionRows
        .filter((row) => !row.openNow && row.nextOpenMinutes !== null)
        .sort((a, b) => Number(a.nextOpenMinutes) - Number(b.nextOpenMinutes))[0];

    const displayClock = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const ringCenter = 110;
    const ringMax = 92;
    const ringSpacing = 16;
    const needleAngle = minuteToAngle((now.getHours() * 60) + now.getMinutes() + (now.getSeconds() / 60));
    const needleTarget = polarToCartesian(ringCenter, ringCenter, ringMax + 7, needleAngle);

    return (
        <div className="session-panel">
            <div className={`session-alert ${activeSessions.length > 0 ? 'live' : 'idle'}`}>
                {activeSessions.length > 0
                    ? `Sessions actives: ${activeSessions.map((s) => s.label).join(', ')}`
                    : 'Aucune grande session active pour le moment'}
                {nextSession && !activeSessions.length && (
                    <span className="session-alert-next">
                        Prochaine: {nextSession.label} dans {formatDuration(Number(nextSession.nextOpenMinutes || 0))}
                    </span>
                )}
            </div>

            <div className="session-overlaps">
                <span className={`nt-badge ${overlapLondonNewYork ? 'nt-badge-green' : 'nt-badge-muted'}`}>
                    Londres-New York {overlapLondonNewYork ? 'ON' : 'OFF'}
                </span>
                <span className={`nt-badge ${overlapSydneyTokyo ? 'nt-badge-blue' : 'nt-badge-muted'}`}>
                    Sydney-Tokyo {overlapSydneyTokyo ? 'ON' : 'OFF'}
                </span>
            </div>

            <div className="session-clock-shell">
                <svg className="session-clock-svg" viewBox="0 0 220 220" role="img" aria-label="Trading sessions clock">
                    <circle cx={ringCenter} cy={ringCenter} r={ringMax + 9} className="session-outer-ring" />

                    {[0, 6, 12, 18].map((hour) => {
                        const pos = polarToCartesian(ringCenter, ringCenter, ringMax + 14, minuteToAngle(hour * 60));
                        return (
                            <text key={hour} x={pos.x} y={pos.y} className="session-hour-label">
                                {String(hour).padStart(2, '0')}
                            </text>
                        );
                    })}

                    {sessionRows.map((session, index) => {
                        const radius = ringMax - (index * ringSpacing);
                        return (
                            <g key={session.key}>
                                <circle cx={ringCenter} cy={ringCenter} r={radius} className="session-ring-base" />
                                {session.todaySegments.map((segment, segIndex) => (
                                    <path
                                        key={`${session.key}-${segIndex}`}
                                        d={describeArc(ringCenter, ringCenter, radius, segment.start, segment.end)}
                                        fill="none"
                                        stroke={session.color}
                                        strokeWidth={9}
                                        strokeLinecap="round"
                                        className="session-ring-segment"
                                    />
                                ))}
                            </g>
                        );
                    })}

                    <line
                        x1={ringCenter}
                        y1={ringCenter}
                        x2={needleTarget.x}
                        y2={needleTarget.y}
                        className="session-needle"
                    />
                    <circle cx={ringCenter} cy={ringCenter} r={4.8} className="session-needle-cap" />
                    <circle cx={ringCenter} cy={ringCenter} r={32} className="session-center-disc" />

                    <text x={ringCenter} y={104} textAnchor="middle" className="session-center-title">LOCAL</text>
                    <text x={ringCenter} y={124} textAnchor="middle" className="session-center-time">{displayClock}</text>
                </svg>
            </div>

            <div className="session-timezone">
                Fuseau detecte: <strong>{userTimeZone}</strong>
            </div>

            <div className="session-legend">
                {sessionRows.map((row) => (
                    <div key={row.key} className="session-legend-row">
                        <span className="session-dot" style={{ background: row.color }} />
                        <div className="session-legend-main">
                            <div className="session-legend-head">
                                <span className="session-name">{row.label}</span>
                                <span className={`session-state ${row.openNow ? 'open' : 'closed'}`}>
                                    {row.openNow ? 'OPEN' : row.nextOpenMinutes !== null ? `+${formatDuration(row.nextOpenMinutes)}` : 'CLOSED'}
                                </span>
                            </div>
                            <div className="session-legend-sub">
                                Fenetre locale: {row.windowLabel} | Horloge {row.label}: {row.localClock}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
