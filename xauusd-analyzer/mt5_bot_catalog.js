'use strict';

const BOT_DEFINITIONS = [
    {
        id: 'ari-scalper-m1-005',
        name: 'Ari Scalper M1 0.05',
        shortName: 'Scalper 0.05',
        description: 'ATR scalper mono-symbol M1. Lot par défaut 0.05.',
        filename: 'AriScalper_M1_005.mq5',
        defaults: {
            lotSize: 0.05,
            magicNumber: 123456,
            maxLoss: 2.0,
            maxTrades: 10,
            sym1: 'XAUUSD.m',
            sym2: 'BTCUSD.m',
            sym3: 'ETHUSD.m'
        },
        template: 'SINGLE'
    },
    {
        id: 'ari-scalper-m1-002',
        name: 'Ari Simple Scalper M1 0.02',
        shortName: 'Scalper 0.02',
        description: 'Version légère ATR scalper mono-symbol M1. Lot par défaut 0.02.',
        filename: 'AriSimpleScalper_M1_002.mq5',
        defaults: {
            lotSize: 0.02,
            magicNumber: 123456,
            maxLoss: 2.0,
            maxTrades: 10,
            sym1: 'XAUUSD.m',
            sym2: 'BTCUSD.m',
            sym3: 'ETHUSD.m'
        },
        template: 'SINGLE'
    },
    {
        id: 'ari-scalperm-multi',
        name: 'Ari ScalperM Multi-Symbol',
        shortName: 'ScalperM',
        description: 'Scalper ATR multi-actifs (3 symboles), avec garde-fou perte journalière et max trades.',
        filename: 'AriScalperM_Multi.mq5',
        defaults: {
            lotSize: 0.01,
            magicNumber: 123456,
            maxLoss: 2.0,
            maxTrades: 10,
            sym1: 'XAUUSD.m',
            sym2: 'BTCUSD.m',
            sym3: 'ETHUSD.m'
        },
        template: 'MULTI'
    }
];

const SINGLE_TEMPLATE = `#property copyright "Scalper"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>

input double LotSize = {{LOT_SIZE}};
input int MagicNumber = {{MAGIC_NUMBER}};

CTrade trade;
int hATR;
datetime lastBar = 0;

int OnInit()
{
   Print("Scalper Starting");
   hATR = iATR(_Symbol, PERIOD_M1, 14);
   if(hATR == INVALID_HANDLE) return INIT_FAILED;
   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(50);
   Print("Scalper OK");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   IndicatorRelease(hATR);
}

void OnTick()
{
   datetime currentBar = iTime(_Symbol, PERIOD_M1, 0);
   if(currentBar == lastBar) return;
   lastBar = currentBar;

   double atr[];
   ArraySetAsSeries(atr, true);
   if(CopyBuffer(hATR, 0, 0, 1, atr) < 1) return;

   double op = iOpen(_Symbol, PERIOD_M1, 1);
   double cl = iClose(_Symbol, PERIOD_M1, 1);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);

   if(cl > op)
   {
      double sl = ask - atr[0] * 1.5;
      double tp = ask + atr[0] * 2.5;
      trade.Buy(LotSize, _Symbol, ask, sl, tp, "Scalper");
      Print("BUY");
   }

   if(cl < op)
   {
      double sl = bid + atr[0] * 1.5;
      double tp = bid - atr[0] * 2.5;
      trade.Sell(LotSize, _Symbol, bid, sl, tp, "Scalper");
      Print("SELL");
   }

   Comment("Scalper\\n",
           "Price: ", DoubleToString(bid, 2), "\\n",
           "ATR: ", DoubleToString(atr[0], _Digits), "\\n",
           "Last: ", cl > op ? "Bullish" : "Bearish");
}
`;

const MULTI_TEMPLATE = `#property copyright "ScalperM"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>

input string Sym1 = "{{SYM1}}";
input string Sym2 = "{{SYM2}}";
input string Sym3 = "{{SYM3}}";
input bool Trade1 = true;
input bool Trade2 = true;
input bool Trade3 = true;
input double LotSize = {{LOT_SIZE}};
input double MaxLoss = {{MAX_LOSS}};
input int MaxTrades = {{MAX_TRADES}};
input int MagicNumber = {{MAGIC_NUMBER}};

CTrade trade;
int hATR1 = INVALID_HANDLE;
int hATR2 = INVALID_HANDLE;
int hATR3 = INVALID_HANDLE;
datetime lastBar1 = 0;
datetime lastBar2 = 0;
datetime lastBar3 = 0;
double dayStartBalance = 0.0;
int tradesToday = 0;

int OnInit()
{
   Print("ScalperM Starting");
   if(Trade1) SymbolSelect(Sym1, true);
   if(Trade2) SymbolSelect(Sym2, true);
   if(Trade3) SymbolSelect(Sym3, true);
   if(Trade1) hATR1 = iATR(Sym1, PERIOD_M1, 14);
   if(Trade2) hATR2 = iATR(Sym2, PERIOD_M1, 14);
   if(Trade3) hATR3 = iATR(Sym3, PERIOD_M1, 14);
   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(50);
   dayStartBalance = AccountInfoDouble(ACCOUNT_BALANCE);
   Print("ScalperM OK");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   if(hATR1 != INVALID_HANDLE) IndicatorRelease(hATR1);
   if(hATR2 != INVALID_HANDLE) IndicatorRelease(hATR2);
   if(hATR3 != INVALID_HANDLE) IndicatorRelease(hATR3);
}

void OnTick()
{
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double loss = dayStartBalance - balance;

   bool stopped = false;
   if(loss >= MaxLoss) stopped = true;
   if(tradesToday >= MaxTrades) stopped = true;

   if(stopped == false)
   {
      if(Trade1) DoSymbol(Sym1, hATR1, lastBar1);
      if(Trade2) DoSymbol(Sym2, hATR2, lastBar2);
      if(Trade3) DoSymbol(Sym3, hATR3, lastBar3);
   }

   Comment("ScalperM\\n",
           "Symbols: .m\\n",
           "Loss: $", DoubleToString(loss, 2), " / $", MaxLoss, "\\n",
           "Trades: ", tradesToday, "\\n",
           "Balance: $", DoubleToString(balance, 2));
}

void DoSymbol(string sym, int hATR, datetime &lastBar)
{
   datetime currentBar = iTime(sym, PERIOD_M1, 0);
   if(currentBar == lastBar) return;
   lastBar = currentBar;

   double atr[];
   ArraySetAsSeries(atr, true);
   if(CopyBuffer(hATR, 0, 0, 1, atr) < 1) return;

   double op = iOpen(sym, PERIOD_M1, 1);
   double cl = iClose(sym, PERIOD_M1, 1);
   double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
   double bid = SymbolInfoDouble(sym, SYMBOL_BID);
   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);

   if(cl > op)
   {
      double sl = NormalizeDouble(ask - atr[0] * 1.5, digits);
      double tp = NormalizeDouble(ask + atr[0] * 2.5, digits);
      if(trade.Buy(LotSize, sym, ask, sl, tp, "ScalperM"))
      {
         tradesToday = tradesToday + 1;
         Print("BUY ", sym);
      }
   }

   if(cl < op)
   {
      double sl = NormalizeDouble(bid + atr[0] * 1.5, digits);
      double tp = NormalizeDouble(bid - atr[0] * 2.5, digits);
      if(trade.Sell(LotSize, sym, bid, sl, tp, "ScalperM"))
      {
         tradesToday = tradesToday + 1;
         Print("SELL ", sym);
      }
   }
}
`;

function toSafeNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function renderTemplate(template, params) {
    return template
        .replace(/\{\{LOT_SIZE\}\}/g, String(params.lotSize))
        .replace(/\{\{MAGIC_NUMBER\}\}/g, String(Math.round(params.magicNumber)))
        .replace(/\{\{MAX_LOSS\}\}/g, String(params.maxLoss))
        .replace(/\{\{MAX_TRADES\}\}/g, String(Math.round(params.maxTrades)))
        .replace(/\{\{SYM1\}\}/g, String(params.sym1))
        .replace(/\{\{SYM2\}\}/g, String(params.sym2))
        .replace(/\{\{SYM3\}\}/g, String(params.sym3));
}

function normalizeBotParams(bot, overrides = {}) {
    const base = bot.defaults || {};
    return {
        lotSize: Math.max(0.001, toSafeNumber(overrides.lotSize, base.lotSize || 0.01)),
        magicNumber: Math.max(1, Math.floor(toSafeNumber(overrides.magicNumber, base.magicNumber || 123456))),
        maxLoss: Math.max(0.1, toSafeNumber(overrides.maxLoss, base.maxLoss || 2.0)),
        maxTrades: Math.max(1, Math.floor(toSafeNumber(overrides.maxTrades, base.maxTrades || 10))),
        sym1: String(overrides.sym1 || base.sym1 || 'XAUUSD.m').trim(),
        sym2: String(overrides.sym2 || base.sym2 || 'BTCUSD.m').trim(),
        sym3: String(overrides.sym3 || base.sym3 || 'ETHUSD.m').trim()
    };
}

function listMt5Bots() {
    return BOT_DEFINITIONS.map((bot) => ({
        id: bot.id,
        name: bot.name,
        shortName: bot.shortName,
        description: bot.description,
        filename: bot.filename,
        defaults: { ...bot.defaults }
    }));
}

function getMt5BotDefinition(botId) {
    const id = String(botId || '').trim();
    return BOT_DEFINITIONS.find((bot) => bot.id === id) || null;
}

function renderMt5BotSource(botId, overrides = {}) {
    const bot = getMt5BotDefinition(botId);
    if (!bot) return null;

    const params = normalizeBotParams(bot, overrides);
    const template = bot.template === 'MULTI' ? MULTI_TEMPLATE : SINGLE_TEMPLATE;
    const source = renderTemplate(template, params);

    return {
        bot,
        params,
        filename: bot.filename,
        source
    };
}

module.exports = {
    listMt5Bots,
    getMt5BotDefinition,
    renderMt5BotSource
};
