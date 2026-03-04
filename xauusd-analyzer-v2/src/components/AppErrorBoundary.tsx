import React from 'react';

type AppErrorBoundaryProps = {
    children: React.ReactNode;
};

type AppErrorBoundaryState = {
    hasError: boolean;
    errorMessage: string;
};

export default class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
    state: AppErrorBoundaryState = {
        hasError: false,
        errorMessage: '',
    };

    static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
        return {
            hasError: true,
            errorMessage: error instanceof Error ? error.message : 'Unexpected runtime error',
        };
    }

    componentDidCatch(error: unknown, info: React.ErrorInfo) {
        const payload = {
            source: 'react-error-boundary',
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : '',
            componentStack: info.componentStack || '',
            href: typeof window !== 'undefined' ? window.location.href : '',
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
            ts: Date.now(),
        };

        fetch('/api/client-error', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: true,
        }).catch(() => {
            // Best-effort logging only.
        });
    }

    render() {
        if (!this.state.hasError) return this.props.children;

        return (
            <div
                style={{
                    minHeight: '100vh',
                    display: 'grid',
                    placeItems: 'center',
                    padding: '24px',
                    background: '#0b0e11',
                    color: '#d1d4dc',
                    fontFamily: 'Inter, system-ui, sans-serif',
                }}
            >
                <div
                    style={{
                        width: 'min(560px, 100%)',
                        border: '1px solid rgba(239, 68, 68, 0.45)',
                        borderRadius: '12px',
                        background: 'rgba(22, 26, 30, 0.95)',
                        padding: '16px',
                    }}
                >
                    <div style={{ fontSize: '14px', fontWeight: 800, color: '#ef4444', marginBottom: '8px' }}>
                        Runtime Error
                    </div>
                    <div style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: 1.5, marginBottom: '12px' }}>
                        L’interface a rencontré une erreur et a été sécurisée pour éviter un écran blanc.
                    </div>
                    <div
                        style={{
                            fontSize: '12px',
                            color: '#f8fafc',
                            background: 'rgba(15, 23, 42, 0.8)',
                            border: '1px solid rgba(148, 163, 184, 0.3)',
                            borderRadius: '8px',
                            padding: '10px',
                            marginBottom: '12px',
                            wordBreak: 'break-word',
                        }}
                    >
                        {this.state.errorMessage || 'Unknown error'}
                    </div>
                    <button
                        type="button"
                        onClick={() => window.location.reload()}
                        style={{
                            border: '1px solid rgba(59, 130, 246, 0.6)',
                            background: 'rgba(59, 130, 246, 0.14)',
                            color: '#93c5fd',
                            borderRadius: '8px',
                            padding: '8px 12px',
                            fontSize: '12px',
                            fontWeight: 700,
                            cursor: 'pointer',
                        }}
                    >
                        Reload
                    </button>
                </div>
            </div>
        );
    }
}
