import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WebSocketMessage } from '../hooks/useWebSocket';

type WsStatus = 'connecting' | 'connected' | 'disconnected';
type CallType = 'audio' | 'video';
type CallState = 'idle' | 'calling' | 'ringing' | 'in-call';
type ChatMessageKind = 'text' | 'image' | 'audio';

type Props = {
    wsStatus: WsStatus;
    sendChatRegister: (clientId: string, profile?: { name?: string }) => void;
    sendChatMessage: (message: string | Record<string, unknown>, meta?: Record<string, unknown>) => void;
    sendChatPayload: (payload: WebSocketMessage) => void;
    onChatEvent: (listener: (data: WebSocketMessage) => void) => () => void;
};

type ChatPeer = {
    clientId: string;
    name: string;
    symbol?: string | null;
};

type ChatRow = {
    id: string;
    from: string;
    fromName: string;
    messageType: ChatMessageKind;
    text?: string;
    mediaData?: string;
    fileName?: string;
    timestamp: number;
    isSystem?: boolean;
};

type PendingInvite = {
    from: string;
    fromName: string;
    callType: CallType;
    sessionId: string;
    groupId?: string;
};

type ParticipantState = 'calling' | 'connecting' | 'in-call';

type ParticipantCall = {
    key: string;
    peerId: string;
    peerName: string;
    sessionId: string;
    callType: CallType;
    state: ParticipantState;
    groupId?: string;
};

type RemoteFeed = {
    key: string;
    peerId: string;
    peerName: string;
    callType: CallType;
    stream: MediaStream;
    groupId?: string;
};

const CHAT_CLIENT_ID_KEY = 'ari_chat_client_id_v2';
const CHAT_NAME_KEY = 'ari_chat_name_v2';
const CHAT_FLOATING_BUTTON_POS_KEY = 'ari_chat_fab_pos_v1';
const CHAT_POPUP_SIZE_KEY = 'ari_chat_popup_size_v1';
const CHAT_MESSAGE_COLOR_KEY = 'ari_chat_message_color_v1';
const CHAT_MESSAGE_SIZE_KEY = 'ari_chat_message_size_v1';
const MAX_IMAGE_SIZE = 2_200_000;
const MAX_AUDIO_SIZE = 2_600_000;
const INVITE_TIMEOUT_MS = 30_000;
const DEFAULT_MESSAGE_COLOR = '#089981';
const DEFAULT_MESSAGE_SIZE = 12;
const MIN_MESSAGE_SIZE = 11;
const MAX_MESSAGE_SIZE = 18;
const DEFAULT_PANEL_WIDTH = 860;
const DEFAULT_PANEL_HEIGHT = 760;
const MIN_PANEL_WIDTH = 560;
const MIN_PANEL_HEIGHT = 420;
const PANEL_MARGIN = 8;
const DEFAULT_STUN_SERVERS: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
];

function buildIceServers(): RTCIceServer[] {
    const turnUrlsRaw = String(import.meta.env.VITE_TURN_URLS || import.meta.env.VITE_TURN_URL || '').trim();
    if (!turnUrlsRaw) return DEFAULT_STUN_SERVERS;

    const urls = turnUrlsRaw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    if (!urls.length) return DEFAULT_STUN_SERVERS;

    const username = String(import.meta.env.VITE_TURN_USERNAME || '').trim();
    const credential = String(import.meta.env.VITE_TURN_CREDENTIAL || '').trim();

    const turnServer: RTCIceServer = {
        urls: urls.length === 1 ? urls[0] : urls,
        ...(username ? { username } : {}),
        ...(credential ? { credential } : {}),
    };

    return [...DEFAULT_STUN_SERVERS, turnServer];
}

const STUN_SERVERS: RTCIceServer[] = buildIceServers();

function makeSessionId() {
    return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sessionKey(peerId: string, sessionId: string) {
    return `${peerId}::${sessionId}`;
}

function buildPairSessionId(groupId: string, a: string, b: string) {
    const [x, y] = [String(a || ''), String(b || '')].sort();
    return `pair_${groupId}_${x}_${y}`.replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 120);
}

function normalizeCallType(value: unknown): CallType {
    return value === 'audio' ? 'audio' : 'video';
}

function normalizeChatIdentity(raw: string) {
    const name = String(raw || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 28);

    let asciiName = name;
    try {
        asciiName = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    } catch {
        asciiName = name;
    }

    const id = asciiName
        .replace(/\s+/g, '_')
        .replace(/[^a-zA-Z0-9_.:-]/g, '')
        .slice(0, 56);

    return { name, id };
}

function normalizePeers(raw: unknown): ChatPeer[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((item) => {
            if (!item || typeof item !== 'object') return null;
            const clientId = typeof item.clientId === 'string' ? item.clientId.trim() : '';
            if (!clientId) return null;
            const name = typeof item.name === 'string' && item.name.trim()
                ? item.name.trim().slice(0, 28)
                : clientId;
            return {
                clientId,
                name,
                symbol: typeof item.symbol === 'string' ? item.symbol : null,
            } as ChatPeer;
        })
        .filter((peer): peer is ChatPeer => !!peer);
}

function formatClock(timestamp: number) {
    try {
        return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
        return '--:--:--';
    }
}

function dataUrlToPreview(data?: string) {
    if (!data || !data.startsWith('data:')) return '';
    return data;
}

function fileToDataUrl(file: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

type ChatFabPosition = { x: number; y: number };
type ChatPanelSize = { width: number; height: number };

function getDefaultFabPosition(): ChatFabPosition {
    if (typeof window === 'undefined') return { x: 12, y: 12 };
    const width = 170;
    const height = 44;
    const margin = 12;
    return {
        x: Math.max(margin, window.innerWidth - width - margin),
        y: Math.max(margin, window.innerHeight - height - margin),
    };
}

function readFabPosition(): ChatFabPosition {
    if (typeof window === 'undefined') return { x: 12, y: 12 };
    try {
        const raw = window.localStorage.getItem(CHAT_FLOATING_BUTTON_POS_KEY);
        if (!raw) return getDefaultFabPosition();
        const parsed = JSON.parse(raw) as Partial<ChatFabPosition> | null;
        const x = Number(parsed?.x);
        const y = Number(parsed?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return getDefaultFabPosition();
        return { x: Math.round(x), y: Math.round(y) };
    } catch {
        return getDefaultFabPosition();
    }
}

function clampPanelSize(next: Partial<ChatPanelSize>): ChatPanelSize {
    const widthRaw = Math.round(Number(next.width ?? DEFAULT_PANEL_WIDTH));
    const heightRaw = Math.round(Number(next.height ?? DEFAULT_PANEL_HEIGHT));

    if (typeof window === 'undefined') {
        return {
            width: Math.max(MIN_PANEL_WIDTH, widthRaw || DEFAULT_PANEL_WIDTH),
            height: Math.max(MIN_PANEL_HEIGHT, heightRaw || DEFAULT_PANEL_HEIGHT),
        };
    }

    const maxWidth = Math.max(MIN_PANEL_WIDTH, window.innerWidth - PANEL_MARGIN * 2);
    const maxHeight = Math.max(MIN_PANEL_HEIGHT, window.innerHeight - PANEL_MARGIN * 2);
    const width = Math.min(maxWidth, Math.max(MIN_PANEL_WIDTH, widthRaw || DEFAULT_PANEL_WIDTH));
    const height = Math.min(maxHeight, Math.max(MIN_PANEL_HEIGHT, heightRaw || DEFAULT_PANEL_HEIGHT));

    return { width, height };
}

function getDefaultPanelSize(): ChatPanelSize {
    return clampPanelSize({
        width: Math.min(DEFAULT_PANEL_WIDTH, typeof window === 'undefined' ? DEFAULT_PANEL_WIDTH : window.innerWidth - 40),
        height: Math.min(
            DEFAULT_PANEL_HEIGHT,
            typeof window === 'undefined' ? DEFAULT_PANEL_HEIGHT : Math.round(window.innerHeight * 0.78)
        ),
    });
}

function readPanelSize(): ChatPanelSize {
    if (typeof window === 'undefined') return getDefaultPanelSize();
    try {
        const raw = window.localStorage.getItem(CHAT_POPUP_SIZE_KEY);
        if (!raw) return getDefaultPanelSize();
        const parsed = JSON.parse(raw) as Partial<ChatPanelSize> | null;
        return clampPanelSize(parsed || {});
    } catch {
        return getDefaultPanelSize();
    }
}

function normalizeHexColor(raw: unknown): string {
    const value = String(raw || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
    return DEFAULT_MESSAGE_COLOR;
}

function clampMessageSize(raw: unknown): number {
    const parsed = Number.parseInt(String(raw || ''), 10);
    if (!Number.isFinite(parsed)) return DEFAULT_MESSAGE_SIZE;
    return Math.max(MIN_MESSAGE_SIZE, Math.min(MAX_MESSAGE_SIZE, parsed));
}

function hexToRgba(hex: string, alpha: number): string {
    const color = normalizeHexColor(hex).replace('#', '');
    const value = Number.parseInt(color, 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    const a = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 1));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export default function ChatMessenger({
    wsStatus,
    sendChatRegister,
    sendChatMessage,
    sendChatPayload,
    onChatEvent,
}: Props) {
    const [displayName, setDisplayName] = useState(() => {
        if (typeof window === 'undefined') return '';
        try {
            const saved = String(window.localStorage.getItem(CHAT_NAME_KEY) || '').trim();
            return saved.slice(0, 28);
        } catch {
            return '';
        }
    });
    const identity = useMemo(() => normalizeChatIdentity(displayName), [displayName]);
    const canRegister = identity.name.length > 0 && identity.id.length > 0;

    const [open, setOpen] = useState(false);
    const [registered, setRegistered] = useState(false);
    const [selfId, setSelfId] = useState('');
    const [messages, setMessages] = useState<ChatRow[]>([]);
    const [input, setInput] = useState('');
    const [peers, setPeers] = useState<ChatPeer[]>([]);
    const [selectedPeerId, setSelectedPeerId] = useState('');
    const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null);
    const [callState, setCallState] = useState<CallState>('idle');
    const [callType, setCallType] = useState<CallType>('video');
    const [callInfo, setCallInfo] = useState('No active call');
    const [activeGroupId, setActiveGroupId] = useState('');
    const [groupMembers, setGroupMembers] = useState<string[]>([]);
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteFeeds, setRemoteFeeds] = useState<RemoteFeed[]>([]);
    const [participants, setParticipants] = useState<ParticipantCall[]>([]);
    const [recording, setRecording] = useState(false);
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const [isCompact, setIsCompact] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.matchMedia('(max-width: 760px)').matches;
    });
    const [fabPosition, setFabPosition] = useState<ChatFabPosition>(() => readFabPosition());
    const [panelSize, setPanelSize] = useState<ChatPanelSize>(() => readPanelSize());
    const [panelPosition, setPanelPosition] = useState<ChatFabPosition | null>(null);
    const [isPanelDragging, setIsPanelDragging] = useState(false);
    const [isPanelResizing, setIsPanelResizing] = useState(false);
    const [messageColor, setMessageColor] = useState(() => {
        if (typeof window === 'undefined') return DEFAULT_MESSAGE_COLOR;
        try {
            return normalizeHexColor(window.localStorage.getItem(CHAT_MESSAGE_COLOR_KEY));
        } catch {
            return DEFAULT_MESSAGE_COLOR;
        }
    });
    const [messageFontSize, setMessageFontSize] = useState(() => {
        if (typeof window === 'undefined') return DEFAULT_MESSAGE_SIZE;
        try {
            return clampMessageSize(window.localStorage.getItem(CHAT_MESSAGE_SIZE_KEY));
        } catch {
            return DEFAULT_MESSAGE_SIZE;
        }
    });

    const selfIdRef = useRef(selfId);
    const messageListRef = useRef<HTMLDivElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const localVideoRef = useRef<HTMLVideoElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordingStreamRef = useRef<MediaStream | null>(null);
    const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const recordingStartedAtRef = useRef(0);

    const localStreamRef = useRef<MediaStream | null>(null);
    const participantSnapshotRef = useRef<ParticipantCall[]>([]);
    const activeGroupIdRef = useRef('');
    const groupMembersRef = useRef<string[]>([]);
    const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
    const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
    const sessionMetaRef = useRef<Map<string, Omit<ParticipantCall, 'state'>>>(new Map());
    const inviteTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    const dragStateRef = useRef({
        active: false,
        pointerId: -1,
        startX: 0,
        startY: 0,
        originX: 0,
        originY: 0
    });
    const dragMovedRef = useRef(false);
    const panelDragStateRef = useRef({
        active: false,
        pointerId: -1,
        startX: 0,
        startY: 0,
        originX: 0,
        originY: 0
    });
    const panelResizeStateRef = useRef({
        active: false,
        pointerId: -1,
        startX: 0,
        startY: 0,
        originWidth: 0,
        originHeight: 0
    });

    const seenMessageIdsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        selfIdRef.current = selfId;
    }, [selfId]);

    useEffect(() => {
        participantSnapshotRef.current = participants;
    }, [participants]);

    useEffect(() => {
        activeGroupIdRef.current = activeGroupId;
    }, [activeGroupId]);

    useEffect(() => {
        groupMembersRef.current = groupMembers;
    }, [groupMembers]);

    useEffect(() => {
        if (!participants.length) return;
        const connected = participants.filter((item) => item.state === 'in-call').length;
        setCallState(connected > 0 ? 'in-call' : 'calling');
        setCallInfo(`Group ${callType}: ${connected}/${participants.length} connected`);
    }, [callType, participants]);

    useEffect(() => {
        if (!activeGroupId) return;
        const activeInGroup = participants.some((item) => item.groupId === activeGroupId);
        if (!activeInGroup) {
            setActiveGroupId('');
            setGroupMembers([]);
        }
    }, [activeGroupId, participants]);

    useEffect(() => {
        localStreamRef.current = localStream;
        if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStream;
        }
    }, [localStream]);

    useEffect(() => {
        const list = messageListRef.current;
        if (!list) return;
        list.scrollTop = list.scrollHeight;
    }, [messages, open]);

    useEffect(() => {
        if (!selectedPeerId || peers.every((peer) => peer.clientId !== selectedPeerId)) {
            setSelectedPeerId(peers[0]?.clientId || '');
        }
    }, [peers, selectedPeerId]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            if (displayName.trim()) {
                window.localStorage.setItem(CHAT_NAME_KEY, displayName.trim().slice(0, 28));
            } else {
                window.localStorage.removeItem(CHAT_NAME_KEY);
            }
            window.localStorage.removeItem(CHAT_CLIENT_ID_KEY);
        } catch {
            // Ignore storage errors.
        }
    }, [displayName]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(CHAT_MESSAGE_COLOR_KEY, normalizeHexColor(messageColor));
        } catch {
            // Ignore storage errors.
        }
    }, [messageColor]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(CHAT_MESSAGE_SIZE_KEY, String(clampMessageSize(messageFontSize)));
        } catch {
            // Ignore storage errors.
        }
    }, [messageFontSize]);

    const appendSystemMessage = useCallback((text: string) => {
        setMessages((prev) => [
            ...prev.slice(-149),
            {
                id: `sys_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
                from: 'system',
                fromName: 'System',
                messageType: 'text',
                text,
                timestamp: Date.now(),
                isSystem: true,
            }
        ]);
    }, []);

    const resolvePeerName = useCallback((peerId: string, fallback = '') => {
        const fallbackName = String(fallback || '').trim();
        if (fallbackName) return fallbackName.slice(0, 28);
        return peers.find((peer) => peer.clientId === peerId)?.name || peerId;
    }, [peers]);

    const clearInviteTimeout = useCallback((key?: string) => {
        if (!key) {
            inviteTimeoutsRef.current.forEach((timer) => clearTimeout(timer));
            inviteTimeoutsRef.current.clear();
            return;
        }
        const timer = inviteTimeoutsRef.current.get(key);
        if (timer) {
            clearTimeout(timer);
            inviteTimeoutsRef.current.delete(key);
        }
    }, []);

    const upsertParticipant = useCallback((participant: ParticipantCall) => {
        setParticipants((prev) => {
            const index = prev.findIndex((item) => item.key === participant.key);
            if (index === -1) return [...prev, participant];
            const next = [...prev];
            next[index] = { ...next[index], ...participant };
            return next;
        });
    }, []);

    const removeParticipant = useCallback((key: string) => {
        setParticipants((prev) => prev.filter((item) => item.key !== key));
    }, []);

    const upsertRemoteFeed = useCallback((feed: RemoteFeed) => {
        setRemoteFeeds((prev) => {
            const index = prev.findIndex((item) => item.key === feed.key);
            if (index === -1) return [...prev, feed];
            const next = [...prev];
            next[index] = feed;
            return next;
        });
    }, []);

    const removeRemoteFeed = useCallback((key: string) => {
        setRemoteFeeds((prev) => prev.filter((item) => item.key !== key));
    }, []);

    const stopRecording = useCallback((cancel = false) => {
        const recorder = mediaRecorderRef.current;
        if (!recorder) return;

        const isActive = recorder.state === 'recording' || recorder.state === 'paused';
        if (isActive) recorder.stop();
        mediaRecorderRef.current = null;

        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
        }

        setRecording(false);
        setRecordingSeconds(0);

        const stream = recordingStreamRef.current;
        if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            recordingStreamRef.current = null;
        }

        if (cancel) {
            recordingStartedAtRef.current = 0;
        }
    }, []);

    const stopLocalCallStream = useCallback(() => {
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach((track) => track.stop());
            localStreamRef.current = null;
        }
        setLocalStream(null);
        if (localVideoRef.current) {
            localVideoRef.current.srcObject = null;
        }
    }, []);

    const closeCallSession = useCallback((key: string, notify = true, reason = 'Call ended') => {
        const meta = sessionMetaRef.current.get(key);
        if (!meta) return;

        if (notify) {
            sendChatPayload({
                type: 'chat_call_end',
                to: meta.peerId,
                sessionId: meta.sessionId,
                callType: meta.callType,
                groupId: meta.groupId || undefined,
                reason,
            });
        }

        clearInviteTimeout(key);

        const pc = peerConnectionsRef.current.get(key);
        if (pc) {
            pc.onicecandidate = null;
            pc.ontrack = null;
            pc.onconnectionstatechange = null;
            try {
                pc.close();
            } catch {
                // Ignore close errors.
            }
        }

        peerConnectionsRef.current.delete(key);
        pendingCandidatesRef.current.delete(key);
        sessionMetaRef.current.delete(key);
        removeParticipant(key);
        removeRemoteFeed(key);
        if (meta.groupId) {
            setGroupMembers((prev) => prev.filter((memberId) => memberId !== meta.peerId));
        }

        if (peerConnectionsRef.current.size === 0) {
            stopLocalCallStream();
            setCallState('idle');
            setCallInfo(reason);
            setActiveGroupId('');
            setGroupMembers([]);
        }
    }, [clearInviteTimeout, removeParticipant, removeRemoteFeed, sendChatPayload, stopLocalCallStream]);

    const cleanupCall = useCallback((notify = false, reason = 'Call ended') => {
        clearInviteTimeout();
        setPendingInvite(null);
        const keys = [...peerConnectionsRef.current.keys()];
        keys.forEach((key) => closeCallSession(key, notify, reason));
        if (!keys.length) {
            stopLocalCallStream();
            setParticipants([]);
            setRemoteFeeds([]);
            setCallState('idle');
            setCallInfo(reason);
            setActiveGroupId('');
            setGroupMembers([]);
        }
    }, [clearInviteTimeout, closeCallSession, stopLocalCallStream]);

    const endCall = useCallback((notify = true, reason = 'Call ended') => {
        cleanupCall(notify, reason);
    }, [cleanupCall]);

    const ensureLocalStream = useCallback(async (kind: CallType) => {
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('Media devices unavailable in this browser');
        }

        if (localStreamRef.current) {
            return localStreamRef.current;
        }

        const stream = await navigator.mediaDevices.getUserMedia(
            kind === 'video'
                ? { audio: true, video: { width: { ideal: 640 }, height: { ideal: 360 } } }
                : { audio: true, video: false }
        );

        localStreamRef.current = stream;
        setLocalStream(stream);
        return stream;
    }, []);

    const flushPendingCandidates = useCallback(async (key: string) => {
        const pc = peerConnectionsRef.current.get(key);
        if (!pc || !pc.remoteDescription) return;

        const candidates = [...(pendingCandidatesRef.current.get(key) || [])];
        pendingCandidatesRef.current.set(key, []);
        for (const candidate of candidates) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                console.warn('ICE candidate add failed:', error);
            }
        }
    }, []);

    const attachLocalTracks = useCallback((pc: RTCPeerConnection) => {
        const local = localStreamRef.current;
        if (!local) return;
        local.getTracks().forEach((track) => {
            const exists = pc.getSenders().some((sender) => sender.track?.id === track.id);
            if (!exists) {
                pc.addTrack(track, local);
            }
        });
    }, []);

    const createPeerConnection = useCallback((peerId: string, peerName: string, sessionId: string, kind: CallType, groupId = '') => {
        const key = sessionKey(peerId, sessionId);
        const existing = peerConnectionsRef.current.get(key);
        if (existing) {
            try {
                existing.close();
            } catch {
                // Ignore close errors.
            }
            peerConnectionsRef.current.delete(key);
        }
        const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
        peerConnectionsRef.current.set(key, pc);
        sessionMetaRef.current.set(key, { key, peerId, peerName, sessionId, callType: kind, groupId: groupId || undefined });
        pendingCandidatesRef.current.set(key, []);

        const remote = new MediaStream();
        upsertRemoteFeed({ key, peerId, peerName, callType: kind, stream: remote, groupId: groupId || undefined });

        pc.ontrack = (event) => {
            const sourceStream = event.streams?.[0];
            if (sourceStream) {
                sourceStream.getTracks().forEach((track) => {
                    const exists = remote.getTracks().some((t) => t.id === track.id);
                    if (!exists) remote.addTrack(track);
                });
                return;
            }

            const exists = remote.getTracks().some((track) => track.id === event.track.id);
            if (!exists) remote.addTrack(event.track);
        };

        pc.onicecandidate = (event) => {
            if (!event.candidate) return;
            sendChatPayload({
                type: 'chat_signal',
                to: peerId,
                sessionId,
                callType: kind,
                groupId: groupId || undefined,
                signalType: 'ice-candidate',
                candidate: event.candidate.toJSON(),
            });
        };

        pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            if (state === 'connected') {
                upsertParticipant({ key, peerId, peerName, sessionId, callType: kind, state: 'in-call', groupId: groupId || undefined });
                setCallState('in-call');
                setCallInfo(`Connected with ${peerName} (${kind})`);
            }

            if (state === 'failed' || state === 'disconnected' || state === 'closed') {
                closeCallSession(key, false, `Call ${state}`);
            }
        };

        attachLocalTracks(pc);

        return { key, pc };
    }, [attachLocalTracks, closeCallSession, sendChatPayload, upsertParticipant, upsertRemoteFeed]);

    const handleIncomingSignal = useCallback(async (event: WebSocketMessage) => {
        const from = typeof event.from === 'string' ? event.from : '';
        const sessionId = typeof event.sessionId === 'string' ? event.sessionId : '';
        const signalType = typeof event.signalType === 'string' ? event.signalType : '';
        const kind = normalizeCallType(event.callType);
        const groupId = typeof event.groupId === 'string' ? event.groupId : '';

        if (!from || !sessionId || !signalType) return;
        const key = sessionKey(from, sessionId);
        const peerName = resolvePeerName(from, typeof event.fromName === 'string' ? event.fromName : from);

        try {
            if (signalType === 'offer') {
                let pc = peerConnectionsRef.current.get(key);
                if (!pc) {
                    await ensureLocalStream(kind);
                    const created = createPeerConnection(from, peerName, sessionId, kind, groupId);
                    pc = created.pc;
                    upsertParticipant({ key, peerId: from, peerName, sessionId, callType: kind, state: 'connecting', groupId: groupId || undefined });
                }

                if (!pc) return;
                if (!localStreamRef.current) {
                    await ensureLocalStream(kind);
                }
                attachLocalTracks(pc);
                const offer = event.sdp;
                if (!offer || typeof offer !== 'object') return;

                await pc.setRemoteDescription(new RTCSessionDescription(offer as RTCSessionDescriptionInit));
                await flushPendingCandidates(key);
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);

                sendChatPayload({
                    type: 'chat_signal',
                    to: from,
                    sessionId,
                    callType: kind,
                    groupId: groupId || undefined,
                    signalType: 'answer',
                    sdp: answer,
                });

                setCallState('calling');
                setCallType(kind);
                setCallInfo(`Negotiating ${kind} with ${peerName}...`);
                return;
            }

            if (signalType === 'answer') {
                const pc = peerConnectionsRef.current.get(key);
                const answer = event.sdp;
                if (!pc || !answer || typeof answer !== 'object') return;

                await pc.setRemoteDescription(new RTCSessionDescription(answer as RTCSessionDescriptionInit));
                await flushPendingCandidates(key);
                upsertParticipant({ key, peerId: from, peerName, sessionId, callType: kind, state: 'connecting', groupId: groupId || undefined });
                setCallState('calling');
                setCallInfo(`Negotiating ${kind} with ${peerName}...`);
                return;
            }

            if (signalType === 'ice-candidate') {
                const candidate = event.candidate;
                if (!candidate || typeof candidate !== 'object') return;

                const pc = peerConnectionsRef.current.get(key);
                if (pc && pc.remoteDescription) {
                    await pc.addIceCandidate(new RTCIceCandidate(candidate as RTCIceCandidateInit));
                } else {
                    const queue = pendingCandidatesRef.current.get(key) || [];
                    queue.push(candidate as RTCIceCandidateInit);
                    pendingCandidatesRef.current.set(key, queue);
                }
            }
        } catch (error) {
            console.error('Signal handling failed:', error);
            appendSystemMessage('Call negotiation failed.');
            closeCallSession(key, false, 'Negotiation error');
        }
    }, [appendSystemMessage, attachLocalTracks, closeCallSession, createPeerConnection, ensureLocalStream, flushPendingCandidates, resolvePeerName, sendChatPayload, upsertParticipant]);

    const buildNormalizedGroupMembers = useCallback((input: unknown) => {
        const members = Array.isArray(input) ? input : [];
        const normalized = [...new Set(
            members
                .map((item) => String(item || '').trim())
                .filter((item) => item.length > 0)
                .slice(0, 24)
        )];
        const self = selfIdRef.current;
        if (self && !normalized.includes(self)) normalized.unshift(self);
        return normalized;
    }, []);

    const sendGroupSyncToPeer = useCallback((toPeerId: string, groupId: string, kind: CallType, members: string[]) => {
        if (!toPeerId || !groupId) return;
        sendChatPayload({
            type: 'chat_group_sync',
            to: toPeerId,
            groupId,
            callType: kind,
            members,
        });
    }, [sendChatPayload]);

    const reconcileGroupMesh = useCallback(async (groupId: string, kind: CallType, membersRaw: unknown) => {
        const members = buildNormalizedGroupMembers(membersRaw);
        const self = selfIdRef.current;
        if (!groupId || !self || !members.length) return;

        setActiveGroupId(groupId);
        setGroupMembers(members);
        setCallType(kind);

        await ensureLocalStream(kind);

        const staleSessions = participantSnapshotRef.current.filter(
            (session) => session.groupId === groupId && !members.includes(session.peerId)
        );
        staleSessions.forEach((session) => closeCallSession(session.key, true, 'Removed from group'));

        for (const peerId of members) {
            if (!peerId || peerId === self) continue;
            const sessionId = buildPairSessionId(groupId, self, peerId);
            const key = sessionKey(peerId, sessionId);
            const alreadyConnected = peerConnectionsRef.current.has(key);
            if (alreadyConnected) continue;
            if (self.localeCompare(peerId) >= 0) continue;

            const peerName = resolvePeerName(peerId, peerId);
            const { pc } = createPeerConnection(peerId, peerName, sessionId, kind, groupId);
            upsertParticipant({
                key,
                peerId,
                peerName,
                sessionId,
                callType: kind,
                state: 'connecting',
                groupId,
            });

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendChatPayload({
                type: 'chat_signal',
                to: peerId,
                sessionId,
                callType: kind,
                groupId,
                signalType: 'offer',
                sdp: offer,
            });
        }
    }, [buildNormalizedGroupMembers, closeCallSession, createPeerConnection, ensureLocalStream, resolvePeerName, sendChatPayload, upsertParticipant]);

    useEffect(() => {
        if (wsStatus !== 'connected') {
            setRegistered(false);
            if (participantSnapshotRef.current.length || localStreamRef.current) {
                cleanupCall(false, 'Socket disconnected');
            }
            return;
        }
        if (!canRegister) {
            setRegistered(false);
            if (participantSnapshotRef.current.length || localStreamRef.current) {
                cleanupCall(false, 'Call stopped');
            }
            return;
        }

        sendChatRegister(identity.id, { name: identity.name });
    }, [canRegister, cleanupCall, identity.id, identity.name, sendChatRegister, wsStatus]);

    useEffect(() => {
        return onChatEvent((event) => {
            if (event.type === 'chat_registered') {
                const nextId = typeof event.clientId === 'string' ? event.clientId : identity.id;
                setSelfId(nextId);
                setRegistered(true);

                const nextPeers = normalizePeers(event.peers)
                    .filter((peer) => peer.clientId !== nextId);
                setPeers(nextPeers);
                setCallInfo('Chat ready');
                return;
            }

            if (event.type === 'chat_peers') {
                const nextPeers = normalizePeers(event.peers)
                    .filter((peer) => peer.clientId !== selfIdRef.current);
                setPeers(nextPeers);
                return;
            }

            if (event.type === 'chat_presence') {
                const who = typeof event.name === 'string' ? event.name : String(event.clientId || 'Trader');
                const action = event.event === 'left' ? 'left' : 'joined';
                appendSystemMessage(`${who} ${action} the chat.`);
                return;
            }

            if (event.type === 'chat_ack') {
                if (event.ok === false && typeof event.error === 'string') {
                    appendSystemMessage(`Chat error: ${event.error}`);
                }
                return;
            }

            if (event.type === 'chat_message') {
                const id = typeof event.id === 'string'
                    ? event.id
                    : `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
                if (seenMessageIdsRef.current.has(id)) return;
                seenMessageIdsRef.current.add(id);
                if (seenMessageIdsRef.current.size > 500) {
                    const ids = [...seenMessageIdsRef.current].slice(-350);
                    seenMessageIdsRef.current = new Set(ids);
                }

                const from = typeof event.from === 'string' ? event.from : 'unknown';
                const fromName = typeof event.fromName === 'string' ? event.fromName : from;
                const kind = event.messageType === 'image' || event.messageType === 'audio'
                    ? event.messageType
                    : 'text';
                const text = typeof event.text === 'string' ? event.text : '';
                const mediaData = typeof event.mediaData === 'string' ? event.mediaData : '';
                const timestamp = typeof event.timestamp === 'number' ? event.timestamp : Date.now();

                setMessages((prev) => [
                    ...prev.slice(-149),
                    {
                        id,
                        from,
                        fromName,
                        messageType: kind,
                        text,
                        mediaData,
                        fileName: typeof event.fileName === 'string' ? event.fileName : undefined,
                        timestamp,
                    }
                ]);
                return;
            }

            if (event.type === 'chat_call_invite') {
                const from = typeof event.from === 'string' ? event.from : '';
                if (!from || from === selfIdRef.current) return;
                const groupId = typeof event.groupId === 'string' ? event.groupId : '';

                const invite: PendingInvite = {
                    from,
                    fromName: typeof event.fromName === 'string' ? event.fromName : from,
                    callType: normalizeCallType(event.callType),
                    sessionId: typeof event.sessionId === 'string' ? event.sessionId : `sess_${Date.now().toString(36)}`,
                    groupId: groupId || undefined,
                };

                const sameGroupInvite = !!groupId && groupId === activeGroupIdRef.current;
                if ((participantSnapshotRef.current.length > 0 || !!pendingInvite) && !sameGroupInvite) {
                    sendChatPayload({
                        type: 'chat_call_reject',
                        to: invite.from,
                        sessionId: invite.sessionId,
                        callType: invite.callType,
                        reason: 'Busy',
                    });
                    return;
                }

                setPendingInvite(invite);
                setCallState('ringing');
                setCallType(invite.callType);
                setCallInfo(`Incoming ${invite.callType} call from ${invite.fromName}`);
                appendSystemMessage(`Incoming ${invite.callType} call from ${invite.fromName}.`);
                return;
            }

            if (event.type === 'chat_call_accept') {
                const from = typeof event.from === 'string' ? event.from : '';
                const sessionId = typeof event.sessionId === 'string' ? event.sessionId : '';
                if (!from || !sessionId) return;
                const key = sessionKey(from, sessionId);

                clearInviteTimeout(key);
                const pc = peerConnectionsRef.current.get(key);
                if (!pc) return;
                const meta = sessionMetaRef.current.get(key);
                const callKind = meta?.callType || normalizeCallType(event.callType);
                const groupId = (typeof event.groupId === 'string' ? event.groupId : '') || meta?.groupId || '';
                const peerName = meta?.peerName || resolvePeerName(from, typeof event.fromName === 'string' ? event.fromName : from);

                const run = async () => {
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    sendChatPayload({
                        type: 'chat_signal',
                        to: from,
                        sessionId,
                        callType: callKind,
                        groupId: groupId || undefined,
                        signalType: 'offer',
                        sdp: offer,
                    });
                    upsertParticipant({ key, peerId: from, peerName, sessionId, callType: callKind, state: 'connecting', groupId: groupId || undefined });
                    setCallState('calling');
                    setCallInfo(`Call accepted by ${peerName}, negotiating...`);

                    if (groupId) {
                        const membersSet = new Set(buildNormalizedGroupMembers(groupMembersRef.current));
                        if (selfIdRef.current) membersSet.add(selfIdRef.current);
                        membersSet.add(from);
                        participantSnapshotRef.current
                            .filter((session) => session.groupId === groupId)
                            .forEach((session) => membersSet.add(session.peerId));
                        const members = [...membersSet];
                        setActiveGroupId(groupId);
                        setGroupMembers(members);
                        members
                            .filter((memberId) => memberId !== selfIdRef.current)
                            .forEach((memberId) => sendGroupSyncToPeer(memberId, groupId, callKind, members));
                        void reconcileGroupMesh(groupId, callKind, members);
                    }
                };

                void run();
                return;
            }

            if (event.type === 'chat_call_reject') {
                const from = typeof event.from === 'string' ? event.from : '';
                const sessionId = typeof event.sessionId === 'string' ? event.sessionId : '';
                if (sessionId && from) {
                    const key = sessionKey(from, sessionId);
                    const reason = typeof event.reason === 'string' ? event.reason : 'Call rejected';
                    appendSystemMessage(reason);
                    closeCallSession(key, false, reason);
                }
                return;
            }

            if (event.type === 'chat_call_end') {
                const from = typeof event.from === 'string' ? event.from : '';
                const sessionId = typeof event.sessionId === 'string' ? event.sessionId : '';
                if (sessionId && from) {
                    const key = sessionKey(from, sessionId);
                    appendSystemMessage('Remote user ended the call.');
                    closeCallSession(key, false, 'Call finished');
                }
                return;
            }

            if (event.type === 'chat_signal') {
                void handleIncomingSignal(event);
                return;
            }

            if (event.type === 'chat_group_sync') {
                const groupId = typeof event.groupId === 'string' ? event.groupId : '';
                if (!groupId) return;
                const kind = normalizeCallType(event.callType);
                void reconcileGroupMesh(groupId, kind, event.members);
            }
        });
    }, [appendSystemMessage, buildNormalizedGroupMembers, clearInviteTimeout, closeCallSession, handleIncomingSignal, identity.id, onChatEvent, pendingInvite, reconcileGroupMesh, resolvePeerName, sendChatPayload, sendGroupSyncToPeer, upsertParticipant]);

    const sendText = useCallback(() => {
        if (!registered || wsStatus !== 'connected') {
            appendSystemMessage('Set your name and wait for chat connection first.');
            return;
        }

        const text = input.trim();
        if (!text) return;

        sendChatMessage({ messageType: 'text', text, source: 'chat-ui' });
        setInput('');
    }, [appendSystemMessage, input, registered, sendChatMessage, wsStatus]);

    const sendImage = useCallback(async (file: File) => {
        if (!registered || wsStatus !== 'connected') {
            appendSystemMessage('Set your name and wait for chat connection first.');
            return;
        }

        if (!file.type.startsWith('image/')) {
            appendSystemMessage('Only image files are allowed.');
            return;
        }

        if (file.size > MAX_IMAGE_SIZE) {
            appendSystemMessage('Image too large (max ~2.2MB).');
            return;
        }

        const mediaData = await fileToDataUrl(file);
        sendChatPayload({
            type: 'chat_message',
            messageType: 'image',
            mediaData,
            mimeType: file.type,
            fileName: file.name,
            source: 'chat-ui',
        });
    }, [appendSystemMessage, registered, sendChatPayload, wsStatus]);

    const startAudioRecording = useCallback(async () => {
        if (!registered || wsStatus !== 'connected') {
            appendSystemMessage('Set your name and wait for chat connection first.');
            return;
        }

        if (!navigator.mediaDevices?.getUserMedia) {
            appendSystemMessage('Audio capture unavailable in this browser.');
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            recordingStreamRef.current = stream;

            const preferred = 'audio/webm;codecs=opus';
            const recorder = MediaRecorder.isTypeSupported(preferred)
                ? new MediaRecorder(stream, { mimeType: preferred })
                : new MediaRecorder(stream);

            const chunks: BlobPart[] = [];
            mediaRecorderRef.current = recorder;
            recordingStartedAtRef.current = Date.now();
            setRecordingSeconds(0);
            setRecording(true);

            recorder.ondataavailable = (evt) => {
                if (evt.data && evt.data.size > 0) chunks.push(evt.data);
            };

            recorder.onstop = async () => {
                const startedAt = recordingStartedAtRef.current;
                const durationMs = startedAt > 0 ? Math.max(0, Date.now() - startedAt) : 0;
                const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });

                if (recordingTimerRef.current) {
                    clearInterval(recordingTimerRef.current);
                    recordingTimerRef.current = null;
                }

                if (recordingStreamRef.current) {
                    recordingStreamRef.current.getTracks().forEach((track) => track.stop());
                    recordingStreamRef.current = null;
                }

                mediaRecorderRef.current = null;
                setRecording(false);
                setRecordingSeconds(0);

                if (durationMs < 600 || blob.size < 1024) {
                    appendSystemMessage('Audio too short.');
                    return;
                }

                if (blob.size > MAX_AUDIO_SIZE) {
                    appendSystemMessage('Audio note too large (max ~2.6MB).');
                    return;
                }

                const mediaData = await fileToDataUrl(blob);
                sendChatPayload({
                    type: 'chat_message',
                    messageType: 'audio',
                    mediaData,
                    mimeType: blob.type || 'audio/webm',
                    fileName: `voice-${Date.now()}.webm`,
                    durationMs,
                    source: 'chat-ui',
                });
            };

            recorder.start(200);
            recordingTimerRef.current = setInterval(() => {
                setRecordingSeconds(Math.floor((Date.now() - recordingStartedAtRef.current) / 1000));
            }, 250);
        } catch (error) {
            console.error('Audio recording error:', error);
            appendSystemMessage('Microphone access denied or unavailable.');
            stopRecording(true);
        }
    }, [appendSystemMessage, registered, sendChatPayload, stopRecording, wsStatus]);

    const toggleRecording = useCallback(() => {
        if (recording) {
            stopRecording(false);
            return;
        }
        void startAudioRecording();
    }, [recording, startAudioRecording, stopRecording]);

    const startCallsToPeers = useCallback(async (kind: CallType, peerIds: string[], options?: { groupId?: string }) => {
        if (!registered || wsStatus !== 'connected') {
            appendSystemMessage('Chat is not connected yet.');
            return;
        }

        const uniqueTargetIds = [...new Set(peerIds.filter(Boolean))]
            .filter((peerId) => peerId !== selfIdRef.current)
            .filter((peerId) => !participantSnapshotRef.current.some((item) => item.peerId === peerId));
        if (!uniqueTargetIds.length) {
            appendSystemMessage('No available contacts to call.');
            return;
        }

        try {
            await ensureLocalStream(kind);
            setCallType(kind);
            setCallState('calling');
            const groupId = String(options?.groupId || '').trim();
            if (groupId) setActiveGroupId(groupId);

            uniqueTargetIds.forEach((peerId) => {
                const peerName = resolvePeerName(peerId, peerId);
                const sessionId = groupId
                    ? buildPairSessionId(groupId, selfIdRef.current, peerId)
                    : makeSessionId();
                const { key } = createPeerConnection(peerId, peerName, sessionId, kind, groupId);

                upsertParticipant({
                    key,
                    peerId,
                    peerName,
                    sessionId,
                    callType: kind,
                    state: 'calling',
                    groupId: groupId || undefined
                });

                sendChatPayload({
                    type: 'chat_call_invite',
                    to: peerId,
                    callType: kind,
                    groupId: groupId || undefined,
                    sessionId,
                });

                appendSystemMessage(`Calling ${peerName} (${kind})...`);

                clearInviteTimeout(key);
                inviteTimeoutsRef.current.set(key, setTimeout(() => {
                    const session = participantSnapshotRef.current.find((item) => item.key === key);
                    if (!session || session.state === 'in-call') return;
                    appendSystemMessage(`${peerName} did not answer.`);
                    closeCallSession(key, true, 'No answer');
                }, INVITE_TIMEOUT_MS));
            });

            setCallInfo(`Calling ${uniqueTargetIds.length} participant(s)...`);
            if (groupId) {
                const members = [...new Set([selfIdRef.current, ...uniqueTargetIds].filter(Boolean))];
                setGroupMembers(members);
            }
        } catch (error) {
            console.error('Call init failed:', error);
            appendSystemMessage('Failed to initialize call.');
            cleanupCall(false, 'Call failed');
        }
    }, [appendSystemMessage, cleanupCall, clearInviteTimeout, closeCallSession, createPeerConnection, ensureLocalStream, registered, resolvePeerName, sendChatPayload, upsertParticipant, wsStatus]);

    const startCall = useCallback(async (kind: CallType) => {
        if (!selectedPeerId) {
            appendSystemMessage('Select a contact first.');
            return;
        }
        await startCallsToPeers(kind, [selectedPeerId]);
    }, [appendSystemMessage, selectedPeerId, startCallsToPeers]);

    const syncActiveGroup = useCallback(() => {
        const groupId = String(activeGroupIdRef.current || '').trim();
        if (!groupId) {
            appendSystemMessage('No active group room.');
            return;
        }

        const membersSet = new Set(buildNormalizedGroupMembers(groupMembersRef.current));
        if (selfIdRef.current) membersSet.add(selfIdRef.current);
        participantSnapshotRef.current
            .filter((session) => session.groupId === groupId)
            .forEach((session) => membersSet.add(session.peerId));
        const members = [...membersSet];
        if (!members.length) {
            appendSystemMessage('Group has no members to sync.');
            return;
        }

        setGroupMembers(members);
        members
            .filter((memberId) => memberId !== selfIdRef.current)
            .forEach((memberId) => sendGroupSyncToPeer(memberId, groupId, callType, members));
        void reconcileGroupMesh(groupId, callType, members);
        appendSystemMessage(`Group sync sent (${members.length} members).`);
    }, [appendSystemMessage, buildNormalizedGroupMembers, callType, reconcileGroupMesh, sendGroupSyncToPeer]);

    const startGroupCall = useCallback(async (kind: CallType) => {
        const allOnline = peers.map((peer) => peer.clientId).filter(Boolean);
        if (!allOnline.length) {
            appendSystemMessage('No contacts online for group call.');
            return;
        }

        const existingGroupId = String(activeGroupIdRef.current || '').trim();
        const hasActiveGroup =
            !!existingGroupId
            && (
                participantSnapshotRef.current.some((session) => session.groupId === existingGroupId)
                || groupMembersRef.current.length > 1
            );
        const groupId = hasActiveGroup
            ? existingGroupId
            : `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

        const existingMembers = hasActiveGroup
            ? buildNormalizedGroupMembers(groupMembersRef.current)
            : [selfIdRef.current].filter(Boolean) as string[];
        const targetsSet = new Set(allOnline.filter((peerId) => peerId !== selfIdRef.current));
        existingMembers.forEach((memberId) => targetsSet.delete(memberId));
        const targets = [...targetsSet];
        const members = [...new Set([...existingMembers, selfIdRef.current, ...targets].filter(Boolean))];

        if (!targets.length && hasActiveGroup) {
            appendSystemMessage('No new online members to add. Syncing existing room.');
            setGroupMembers(members);
            members
                .filter((memberId) => memberId !== selfIdRef.current)
                .forEach((memberId) => sendGroupSyncToPeer(memberId, groupId, kind, members));
            void reconcileGroupMesh(groupId, kind, members);
            return;
        }

        await startCallsToPeers(kind, targets, { groupId });
        setActiveGroupId(groupId);
        setGroupMembers(members);
        members
            .filter((memberId) => memberId !== selfIdRef.current)
            .forEach((memberId) => sendGroupSyncToPeer(memberId, groupId, kind, members));
        void reconcileGroupMesh(groupId, kind, members);
    }, [appendSystemMessage, buildNormalizedGroupMembers, peers, reconcileGroupMesh, sendGroupSyncToPeer, startCallsToPeers]);

    const acceptIncomingCall = useCallback(async () => {
        if (!pendingInvite) return;
        const key = sessionKey(pendingInvite.from, pendingInvite.sessionId);
        const groupId = String(pendingInvite.groupId || '').trim();

        try {
            await ensureLocalStream(pendingInvite.callType);
            createPeerConnection(pendingInvite.from, pendingInvite.fromName, pendingInvite.sessionId, pendingInvite.callType, groupId);
            upsertParticipant({
                key,
                peerId: pendingInvite.from,
                peerName: pendingInvite.fromName,
                sessionId: pendingInvite.sessionId,
                callType: pendingInvite.callType,
                state: 'connecting',
                groupId: groupId || undefined
            });

            sendChatPayload({
                type: 'chat_call_accept',
                to: pendingInvite.from,
                callType: pendingInvite.callType,
                groupId: groupId || undefined,
                sessionId: pendingInvite.sessionId,
            });

            setCallType(pendingInvite.callType);
            setCallState('calling');
            setCallInfo(`Connecting with ${pendingInvite.fromName}...`);
            if (groupId) {
                const members = [...new Set([selfIdRef.current, pendingInvite.from].filter(Boolean))];
                setActiveGroupId(groupId);
                setGroupMembers(members);
            }
            setPendingInvite(null);
        } catch (error) {
            console.error('Accept call failed:', error);
            appendSystemMessage('Unable to accept call.');
            closeCallSession(key, false, 'Call failed');
        }
    }, [appendSystemMessage, closeCallSession, createPeerConnection, ensureLocalStream, pendingInvite, sendChatPayload, upsertParticipant]);

    const rejectIncomingCall = useCallback((reason = 'Declined') => {
        if (!pendingInvite) return;

        sendChatPayload({
            type: 'chat_call_reject',
            to: pendingInvite.from,
            sessionId: pendingInvite.sessionId,
            callType: pendingInvite.callType,
            groupId: pendingInvite.groupId || undefined,
            reason,
        });

        setPendingInvite(null);
        if (!participantSnapshotRef.current.length) setCallState('idle');
        setCallInfo(reason);
    }, [pendingInvite, sendChatPayload]);

    useEffect(() => {
        return () => {
            stopRecording(true);
            cleanupCall(false, 'Call ended');
        };
    }, [cleanupCall, stopRecording]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const media = window.matchMedia('(max-width: 760px)');
        const apply = () => setIsCompact(media.matches);
        apply();
        if (typeof media.addEventListener === 'function') {
            media.addEventListener('change', apply);
            return () => media.removeEventListener('change', apply);
        }
        media.addListener(apply);
        return () => media.removeListener(apply);
    }, []);

    useEffect(() => {
        if (typeof document === 'undefined') return;
        if (!open || !isCompact) return;
        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = originalOverflow;
        };
    }, [isCompact, open]);

    useEffect(() => {
        if (typeof window === 'undefined' || !open) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [open]);

    const clampFabPosition = useCallback((next: ChatFabPosition): ChatFabPosition => {
        if (typeof window === 'undefined') return next;
        const margin = 8;
        const buttonWidth = isCompact ? 132 : 172;
        const buttonHeight = 44;
        const maxX = Math.max(margin, window.innerWidth - buttonWidth - margin);
        const maxY = Math.max(margin, window.innerHeight - buttonHeight - margin);
        return {
            x: Math.min(maxX, Math.max(margin, Math.round(next.x))),
            y: Math.min(maxY, Math.max(margin, Math.round(next.y))),
        };
    }, [isCompact]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onResize = () => {
            setFabPosition((prev) => clampFabPosition(prev));
        };
        onResize();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [clampFabPosition]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(CHAT_FLOATING_BUTTON_POS_KEY, JSON.stringify(fabPosition));
        } catch {
            // Ignore storage errors.
        }
    }, [fabPosition]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(CHAT_POPUP_SIZE_KEY, JSON.stringify(clampPanelSize(panelSize)));
        } catch {
            // Ignore storage errors.
        }
    }, [panelSize]);

    const handleFabPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0) return;
        dragMovedRef.current = false;
        dragStateRef.current = {
            active: true,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: fabPosition.x,
            originY: fabPosition.y
        };
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // Ignore pointer capture errors.
        }
    }, [fabPosition.x, fabPosition.y]);

    const handleFabPointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
        const drag = dragStateRef.current;
        if (!drag.active || drag.pointerId !== event.pointerId) return;

        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMovedRef.current = true;

        setFabPosition(clampFabPosition({
            x: drag.originX + dx,
            y: drag.originY + dy
        }));
    }, [clampFabPosition]);

    const handleFabPointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
        const drag = dragStateRef.current;
        if (!drag.active || drag.pointerId !== event.pointerId) return;
        dragStateRef.current.active = false;
        try {
            event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
            // Ignore pointer release errors.
        }
    }, []);

    const handleFabClick = useCallback(() => {
        if (dragMovedRef.current) {
            dragMovedRef.current = false;
            return;
        }
        setOpen((v) => !v);
    }, []);

    const clampPanelPosition = useCallback((next: ChatFabPosition, sizeOverride?: Partial<ChatPanelSize>): ChatFabPosition => {
        if (typeof window === 'undefined') return next;
        const rect = panelRef.current?.getBoundingClientRect();
        const panelWidth = Number(sizeOverride?.width) || rect?.width || panelSize.width;
        const panelHeight = Number(sizeOverride?.height) || rect?.height || panelSize.height;
        const maxX = Math.max(PANEL_MARGIN, window.innerWidth - panelWidth - PANEL_MARGIN);
        const maxY = Math.max(PANEL_MARGIN, window.innerHeight - panelHeight - PANEL_MARGIN);
        return {
            x: Math.min(maxX, Math.max(PANEL_MARGIN, Math.round(next.x))),
            y: Math.min(maxY, Math.max(PANEL_MARGIN, Math.round(next.y))),
        };
    }, [panelSize.height, panelSize.width]);

    const handlePanelPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || isCompact) return;
        const panel = panelRef.current;
        if (!panel) return;

        const rect = panel.getBoundingClientRect();
        const currentX = panelPosition?.x ?? rect.left;
        const currentY = panelPosition?.y ?? rect.top;
        setPanelPosition({ x: currentX, y: currentY });
        setIsPanelDragging(true);

        panelDragStateRef.current = {
            active: true,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: currentX,
            originY: currentY
        };

        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // Ignore pointer capture errors.
        }
    }, [isCompact, panelPosition?.x, panelPosition?.y]);

    const handlePanelPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const drag = panelDragStateRef.current;
        if (!drag.active || drag.pointerId !== event.pointerId) return;

        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        setPanelPosition(clampPanelPosition({
            x: drag.originX + dx,
            y: drag.originY + dy
        }));
    }, [clampPanelPosition]);

    const handlePanelPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const drag = panelDragStateRef.current;
        if (!drag.active || drag.pointerId !== event.pointerId) return;
        panelDragStateRef.current.active = false;
        setIsPanelDragging(false);
        try {
            event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
            // Ignore pointer release errors.
        }
    }, []);

    const handlePanelResizePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || isCompact) return;
        event.preventDefault();
        event.stopPropagation();

        const panel = panelRef.current;
        if (!panel) return;

        const rect = panel.getBoundingClientRect();
        setPanelPosition((prev) => prev || { x: rect.left, y: rect.top });
        setPanelSize(clampPanelSize({ width: rect.width, height: rect.height }));
        setIsPanelResizing(true);

        panelResizeStateRef.current = {
            active: true,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originWidth: rect.width,
            originHeight: rect.height
        };

        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // Ignore pointer capture errors.
        }
    }, [isCompact]);

    const handlePanelResizePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const resize = panelResizeStateRef.current;
        if (!resize.active || resize.pointerId !== event.pointerId) return;
        event.preventDefault();

        const dx = event.clientX - resize.startX;
        const dy = event.clientY - resize.startY;
        const nextSize = clampPanelSize({
            width: resize.originWidth + dx,
            height: resize.originHeight + dy
        });

        setPanelSize(nextSize);
        setPanelPosition((prev) => {
            if (!prev) return prev;
            const clamped = clampPanelPosition(prev, nextSize);
            if (clamped.x === prev.x && clamped.y === prev.y) return prev;
            return clamped;
        });
    }, [clampPanelPosition]);

    const handlePanelResizePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const resize = panelResizeStateRef.current;
        if (!resize.active || resize.pointerId !== event.pointerId) return;
        panelResizeStateRef.current.active = false;
        setIsPanelResizing(false);
        try {
            event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
            // Ignore pointer release errors.
        }
    }, []);

    useEffect(() => {
        if (!open || isCompact) return;
        const onResize = () => {
            setPanelSize((prev) => clampPanelSize(prev));
            setPanelPosition((prev) => {
                if (!prev) return prev;
                const clamped = clampPanelPosition(prev);
                if (clamped.x === prev.x && clamped.y === prev.y) return prev;
                return clamped;
            });
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [clampPanelPosition, isCompact, open]);

    useEffect(() => {
        if (!open) {
            setPanelPosition(null);
            setIsPanelDragging(false);
            setIsPanelResizing(false);
        }
    }, [open]);

    const resetPanelSize = useCallback(() => {
        const next = getDefaultPanelSize();
        setPanelSize(next);
        setPanelPosition((prev) => (prev ? clampPanelPosition(prev, next) : prev));
    }, [clampPanelPosition]);

    const activePeerNames = participants.map((item) => item.peerName).join(', ') || 'No contact';
    const connectedPeers = participants.filter((item) => item.state === 'in-call').length;
    const showCallPanel = callState !== 'idle' || !!localStream || remoteFeeds.length > 0 || participants.length > 0;
    const localHasVideo = !!localStream?.getVideoTracks().length;
    const groupDisplayId = activeGroupId ? (activeGroupId.length > 20 ? `${activeGroupId.slice(0, 20)}...` : activeGroupId) : '—';
    const messageTextSize = clampMessageSize(messageFontSize);
    const messageNameSize = Math.max(10, messageTextSize - 1);
    const messageTimeSize = Math.max(9, messageTextSize - 2);
    const mineMessageBackground = `linear-gradient(180deg, ${hexToRgba(messageColor, 0.25)}, ${hexToRgba(messageColor, 0.14)})`;
    const mineMessageBorder = hexToRgba(messageColor, 0.56);
    const onlineVisitors = wsStatus === 'connected' ? peers.length + (registered ? 1 : 0) : 0;

    return (
        <div
            style={{
                position: 'fixed',
                top: fabPosition.y,
                left: fabPosition.x,
                zIndex: 130,
                display: 'grid',
                gap: 8,
                justifyItems: 'start'
            }}
        >
            {open && (
                <>
                    {isCompact && (
                        <div
                            onClick={() => setOpen(false)}
                            style={{
                                position: 'fixed',
                                inset: 0,
                                background: 'rgba(90, 10, 18, 0.44)',
                                backdropFilter: 'blur(3px)',
                                zIndex: 126
                            }}
                        />
                    )}
                    <div
                        ref={panelRef}
                        style={{
                            position: 'fixed',
                            top: isCompact ? 0 : (panelPosition ? panelPosition.y : '50%'),
                            left: isCompact ? 0 : (panelPosition ? panelPosition.x : '50%'),
                            right: isCompact ? 0 : 'auto',
                            bottom: isCompact ? 0 : 'auto',
                            transform: isCompact ? 'none' : (panelPosition ? 'none' : 'translate(-50%, -50%)'),
                            width: isCompact ? '100vw' : panelSize.width,
                            maxWidth: '100vw',
                            background: 'linear-gradient(180deg, rgba(40, 12, 16, 0.98), rgba(22, 9, 13, 0.98))',
                            border: isCompact ? 'none' : '1px solid rgba(239, 68, 68, 0.45)',
                            borderRadius: isCompact ? 0 : 14,
                            boxShadow: '0 24px 48px rgba(127, 29, 29, 0.38)',
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden',
                            zIndex: 131,
                            height: isCompact ? '100dvh' : panelSize.height,
                        }}
                    >
                        {isCompact && (
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                style={{
                                    position: 'absolute',
                                    top: 'calc(10px + env(safe-area-inset-top))',
                                    right: '10px',
                                    width: 34,
                                    height: 34,
                                    borderRadius: 999,
                                    border: '1px solid rgba(239, 68, 68, 0.45)',
                                    background: 'rgba(127, 29, 29, 0.78)',
                                    color: 'var(--text-main)',
                                    fontSize: 18,
                                    fontWeight: 800,
                                    lineHeight: 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    zIndex: 4,
                                    cursor: 'pointer'
                                }}
                                aria-label="Close messenger"
                                title="Close messenger"
                            >
                                ×
                            </button>
                        )}
                        <div
                            onPointerDown={handlePanelPointerDown}
                            onPointerMove={handlePanelPointerMove}
                            onPointerUp={handlePanelPointerUp}
                            onPointerCancel={handlePanelPointerUp}
                            style={{
                                padding: '10px 12px',
                                borderBottom: '1px solid rgba(239, 68, 68, 0.35)',
                                display: 'grid',
                                gridTemplateColumns: isCompact ? '1fr auto' : '1fr auto auto auto',
                                gap: 8,
                                alignItems: 'center',
                                background: 'linear-gradient(135deg, rgba(127, 29, 29, 0.72), rgba(153, 27, 27, 0.62))',
                                cursor: isCompact ? 'default' : (isPanelDragging ? 'grabbing' : 'grab'),
                                touchAction: isCompact ? 'auto' : 'none',
                                userSelect: 'none',
                            }}
                        >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                <strong style={{ fontSize: 12, letterSpacing: 0.5 }}>AriAlgo Chat Hub</strong>
                                <span style={{ fontSize: 11, color: 'var(--chat-header-meta)' }}>
                                    {registered
                                        ? `ID: ${selfId}`
                                        : canRegister
                                            ? `Pending ID: ${identity.id}`
                                            : 'Enter your name to connect'} · WS {wsStatus.toUpperCase()}
                                </span>
                                <span
                                    style={{
                                        fontSize: 10,
                                        color: 'var(--text-main)',
                                        border: '1px solid rgba(248, 113, 113, 0.4)',
                                        background: 'rgba(127, 29, 29, 0.34)',
                                        borderRadius: 999,
                                        padding: '2px 8px',
                                        width: 'fit-content'
                                    }}
                                >
                                    Online: {onlineVisitors}
                                </span>
                            </div>
                            <input
                                onPointerDown={(event) => event.stopPropagation()}
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value.slice(0, 28))}
                                placeholder="Name (used as ID)"
                                style={{
                                    width: isCompact ? 120 : 150,
                                    border: '1px solid rgba(248, 113, 113, 0.45)',
                                    borderRadius: 6,
                                    fontSize: 11,
                                    padding: '6px 8px',
                                    background: 'rgba(69, 10, 10, 0.72)',
                                    color: 'var(--text-main)',
                                }}
                            />
                            {!isCompact && (
                                <button
                                    type="button"
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onClick={resetPanelSize}
                                    style={{
                                        border: '1px solid rgba(248, 113, 113, 0.45)',
                                        borderRadius: 6,
                                        background: 'rgba(69, 10, 10, 0.72)',
                                        color: 'var(--text-main)',
                                        padding: '6px 8px',
                                        fontSize: 10,
                                        fontWeight: 700,
                                        cursor: 'pointer'
                                    }}
                                >
                                    Default Size
                                </button>
                            )}
                            <button
                                type="button"
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={() => setOpen(false)}
                                style={{
                                    border: '1px solid rgba(248, 113, 113, 0.45)',
                                    borderRadius: 6,
                                    background: 'rgba(127, 29, 29, 0.78)',
                                    color: 'var(--text-main)',
                                    padding: '6px 8px',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: 'pointer'
                                }}
                            >
                                Close
                            </button>
                        </div>

                        <div
                            style={{
                                borderBottom: '1px solid var(--border)',
                                padding: '8px 10px',
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: 6,
                                alignItems: 'center',
                                background: 'var(--bg-secondary)',
                            }}
                        >
                            <select
                                value={selectedPeerId}
                                onChange={(e) => setSelectedPeerId(e.target.value)}
                                style={{
                                    flex: isCompact ? '1 1 100%' : '1 1 220px',
                                    border: '1px solid var(--border)',
                                    borderRadius: 6,
                                    padding: '6px 8px',
                                    fontSize: 11,
                                    background: 'var(--bg-tertiary)',
                                    color: 'var(--text-main)',
                                }}
                            >
                                {!peers.length && <option value="">No contacts online</option>}
                                {peers.map((peer) => (
                                    <option key={peer.clientId} value={peer.clientId}>
                                        {peer.name} {peer.symbol ? `(${peer.symbol})` : ''}
                                    </option>
                                ))}
                            </select>
                            <button
                                type="button"
                                onClick={() => { void startCall('audio'); }}
                                disabled={!registered || wsStatus !== 'connected' || !selectedPeerId || !canRegister}
                                style={{
                                    border: '1px solid #2563eb',
                                    background: 'rgba(37,99,235,0.14)',
                                    color: '#2563eb',
                                    borderRadius: 6,
                                    padding: '6px 8px',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                }}
                            >
                                Audio Call
                            </button>
                            <button
                                type="button"
                                onClick={() => { void startCall('video'); }}
                                disabled={!registered || wsStatus !== 'connected' || !selectedPeerId || !canRegister}
                                style={{
                                    border: '1px solid #089981',
                                    background: 'rgba(8,153,129,0.14)',
                                    color: '#089981',
                                    borderRadius: 6,
                                    padding: '6px 8px',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                }}
                            >
                                Video Call
                            </button>
                            <button
                                type="button"
                                onClick={() => { void startGroupCall('audio'); }}
                                disabled={!registered || wsStatus !== 'connected' || !peers.length || !canRegister}
                                style={{
                                    border: '1px solid #6366f1',
                                    background: 'rgba(99,102,241,0.14)',
                                    color: '#6366f1',
                                    borderRadius: 6,
                                    padding: '6px 8px',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                }}
                            >
                                Group Audio
                            </button>
                            <button
                                type="button"
                                onClick={() => { void startGroupCall('video'); }}
                                disabled={!registered || wsStatus !== 'connected' || !peers.length || !canRegister}
                                style={{
                                    border: '1px solid #7c3aed',
                                    background: 'rgba(124,58,237,0.14)',
                                    color: '#7c3aed',
                                    borderRadius: 6,
                                    padding: '6px 8px',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                }}
                            >
                                Group Video
                            </button>
                            <button
                                type="button"
                                onClick={syncActiveGroup}
                                disabled={!registered || wsStatus !== 'connected' || !activeGroupId}
                                style={{
                                    border: '1px solid #f59e0b',
                                    background: 'rgba(245,158,11,0.14)',
                                    color: '#f59e0b',
                                    borderRadius: 6,
                                    padding: '6px 8px',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: (!registered || wsStatus !== 'connected' || !activeGroupId) ? 'not-allowed' : 'pointer',
                                    opacity: (!registered || wsStatus !== 'connected' || !activeGroupId) ? 0.55 : 1,
                                }}
                            >
                                Sync Group
                            </button>
                            <button
                                type="button"
                                onClick={() => endCall(true, 'Manual hangup')}
                                disabled={!participants.length && callState === 'idle'}
                                style={{
                                    border: '1px solid var(--sell)',
                                    background: 'var(--sell-bg)',
                                    color: 'var(--sell)',
                                    borderRadius: 6,
                                    padding: '6px 8px',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: (!participants.length && callState === 'idle') ? 'not-allowed' : 'pointer',
                                    opacity: (!participants.length && callState === 'idle') ? 0.55 : 1,
                                }}
                            >
                                Hang Up
                            </button>
                            <div style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-secondary)' }}>
                                Room: <span className="mono-text">{groupDisplayId}</span> · Members: {groupMembers.length}
                            </div>
                        </div>

                        {pendingInvite && (
                            <div
                                style={{
                                    borderBottom: '1px solid var(--border)',
                                    padding: '8px 10px',
                                    display: 'flex',
                                    flexDirection: isCompact ? 'column' : 'row',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 8,
                                    background: 'rgba(245,176,65,0.12)',
                                }}
                            >
                                <span style={{ fontSize: 11, color: 'var(--text-main)' }}>
                                    Incoming {pendingInvite.callType} call from {pendingInvite.fromName}
                                </span>
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <button
                                        type="button"
                                        onClick={() => { void acceptIncomingCall(); }}
                                        style={{
                                            border: '1px solid var(--buy)',
                                            background: 'var(--buy-bg)',
                                            color: 'var(--buy)',
                                            borderRadius: 6,
                                            padding: '5px 8px',
                                            fontSize: 11,
                                            fontWeight: 700,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        Accept
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => rejectIncomingCall('Declined')}
                                        style={{
                                            border: '1px solid var(--sell)',
                                            background: 'var(--sell-bg)',
                                            color: 'var(--sell)',
                                            borderRadius: 6,
                                            padding: '5px 8px',
                                            fontSize: 11,
                                            fontWeight: 700,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        Reject
                                    </button>
                                </div>
                            </div>
                        )}

                        {showCallPanel && (
                            <div
                                style={{
                                    borderBottom: '1px solid var(--border)',
                                    padding: '8px',
                                    background: 'var(--bg-tertiary)',
                                    display: 'grid',
                                    gridTemplateColumns: isCompact ? '1fr' : `repeat(${Math.max(1, Math.min(3, remoteFeeds.length + 1))}, minmax(0, 1fr))`,
                                    gap: 8,
                                    alignItems: 'stretch',
                                }}
                            >
                                <div
                                    style={{
                                        border: '1px solid var(--border)',
                                        borderRadius: 8,
                                        minHeight: 92,
                                        overflow: 'hidden',
                                        background: '#000',
                                        position: 'relative',
                                    }}
                                >
                                    <video
                                        ref={localVideoRef}
                                        autoPlay
                                        muted
                                        playsInline
                                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: localHasVideo ? 'block' : 'none' }}
                                    />
                                    {!localHasVideo && (
                                        <div style={{ color: '#fff', fontSize: 11, position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            Local Audio
                                        </div>
                                    )}
                                </div>
                                {remoteFeeds.map((feed) => (
                                    <div
                                        key={feed.key}
                                        style={{
                                            border: '1px solid var(--border)',
                                            borderRadius: 8,
                                            minHeight: 92,
                                            overflow: 'hidden',
                                            background: '#000',
                                            position: 'relative',
                                        }}
                                    >
                                        <video
                                            autoPlay
                                            playsInline
                                            ref={(el) => {
                                                if (el && el.srcObject !== feed.stream) {
                                                    el.srcObject = feed.stream;
                                                }
                                            }}
                                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: feed.callType === 'video' ? 'block' : 'none' }}
                                        />
                                        {feed.callType === 'audio' && (
                                            <div style={{ color: '#fff', fontSize: 11, position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                {feed.peerName} Audio
                                            </div>
                                        )}
                                        <div style={{ position: 'absolute', left: 6, bottom: 6, fontSize: 10, padding: '2px 6px', borderRadius: 999, background: 'rgba(0,0,0,0.52)', color: '#fff' }}>
                                            {feed.peerName}
                                        </div>
                                    </div>
                                ))}
                                <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--text-secondary)' }}>
                                    {callInfo} · Peers: {activePeerNames} · Connected: {connectedPeers}/{participants.length} · State: {callState}
                                </div>
                            </div>
                        )}

                        <div
                            style={{
                                borderBottom: '1px solid var(--border)',
                                padding: '6px 10px',
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: 10,
                                alignItems: 'center',
                                background: 'color-mix(in srgb, var(--bg-tertiary) 86%, transparent 14%)',
                            }}
                        >
                            <strong style={{ fontSize: 11, color: 'var(--text-main)' }}>Message Style</strong>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
                                Color
                                <input
                                    type="color"
                                    value={messageColor}
                                    onChange={(e) => setMessageColor(normalizeHexColor(e.target.value))}
                                    style={{
                                        width: 28,
                                        height: 22,
                                        border: '1px solid var(--border)',
                                        borderRadius: 6,
                                        background: 'var(--bg-secondary)',
                                        padding: 0,
                                        cursor: 'pointer'
                                    }}
                                />
                            </label>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
                                Size
                                <input
                                    type="range"
                                    min={MIN_MESSAGE_SIZE}
                                    max={MAX_MESSAGE_SIZE}
                                    step={1}
                                    value={messageTextSize}
                                    onChange={(e) => setMessageFontSize(clampMessageSize(e.target.value))}
                                />
                            </label>
                            <span className="mono-text" style={{ fontSize: 11, color: 'var(--text-main)' }}>{messageTextSize}px</span>
                            <button
                                type="button"
                                onClick={() => {
                                    setMessageColor(DEFAULT_MESSAGE_COLOR);
                                    setMessageFontSize(DEFAULT_MESSAGE_SIZE);
                                }}
                                style={{
                                    marginLeft: 'auto',
                                    border: '1px solid var(--border)',
                                    background: 'var(--bg-secondary)',
                                    color: 'var(--text-main)',
                                    borderRadius: 7,
                                    padding: '5px 8px',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                }}
                            >
                                Reset
                            </button>
                        </div>

                        <div
                            ref={messageListRef}
                            style={{
                                flex: 1,
                                overflowY: 'auto',
                                padding: '10px 10px 6px',
                                background: 'var(--bg-main)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 8,
                                fontSize: messageTextSize,
                            }}
                        >
                            {messages.length === 0 && (
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', marginTop: 16 }}>
                                    Chat ready. Send text, image, or voice.
                                </div>
                            )}

                            {messages.map((msg) => {
                                const mine = msg.from === selfId || (!!identity.id && msg.from === identity.id);
                                const align = msg.isSystem ? 'center' : mine ? 'flex-end' : 'flex-start';

                                return (
                                    <div key={msg.id} style={{ display: 'flex', justifyContent: align }}>
                                        <div
                                            style={{
                                                maxWidth: '85%',
                                                border: '1px solid var(--border)',
                                                borderRadius: 8,
                                                background: msg.isSystem
                                                    ? 'var(--bg-tertiary)'
                                                    : mine
                                                        ? mineMessageBackground
                                                        : 'var(--bg-secondary)',
                                                borderColor: msg.isSystem
                                                    ? 'var(--border)'
                                                    : mine
                                                        ? mineMessageBorder
                                                        : 'var(--border)',
                                                padding: '7px 8px',
                                                fontSize: messageTextSize,
                                                lineHeight: 1.35,
                                            }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                                                <strong style={{ fontSize: messageNameSize, color: 'var(--chat-message-name)' }}>{msg.fromName}</strong>
                                                <span style={{ fontSize: messageTimeSize, color: 'var(--chat-message-time)' }}>{formatClock(msg.timestamp)}</span>
                                            </div>

                                            {msg.messageType === 'text' && <div>{msg.text}</div>}
                                            {msg.messageType === 'image' && (
                                                <img
                                                    src={dataUrlToPreview(msg.mediaData)}
                                                    alt={msg.fileName || 'image'}
                                                    style={{ maxWidth: '100%', borderRadius: 6, border: '1px solid var(--border)' }}
                                                />
                                            )}
                                            {msg.messageType === 'audio' && (
                                                <audio controls src={dataUrlToPreview(msg.mediaData)} style={{ width: '100%' }} />
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div
                            style={{
                                borderTop: '1px solid var(--border)',
                                background: 'var(--bg-secondary)',
                                padding: 8,
                                display: 'grid',
                                gridTemplateColumns: isCompact ? 'repeat(2, minmax(0, 1fr))' : '1fr auto auto auto',
                                gap: 6,
                                alignItems: 'center',
                            }}
                        >
                            <input
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') sendText();
                                }}
                                placeholder="Type message..."
                                disabled={!registered || wsStatus !== 'connected'}
                                style={{
                                    gridColumn: isCompact ? '1 / -1' : 'auto',
                                    border: '1px solid var(--border)',
                                    borderRadius: 7,
                                    background: 'var(--bg-tertiary)',
                                    color: 'var(--text-main)',
                                    padding: '8px 10px',
                                    fontSize: 12,
                                }}
                            />

                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                style={{ display: 'none' }}
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                        void sendImage(file);
                                    }
                                    e.currentTarget.value = '';
                                }}
                            />

                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={!registered || wsStatus !== 'connected'}
                                style={{
                                    border: '1px solid var(--border)',
                                    background: 'var(--bg-tertiary)',
                                    color: 'var(--text-main)',
                                    borderRadius: 7,
                                    padding: '8px 10px',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                }}
                            >
                                Image
                            </button>

                            <button
                                type="button"
                                onClick={toggleRecording}
                                disabled={!registered || wsStatus !== 'connected'}
                                style={{
                                    border: '1px solid var(--gold)',
                                    background: recording ? 'rgba(245,176,65,0.2)' : 'rgba(245,176,65,0.12)',
                                    color: '#b7791f',
                                    borderRadius: 7,
                                    padding: '8px 10px',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                }}
                            >
                                {recording ? `Stop ${recordingSeconds}s` : 'Voice'}
                            </button>

                            <button
                                type="button"
                                onClick={sendText}
                                disabled={wsStatus !== 'connected' || !registered}
                                style={{
                                    gridColumn: isCompact ? '1 / -1' : 'auto',
                                    border: '1px solid var(--buy)',
                                    background: 'var(--buy-bg)',
                                    color: 'var(--buy)',
                                    borderRadius: 7,
                                    padding: '8px 10px',
                                    fontSize: 11,
                                    fontWeight: 800,
                                    cursor: wsStatus === 'connected' && registered ? 'pointer' : 'not-allowed',
                                    opacity: wsStatus === 'connected' && registered ? 1 : 0.6,
                                }}
                            >
                                Send
                            </button>
                        </div>

                        {!isCompact && (
                            <div
                                onPointerDown={handlePanelResizePointerDown}
                                onPointerMove={handlePanelResizePointerMove}
                                onPointerUp={handlePanelResizePointerUp}
                                onPointerCancel={handlePanelResizePointerUp}
                                style={{
                                    position: 'absolute',
                                    right: 0,
                                    bottom: 0,
                                    width: 20,
                                    height: 20,
                                    cursor: 'nwse-resize',
                                    touchAction: 'none',
                                    zIndex: 5,
                                    background: 'linear-gradient(135deg, transparent 42%, rgba(248, 113, 113, 0.62) 42%, rgba(248, 113, 113, 0.62) 56%, transparent 56%)',
                                    opacity: isPanelResizing ? 1 : 0.86
                                }}
                                title="Resize chat window"
                                aria-label="Resize chat window"
                            />
                        )}
                    </div>
                </>
            )}

            <button
                type="button"
                onClick={handleFabClick}
                onPointerDown={handleFabPointerDown}
                onPointerMove={handleFabPointerMove}
                onPointerUp={handleFabPointerUp}
                onPointerCancel={handleFabPointerUp}
                style={{
                    minWidth: isCompact ? 120 : 156,
                    border: '1px solid rgba(248, 113, 113, 0.5)',
                    background: open
                        ? 'linear-gradient(135deg, rgba(153, 27, 27, 0.86), rgba(127, 29, 29, 0.84))'
                        : 'linear-gradient(135deg, rgba(220, 38, 38, 0.34), rgba(127, 29, 29, 0.3))',
                    color: 'var(--text-main)',
                    borderRadius: 10,
                    padding: '9px 14px',
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: dragStateRef.current.active ? 'grabbing' : 'grab',
                    touchAction: 'none',
                    userSelect: 'none',
                    boxShadow: '0 10px 24px rgba(127, 29, 29, 0.4)',
                }}
            >
                {open ? 'Close Messenger' : 'Open Messenger'}
            </button>
        </div>
    );
}
