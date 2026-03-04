#!/usr/bin/env python3
"""
TradingAgents bridge service for AriAlgo.

Endpoints:
  GET  /health
  POST /decision
"""

from __future__ import annotations

import json
import os
import re
import traceback
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from typing import Any, Dict, Optional, Tuple


HOST = os.getenv("TA_BRIDGE_HOST", "0.0.0.0")
PORT = int(os.getenv("TA_BRIDGE_PORT", "8765"))
API_KEY = os.getenv("TA_BRIDGE_API_KEY", "").strip()


def _utc_day() -> str:
    now = datetime.now(timezone.utc)
    return f"{now.year:04d}-{now.month:02d}-{now.day:02d}"


def _normalize_signal(value: Any) -> Optional[str]:
    raw = str(value or "").strip().upper()
    if raw in {"BUY", "SELL", "HOLD"}:
        return raw
    if raw in {"LONG", "BULLISH"}:
        return "BUY"
    if raw in {"SHORT", "BEARISH"}:
        return "SELL"
    if raw in {"NEUTRAL", "WAIT"}:
        return "HOLD"
    return None


def _infer_signal_from_text(value: Any) -> Optional[str]:
    text = str(value or "").upper()
    if not text:
        return None
    buy_idx = re.search(r"\b(BUY|LONG|BULLISH)\b", text)
    sell_idx = re.search(r"\b(SELL|SHORT|BEARISH)\b", text)
    hold_idx = re.search(r"\b(HOLD|NEUTRAL|WAIT)\b", text)

    if buy_idx and not sell_idx:
        return "BUY"
    if sell_idx and not buy_idx:
        return "SELL"
    if hold_idx and not buy_idx and not sell_idx:
        return "HOLD"
    if buy_idx and sell_idx:
        return "BUY" if buy_idx.start() <= sell_idx.start() else "SELL"
    return None


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        out = float(value)
        if out != out:  # NaN
            return default
        return out
    except Exception:
        return default


def _fallback_decision(payload: Dict[str, Any], reason: str) -> Dict[str, Any]:
    indicators = payload.get("indicators") or {}
    score = _safe_float(indicators.get("compositeScore"), 0.0)
    current_price = _safe_float(payload.get("currentPrice"), 0.0)

    if score >= 22:
        signal = "BUY"
    elif score <= -22:
        signal = "SELL"
    else:
        signal = "HOLD"

    confidence = int(max(30, min(88, abs(score))))
    return {
        "success": True,
        "source": "bridge-fallback",
        "signal": signal,
        "confidence": confidence,
        "reasoning": f"Fallback decision (bridge): {reason}",
        "entryPrice": round(current_price, 2) if signal != "HOLD" else 0,
        "takeProfit": 0,
        "stopLoss": 0,
        "asOfDate": str(payload.get("asOfDate") or _utc_day()),
    }


class TradingAgentsEngine:
    def __init__(self) -> None:
        self._lock = Lock()
        self._loaded = False
        self._available = False
        self._error = ""
        self._graph = None

    def _load(self) -> None:
        with self._lock:
            if self._loaded:
                return
            self._loaded = True
            try:
                from tradingagents.default_config import DEFAULT_CONFIG
                from tradingagents.graph.trading_graph import TradingAgentsGraph

                config = dict(DEFAULT_CONFIG)
                provider = os.getenv("TA_LLM_PROVIDER", "").strip()
                deep_llm = os.getenv("TA_DEEP_THINK_LLM", "").strip()
                quick_llm = os.getenv("TA_QUICK_THINK_LLM", "").strip()
                max_debate_rounds = os.getenv("TA_MAX_DEBATE_ROUNDS", "").strip()
                backend_url = os.getenv("TA_BACKEND_URL", "").strip()

                if provider:
                    config["llm_provider"] = provider
                if deep_llm:
                    config["deep_think_llm"] = deep_llm
                if quick_llm:
                    config["quick_think_llm"] = quick_llm
                if backend_url:
                    config["backend_url"] = backend_url
                if max_debate_rounds.isdigit():
                    config["max_debate_rounds"] = int(max_debate_rounds)

                self._graph = TradingAgentsGraph(debug=False, config=config)
                self._available = True
            except Exception as exc:  # pragma: no cover
                self._available = False
                self._error = str(exc)

    def status(self) -> Dict[str, Any]:
        if not self._loaded:
            self._load()
        return {
            "loaded": self._loaded,
            "available": self._available,
            "error": self._error or None,
        }

    def decide(self, ticker: str, as_of_date: str) -> Tuple[bool, Any, str]:
        if not self._loaded:
            self._load()
        if not self._available or self._graph is None:
            return False, None, self._error or "TradingAgents package unavailable"
        try:
            _, decision = self._graph.propagate(ticker, as_of_date)
            return True, decision, ""
        except Exception as exc:  # pragma: no cover
            return False, None, str(exc)


ENGINE = TradingAgentsEngine()


def _authorize(headers: Dict[str, str]) -> bool:
    if not API_KEY:
        return True
    provided = (headers.get("x-api-key") or "").strip()
    if not provided:
        auth = (headers.get("authorization") or "").strip()
        if auth.lower().startswith("bearer "):
            provided = auth[7:].strip()
    return provided == API_KEY


def _normalize_bridge_output(payload: Dict[str, Any], decision: Any) -> Dict[str, Any]:
    if isinstance(decision, dict):
        signal = (
            _normalize_signal(decision.get("signal"))
            or _normalize_signal(decision.get("action"))
            or _normalize_signal(decision.get("recommendation"))
        )
        confidence = _safe_float(decision.get("confidence"), 64.0)
        reasoning = (
            str(decision.get("reasoning") or decision.get("summary") or "").strip()
            or json.dumps(decision, ensure_ascii=False)[:420]
        )
        entry = _safe_float(decision.get("entryPrice"), _safe_float(payload.get("currentPrice"), 0.0))
        tp = _safe_float(decision.get("takeProfit"), 0.0)
        sl = _safe_float(decision.get("stopLoss"), 0.0)
    else:
        text = str(decision or "")
        signal = _infer_signal_from_text(text)
        confidence = 62.0
        reasoning = text[:420] if text else ""
        entry = _safe_float(payload.get("currentPrice"), 0.0)
        tp = 0.0
        sl = 0.0

    signal = signal or "HOLD"
    if not reasoning:
        reasoning = f"TradingAgents decision: {signal}."

    return {
        "success": True,
        "source": "tradingagents",
        "signal": signal,
        "confidence": int(max(1, min(99, round(confidence)))),
        "reasoning": reasoning,
        "entryPrice": round(entry, 2) if signal != "HOLD" else 0,
        "takeProfit": round(tp, 2) if signal != "HOLD" else 0,
        "stopLoss": round(sl, 2) if signal != "HOLD" else 0,
        "rawDecision": decision,
        "asOfDate": str(payload.get("asOfDate") or _utc_day()),
        "ticker": str(payload.get("symbol") or ""),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "TradingAgentsBridge/1.0"

    def _send_json(self, code: int, payload: Dict[str, Any]) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, x-api-key, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send_json(200, {"success": True})

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") == "/health":
            self._send_json(
                200,
                {
                    "success": True,
                    "service": "tradingagents-bridge",
                    "utc": datetime.now(timezone.utc).isoformat(),
                    "engine": ENGINE.status(),
                },
            )
            return
        self._send_json(404, {"success": False, "error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/decision":
            self._send_json(404, {"success": False, "error": "Not found"})
            return
        if not _authorize({k.lower(): v for k, v in self.headers.items()}):
            self._send_json(401, {"success": False, "error": "Unauthorized"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except Exception:
            length = 0

        try:
            raw_body = self.rfile.read(max(0, length)).decode("utf-8") if length > 0 else "{}"
            payload = json.loads(raw_body) if raw_body.strip() else {}
            if not isinstance(payload, dict):
                raise ValueError("Body must be a JSON object")
        except Exception as exc:
            self._send_json(400, {"success": False, "error": f"Invalid JSON body: {exc}"})
            return

        ticker = str(payload.get("symbol") or "").strip().upper()
        if not ticker:
            self._send_json(400, {"success": False, "error": "Missing symbol"})
            return
        as_of_date = str(payload.get("asOfDate") or _utc_day())
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", as_of_date):
            as_of_date = _utc_day()
        payload["asOfDate"] = as_of_date

        ok, decision, err = ENGINE.decide(ticker, as_of_date)
        if not ok:
            fallback = _fallback_decision(payload, f"TradingAgents unavailable: {err}")
            self._send_json(200, fallback)
            return

        try:
            response = _normalize_bridge_output(payload, decision)
            self._send_json(200, response)
        except Exception as exc:
            fallback = _fallback_decision(payload, f"Decision normalization error: {exc}")
            self._send_json(200, fallback)

    def log_message(self, fmt: str, *args: Any) -> None:
        msg = fmt % args
        print(f"[bridge] {self.address_string()} - {msg}")


def main() -> None:
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(
        f"TradingAgents bridge running on http://{HOST}:{PORT} "
        f"(api_key={'on' if API_KEY else 'off'})"
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover
        print("Fatal bridge error:", exc)
        traceback.print_exc()
