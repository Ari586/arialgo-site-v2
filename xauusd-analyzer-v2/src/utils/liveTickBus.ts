export type LiveTick = {
    symbol: string;
    price: number;
    timestamp?: number;
};

type TickListener = (tick: LiveTick) => void;

const listeners = new Set<TickListener>();

export function subscribeLiveTick(listener: TickListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function publishLiveTick(tick: LiveTick): void {
    listeners.forEach((listener) => {
        try {
            listener(tick);
        } catch {
            // Listener isolation.
        }
    });
}
