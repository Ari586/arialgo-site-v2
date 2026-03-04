# TradingAgents Bridge (Phase 1)

This bridge exposes a lightweight HTTP API so the Node backend can call `TradingAgents` safely.

## 1) Start the bridge service

```bash
cd xauusd-analyzer
python3 tools/tradingagents_bridge.py
```

Default URL:
- `http://localhost:8765`

## 2) Optional env vars (bridge side)

- `TA_BRIDGE_HOST` (default: `0.0.0.0`)
- `TA_BRIDGE_PORT` (default: `8765`)
- `TA_BRIDGE_API_KEY` (optional security token)
- `TA_LLM_PROVIDER` (example: `openai`)
- `TA_DEEP_THINK_LLM` (example: `gpt-5.2`)
- `TA_QUICK_THINK_LLM` (example: `gpt-5-mini`)
- `TA_MAX_DEBATE_ROUNDS` (example: `1`)
- `TA_BACKEND_URL` (optional OpenAI-compatible base URL)

If `TradingAgents` package is unavailable, the bridge returns a deterministic fallback decision so the app keeps running.

## 3) Wire Node backend

Set in `xauusd-analyzer/.env`:

```bash
TRADING_AGENTS_API_URL=http://127.0.0.1:8765
TRADING_AGENTS_API_KEY=
TRADING_AGENTS_TIMEOUT_MS=45000
TRADING_AGENTS_MODEL_LABEL=TradingAgents Graph
TRADING_AGENTS_INCLUDE_IN_AUTO=false
```

Then restart Node server.

## 4) Verify

- `GET /api/tradingagents/status` on Node backend
- `POST /api/tradingagents/decision` on Node backend
- In UI, select `TradingAgents Graph` in AI model selector
