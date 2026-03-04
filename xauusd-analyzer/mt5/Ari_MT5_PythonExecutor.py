#!/usr/bin/env python3
"""
Ari_MT5_PythonExecutor.py
---------------------------------------------------------------
Automatic MT5 execution bridge for Ari backend (web -> MT5).

Requirements:
  pip install MetaTrader5 requests

Run:
  python Ari_MT5_PythonExecutor.py

Optional env overrides:
  ARI_API_BASE_URL
  ARI_SITE_USER
  ARI_SITE_CODE
  ARI_BRIDGE_TOKEN
  ARI_BROKER_SYMBOL
  ARI_POLL_INTERVAL_SEC
  ARI_HEARTBEAT_EVERY_SEC
  ARI_HTTP_TIMEOUT_SEC
  ARI_DEVIATION_POINTS
  ARI_MAGIC_NUMBER
  ARI_AUTOTRADE
"""

from __future__ import annotations

import base64
import os
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

import requests

try:
    import MetaTrader5 as mt5
except Exception as exc:  # pragma: no cover
    raise SystemExit(
        "MetaTrader5 Python package missing. Install with: pip install MetaTrader5"
    ) from exc


API_BASE_URL = os.getenv("ARI_API_BASE_URL", "{{API_BASE_URL}}").strip().rstrip("/")
NEXT_COMMAND_PATH = os.getenv("ARI_NEXT_COMMAND_PATH", "/api/mt5/executor/next").strip()
ACK_PATH = os.getenv("ARI_ACK_PATH", "/api/mt5/executor/ack").strip()
HEARTBEAT_PATH = os.getenv("ARI_HEARTBEAT_PATH", "/api/mt5/bots/heartbeat").strip()

SITE_USER = os.getenv("ARI_SITE_USER", "{{SITE_USER}}").strip()
SITE_CODE = os.getenv("ARI_SITE_CODE", "{{SITE_CODE}}").strip()
BRIDGE_TOKEN = os.getenv("ARI_BRIDGE_TOKEN", "{{BRIDGE_TOKEN}}").strip()

BROKER_SYMBOL_OVERRIDE = os.getenv("ARI_BROKER_SYMBOL", "").strip()

POLL_INTERVAL_SEC = max(1, int(os.getenv("ARI_POLL_INTERVAL_SEC", "2")))
HEARTBEAT_EVERY_SEC = max(2, int(os.getenv("ARI_HEARTBEAT_EVERY_SEC", "6")))
HTTP_TIMEOUT_SEC = max(1.0, float(os.getenv("ARI_HTTP_TIMEOUT_SEC", "5")))
DEVIATION_POINTS = max(1, int(os.getenv("ARI_DEVIATION_POINTS", "50")))
MAGIC_NUMBER = max(1, int(os.getenv("ARI_MAGIC_NUMBER", "123456")))
AUTO_TRADE_ENABLED = os.getenv("ARI_AUTOTRADE", "1").strip().lower() not in {"0", "false", "off", "no"}

TERMINAL_LABEL = "mt5-python-executor"

session = requests.Session()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_headers() -> Dict[str, str]:
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if SITE_USER or SITE_CODE:
        raw = f"{SITE_USER}:{SITE_CODE}".encode("utf-8")
        headers["Authorization"] = f"Basic {base64.b64encode(raw).decode('ascii')}"
    if BRIDGE_TOKEN:
        headers["x-mt5-token"] = BRIDGE_TOKEN
    return headers


def post_json(path: str, payload: Dict[str, Any]) -> Tuple[bool, int, Any]:
    if not API_BASE_URL:
        return False, 0, {"error": "api_base_url_missing"}

    url = f"{API_BASE_URL}{path}"
    try:
        response = session.post(url, headers=build_headers(), json=payload, timeout=HTTP_TIMEOUT_SEC)
    except requests.RequestException as exc:
        return False, 0, {"error": "request_failed", "message": str(exc), "url": url}

    status = response.status_code
    try:
        body: Any = response.json()
    except ValueError:
        body = {"raw": response.text}

    return 200 <= status < 300, status, body


def to_float(value: Any, fallback: float = 0.0) -> float:
    try:
        n = float(value)
        return n if n == n else fallback
    except Exception:
        return fallback


def normalize_command(payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    command = payload.get("command")
    source = command if isinstance(command, dict) else payload
    if not isinstance(source, dict):
        return None

    command_id = str(source.get("commandId") or "").strip()
    side = str(source.get("side") or "").strip().upper()
    if not command_id or side not in {"BUY", "SELL"}:
        return None

    return {
        "commandId": command_id,
        "side": side,
        "symbol": str(source.get("symbol") or "").strip(),
        "brokerSymbol": str(source.get("brokerSymbol") or "").strip(),
        "volume": max(0.0, to_float(source.get("volume"), 0.0)),
        "entryPrice": max(0.0, to_float(source.get("entryPrice"), 0.0)),
        "stopLoss": max(0.0, to_float(source.get("stopLoss"), 0.0)),
        "takeProfit": max(0.0, to_float(source.get("takeProfit"), 0.0)),
    }


def get_account_id() -> str:
    info = mt5.account_info()
    if info and getattr(info, "login", None):
        return str(info.login)
    return "default"


def resolve_exec_symbol(command_symbol: str) -> str:
    if BROKER_SYMBOL_OVERRIDE:
        return BROKER_SYMBOL_OVERRIDE
    if command_symbol:
        return command_symbol
    return "XAUUSD"


def round_to_digits(symbol: str, price: float) -> float:
    info = mt5.symbol_info(symbol)
    digits = int(getattr(info, "digits", 5)) if info else 5
    return round(price, digits)


def adjust_stops(symbol: str, side: str, sl: float, tp: float) -> Tuple[float, float]:
    info = mt5.symbol_info(symbol)
    tick = mt5.symbol_info_tick(symbol)
    if not info or not tick:
        return sl, tp

    point = float(getattr(info, "point", 0.0)) or 0.00001
    stops = int(getattr(info, "trade_stops_level", 0) or 0)
    freeze = int(getattr(info, "trade_freeze_level", 0) or 0)
    min_dist = float(max(stops, freeze) + 2) * point
    ref = float(getattr(tick, "ask", 0.0) if side == "BUY" else getattr(tick, "bid", 0.0))

    if ref <= 0:
        return sl, tp

    if side == "BUY":
        if sl > 0:
            sl = min(sl, ref - min_dist)
        if tp > 0:
            tp = max(tp, ref + min_dist)
    else:
        if sl > 0:
            sl = max(sl, ref + min_dist)
        if tp > 0:
            tp = min(tp, ref - min_dist)

    if sl > 0:
        sl = round_to_digits(symbol, sl)
    if tp > 0:
        tp = round_to_digits(symbol, tp)
    return sl, tp


def send_ack(command_id: str, status: str, fill_price: float, volume: float, note: str) -> bool:
    payload = {
        "commandId": command_id,
        "status": status,
        "fillPrice": fill_price,
        "volume": volume,
        "note": note,
        "token": BRIDGE_TOKEN,
    }
    ok, http_code, body = post_json(ACK_PATH, payload)
    if not ok:
        print(f"[ACK] failed http={http_code} body={body}")
    return ok


def send_heartbeat(last_action: str, last_execution_at: Optional[str]) -> bool:
    account = mt5.account_info()
    symbol = BROKER_SYMBOL_OVERRIDE or ""
    payload = {
        "token": BRIDGE_TOKEN,
        "terminal": TERMINAL_LABEL,
        "accountId": get_account_id(),
        "symbol": symbol,
        "brokerSymbol": symbol,
        "equity": float(getattr(account, "equity", 0.0) or 0.0) if account else 0.0,
        "balance": float(getattr(account, "balance", 0.0) or 0.0) if account else 0.0,
        "openPositions": int(mt5.positions_total() or 0),
        "lastAction": last_action,
    }
    if last_execution_at:
        payload["lastExecutionAt"] = last_execution_at
    ok, http_code, body = post_json(HEARTBEAT_PATH, payload)
    if not ok:
        print(f"[HB] failed http={http_code} body={body}")
    return ok


def execute_trade(command: Dict[str, Any]) -> Tuple[str, float, str]:
    command_id = command["commandId"]
    side = command["side"]
    symbol = resolve_exec_symbol(command.get("brokerSymbol") or command.get("symbol") or "")
    volume = max(0.0, float(command.get("volume") or 0.0))
    sl = float(command.get("stopLoss") or 0.0)
    tp = float(command.get("takeProfit") or 0.0)

    if volume <= 0:
        return "REJECTED", 0.0, "Invalid volume"

    if not mt5.symbol_select(symbol, True):
        return "REJECTED", 0.0, f"SymbolSelect failed: {symbol}"

    sl, tp = adjust_stops(symbol, side, sl, tp)

    order_type = mt5.ORDER_TYPE_BUY if side == "BUY" else mt5.ORDER_TYPE_SELL
    request: Dict[str, Any] = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": volume,
        "type": order_type,
        "deviation": DEVIATION_POINTS,
        "magic": MAGIC_NUMBER,
        "comment": f"AriPyExec {command_id[:22]}",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }
    if sl > 0:
        request["sl"] = sl
    if tp > 0:
        request["tp"] = tp

    result = mt5.order_send(request)
    if result is None:
        code, msg = mt5.last_error()
        return "REJECTED", 0.0, f"order_send failed: {code} {msg}"

    retcode = int(getattr(result, "retcode", 0) or 0)
    fill_price = float(getattr(result, "price", 0.0) or 0.0)
    note = str(getattr(result, "comment", "") or "")

    if retcode == mt5.TRADE_RETCODE_INVALID_STOPS:
        fallback = dict(request)
        fallback.pop("sl", None)
        fallback.pop("tp", None)
        fallback["comment"] = f"{request['comment']} fallback"
        result = mt5.order_send(fallback)
        if result is None:
            code, msg = mt5.last_error()
            return "REJECTED", 0.0, f"fallback order_send failed: {code} {msg}"
        retcode = int(getattr(result, "retcode", 0) or 0)
        fill_price = float(getattr(result, "price", 0.0) or 0.0)
        note = f"{str(getattr(result, 'comment', '') or '')} | fallback_no_stops"

    if fill_price <= 0:
        tick = mt5.symbol_info_tick(symbol)
        if tick:
            fill_price = float(getattr(tick, "ask", 0.0) if side == "BUY" else getattr(tick, "bid", 0.0))

    done_codes = {mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_DONE_PARTIAL}
    if retcode in done_codes:
        return "FILLED", fill_price, note or "FILLED"
    return "REJECTED", fill_price, f"retcode={retcode} {note}"


def poll_next(last_command_id: str) -> Tuple[str, str, Optional[str]]:
    if not AUTO_TRADE_ENABLED:
        return last_command_id, "AUTO_OFF", None

    payload = {
        "token": BRIDGE_TOKEN,
        "accountId": get_account_id(),
        "brokerSymbol": BROKER_SYMBOL_OVERRIDE,
    }
    ok, http_code, body = post_json(NEXT_COMMAND_PATH, payload)
    if not ok:
        print(f"[NEXT] failed http={http_code} body={body}")
        return last_command_id, "NEXT_FAIL", None

    if not isinstance(body, dict) or not body.get("hasCommand"):
        return last_command_id, "IDLE", None

    command = normalize_command(body)
    if not command:
        return last_command_id, "INVALID_COMMAND", None

    command_id = command["commandId"]
    if command_id == last_command_id:
        return last_command_id, "DUPLICATE_SKIP", None

    status, fill_price, note = execute_trade(command)
    ack_ok = send_ack(command_id, status, fill_price, float(command["volume"]), note)
    if ack_ok:
        action = f"{command['side']} {command.get('brokerSymbol') or command.get('symbol')} {status}"
        print(f"[EXEC] {action} @ {fill_price:.5f} | cmd={command_id}")
        return command_id, action, now_iso()

    return last_command_id, "ACK_FAIL", None


def validate_config() -> None:
    if not API_BASE_URL or "{{API_BASE_URL}}" in API_BASE_URL:
        raise SystemExit("Missing API base URL. Set ARI_API_BASE_URL or use preconfigured downloaded script.")
    if not SITE_USER or "{{SITE_USER}}" in SITE_USER:
        print("Warning: SITE_USER not configured.")
    if not SITE_CODE or "{{SITE_CODE}}" in SITE_CODE:
        print("Warning: SITE_CODE not configured.")
    if not BRIDGE_TOKEN or "{{BRIDGE_TOKEN}}" in BRIDGE_TOKEN:
        print("Warning: BRIDGE_TOKEN not configured.")


def main() -> int:
    validate_config()

    if not mt5.initialize():
        code, msg = mt5.last_error()
        print(f"MT5 initialize failed: {code} {msg}")
        return 1

    account = mt5.account_info()
    login = getattr(account, "login", "n/a") if account else "n/a"
    print(
        f"Ari_MT5_PythonExecutor started | account={login} | poll={POLL_INTERVAL_SEC}s "
        f"| heartbeat={HEARTBEAT_EVERY_SEC}s | autotrade={'ON' if AUTO_TRADE_ENABLED else 'OFF'}"
    )

    last_heartbeat = 0.0
    last_command_id = ""
    last_action = "INIT"
    last_execution_at: Optional[str] = None

    try:
        while True:
            now = time.time()
            if now - last_heartbeat >= HEARTBEAT_EVERY_SEC:
                send_heartbeat(last_action, last_execution_at)
                last_heartbeat = now

            new_command_id, action, execution_at = poll_next(last_command_id)
            last_command_id = new_command_id
            if action:
                last_action = action
            if execution_at:
                last_execution_at = execution_at

            time.sleep(POLL_INTERVAL_SEC)
    except KeyboardInterrupt:
        print("Stopping Ari_MT5_PythonExecutor...")
    finally:
        mt5.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
