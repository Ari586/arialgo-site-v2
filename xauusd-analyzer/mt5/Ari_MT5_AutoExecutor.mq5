//+------------------------------------------------------------------+
//| Ari_MT5_AutoExecutor.mq5                                         |
//| Polls Ari backend for commands and executes trades automatically |
//+------------------------------------------------------------------+
#property strict
#property version   "1.00"
#property description "Ari MT5 auto executor (next/ack/heartbeat)"

#include <Trade/Trade.mqh>

input string ApiBaseUrl              = "{{API_BASE_URL}}";
input string NextCommandPath         = "/api/mt5/executor/next";
input string AckPath                 = "/api/mt5/executor/ack";
input string HeartbeatPath           = "/api/mt5/bots/heartbeat";
input string SiteUser                = "{{SITE_USER}}";
input string SiteCode                = "{{SITE_CODE}}";
input string BridgeToken             = "{{BRIDGE_TOKEN}}";
input bool   UseChartSymbolAsBroker  = true;
input string BrokerSymbolOverride    = "";
input int    PollIntervalSec         = 2;
input int    HeartbeatEverySec       = 6;
input int    HttpTimeoutMs           = 5000;
input int    DeviationPoints         = 50;
input int    MagicNumber             = 123456;
input bool   AutoTradeEnabled        = true;

CTrade trade;
datetime g_lastHeartbeat = 0;
string g_lastCommandId = "";
string g_lastAction = "INIT";

string JsonEscape(string input)
{
   string out = input;
   StringReplace(out, "\\", "\\\\");
   StringReplace(out, "\"", "\\\"");
   StringReplace(out, "\r", " ");
   StringReplace(out, "\n", " ");
   return out;
}

string Base64EncodeString(string input)
{
   uchar src[];
   uchar dst[];
   StringToCharArray(input, src, 0, WHOLE_ARRAY, CP_UTF8);
   if(ArraySize(src) > 0 && src[ArraySize(src) - 1] == 0)
      ArrayResize(src, ArraySize(src) - 1);

   if(!CryptEncode(CRYPT_BASE64, src, dst))
      return "";

   return CharArrayToString(dst);
}

string BuildHeaders()
{
   string headers = "Content-Type: application/json\r\n";
   string authRaw = SiteUser + ":" + SiteCode;
   string authB64 = Base64EncodeString(authRaw);
   if(authB64 != "")
      headers += "Authorization: Basic " + authB64 + "\r\n";
   if(BridgeToken != "")
      headers += "x-mt5-token: " + BridgeToken + "\r\n";
   return headers;
}

bool PostJson(string path, string payload, int &httpCode, string &responseBody)
{
   string endpoint = ApiBaseUrl + path;
   string headers = BuildHeaders();

   char postData[];
   StringToCharArray(payload, postData, 0, WHOLE_ARRAY, CP_UTF8);
   if(ArraySize(postData) > 0 && postData[ArraySize(postData) - 1] == 0)
      ArrayResize(postData, ArraySize(postData) - 1);

   char result[];
   string resultHeaders = "";
   ResetLastError();
   httpCode = WebRequest("POST", endpoint, headers, HttpTimeoutMs, postData, result, resultHeaders);
   if(httpCode == -1)
   {
      int err = GetLastError();
      Print("AriAutoExec WebRequest error: ", err,
            " | Add URL in MT5: Tools > Options > Expert Advisors > Allow WebRequest for listed URL");
      responseBody = "";
      return false;
   }

   responseBody = CharArrayToString(result);
   return true;
}

string JsonExtractString(string json, string key)
{
   string needle = "\"" + key + "\"";
   int pos = StringFind(json, needle);
   if(pos < 0) return "";

   int colon = StringFind(json, ":", pos + StringLen(needle));
   if(colon < 0) return "";

   int start = StringFind(json, "\"", colon + 1);
   if(start < 0) return "";

   int end = StringFind(json, "\"", start + 1);
   while(end > 0 && StringGetCharacter(json, end - 1) == 92)
      end = StringFind(json, "\"", end + 1);

   if(end < 0) return "";
   return StringSubstr(json, start + 1, end - start - 1);
}

double JsonExtractNumber(string json, string key, double fallback)
{
   string needle = "\"" + key + "\"";
   int pos = StringFind(json, needle);
   if(pos < 0) return fallback;

   int colon = StringFind(json, ":", pos + StringLen(needle));
   if(colon < 0) return fallback;

   int len = StringLen(json);
   int start = colon + 1;
   while(start < len)
   {
      int ch = StringGetCharacter(json, start);
      if(ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' || ch == '"')
      {
         start++;
         continue;
      }
      break;
   }

   int end = start;
   while(end < len)
   {
      int ch = StringGetCharacter(json, end);
      if((ch >= '0' && ch <= '9') || ch == '.' || ch == '-' || ch == '+')
      {
         end++;
         continue;
      }
      break;
   }

   if(end <= start) return fallback;
   string numText = StringSubstr(json, start, end - start);
   double value = StringToDouble(numText);
   if(value == 0.0 && numText != "0" && numText != "0.0")
      return fallback;
   return value;
}

bool JsonExtractBool(string json, string key, bool fallback)
{
   string needle = "\"" + key + "\"";
   int pos = StringFind(json, needle);
   if(pos < 0) return fallback;

   int colon = StringFind(json, ":", pos + StringLen(needle));
   if(colon < 0) return fallback;

   string tail = StringSubstr(json, colon + 1);
   string lower = StringToLower(tail);

   int truePos = StringFind(lower, "true");
   int falsePos = StringFind(lower, "false");
   if(truePos == 0 || (truePos > 0 && truePos < 4)) return true;
   if(falsePos == 0 || (falsePos > 0 && falsePos < 4)) return false;
   return fallback;
}

string ResolveBrokerSymbol()
{
   if(UseChartSymbolAsBroker)
      return _Symbol;

   string s = StringTrimLeft(StringTrimRight(BrokerSymbolOverride));
   if(s == "")
      return _Symbol;
   return s;
}

void AdjustStopsForBroker(string symbol, string side, double &sl, double &tp)
{
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   if(point <= 0.0)
      point = 0.00001;

   int stopLevelPts = (int)SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);
   int freezeLevelPts = (int)SymbolInfoInteger(symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   int minLevelPts = MathMax(stopLevelPts, freezeLevelPts) + 2;
   double minDistance = minLevelPts * point;

   MqlTick tick;
   if(!SymbolInfoTick(symbol, tick))
      return;

   double reference = (StringToUpper(side) == "BUY") ? tick.ask : tick.bid;
   if(reference <= 0.0)
      return;

   if(StringToUpper(side) == "BUY")
   {
      if(sl > 0.0)
      {
         double maxSl = reference - minDistance;
         if(sl >= maxSl) sl = maxSl;
      }
      if(tp > 0.0)
      {
         double minTp = reference + minDistance;
         if(tp <= minTp) tp = minTp;
      }
   }
   else
   {
      if(sl > 0.0)
      {
         double minSl = reference + minDistance;
         if(sl <= minSl) sl = minSl;
      }
      if(tp > 0.0)
      {
         double maxTp = reference - minDistance;
         if(tp >= maxTp) tp = maxTp;
      }
   }

   if(sl > 0.0) sl = NormalizeDouble(sl, digits);
   if(tp > 0.0) tp = NormalizeDouble(tp, digits);
}

bool SendAck(string commandId, string status, double fillPrice, double volume, string note)
{
   string payload = "{";
   payload += "\"commandId\":\"" + JsonEscape(commandId) + "\",";
   payload += "\"status\":\"" + JsonEscape(status) + "\",";
   payload += "\"fillPrice\":" + DoubleToString(fillPrice, _Digits) + ",";
   payload += "\"volume\":" + DoubleToString(volume, 3) + ",";
   payload += "\"note\":\"" + JsonEscape(note) + "\",";
   payload += "\"token\":\"" + JsonEscape(BridgeToken) + "\"";
   payload += "}";

   int httpCode = 0;
   string body = "";
   if(!PostJson(AckPath, payload, httpCode, body))
      return false;

   if(httpCode < 200 || httpCode >= 300)
   {
      Print("AriAutoExec ACK failed: HTTP ", httpCode, " | ", body);
      return false;
   }
   return true;
}

void SendHeartbeat()
{
   datetime now = TimeCurrent();
   if((now - g_lastHeartbeat) < HeartbeatEverySec)
      return;

   long accountLogin = (long)AccountInfoInteger(ACCOUNT_LOGIN);
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   int openPositions = PositionsTotal();
   string brokerSymbol = ResolveBrokerSymbol();

   string payload = "{";
   payload += "\"token\":\"" + JsonEscape(BridgeToken) + "\",";
   payload += "\"terminal\":\"mt5-auto-executor\",";
   payload += "\"accountId\":\"" + (string)accountLogin + "\",";
   payload += "\"symbol\":\"" + JsonEscape(brokerSymbol) + "\",";
   payload += "\"brokerSymbol\":\"" + JsonEscape(brokerSymbol) + "\",";
   payload += "\"equity\":" + DoubleToString(equity, 2) + ",";
   payload += "\"balance\":" + DoubleToString(balance, 2) + ",";
   payload += "\"openPositions\":" + (string)openPositions + ",";
   payload += "\"lastAction\":\"" + JsonEscape(g_lastAction) + "\"";
   payload += "}";

   int httpCode = 0;
   string body = "";
   if(!PostJson(HeartbeatPath, payload, httpCode, body))
      return;

   if(httpCode >= 200 && httpCode < 300)
      g_lastHeartbeat = now;
}

void PollAndExecute()
{
   if(!AutoTradeEnabled)
      return;

   long accountLogin = (long)AccountInfoInteger(ACCOUNT_LOGIN);
   string brokerSymbol = ResolveBrokerSymbol();

   string payload = "{";
   payload += "\"token\":\"" + JsonEscape(BridgeToken) + "\",";
   payload += "\"accountId\":\"" + (string)accountLogin + "\",";
   payload += "\"brokerSymbol\":\"" + JsonEscape(brokerSymbol) + "\"";
   payload += "}";

   int httpCode = 0;
   string body = "";
   if(!PostJson(NextCommandPath, payload, httpCode, body))
      return;

   if(httpCode < 200 || httpCode >= 300)
   {
      Print("AriAutoExec NEXT failed: HTTP ", httpCode, " | ", body);
      return;
   }

   bool hasCommand = JsonExtractBool(body, "hasCommand", false);
   if(!hasCommand)
      return;

   string commandId = JsonExtractString(body, "commandId");
   if(commandId == "")
      return;

   // Prevent duplicate fire on same command id.
   if(commandId == g_lastCommandId)
      return;

   string side = StringToUpper(JsonExtractString(body, "side"));
   string execSymbol = JsonExtractString(body, "brokerSymbol");
   if(execSymbol == "")
      execSymbol = brokerSymbol;

   double volume = JsonExtractNumber(body, "volume", 0.0);
   double sl = JsonExtractNumber(body, "stopLoss", 0.0);
   double tp = JsonExtractNumber(body, "takeProfit", 0.0);

   if(volume <= 0.0 || (side != "BUY" && side != "SELL"))
   {
      SendAck(commandId, "REJECTED", 0.0, volume, "Invalid command payload");
      g_lastCommandId = commandId;
      g_lastAction = "INVALID_COMMAND";
      return;
   }

   if(!SymbolSelect(execSymbol, true))
   {
      SendAck(commandId, "REJECTED", 0.0, volume, "SymbolSelect failed");
      g_lastCommandId = commandId;
      g_lastAction = "SYMBOL_SELECT_FAIL";
      return;
   }

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(DeviationPoints);

   bool ok = false;
   string comment = "AriAutoExec " + commandId;
   double reqSl = sl;
   double reqTp = tp;
   double adjustedSl = sl;
   double adjustedTp = tp;
   AdjustStopsForBroker(execSymbol, side, adjustedSl, adjustedTp);

   if(side == "BUY")
      ok = trade.Buy(volume, execSymbol, 0.0, adjustedSl, adjustedTp, comment);
   else
      ok = trade.Sell(volume, execSymbol, 0.0, adjustedSl, adjustedTp, comment);

   int ret = (int)trade.ResultRetcode();
   string retDesc = trade.ResultRetcodeDescription();
   double fillPrice = trade.ResultPrice();

   bool fallbackNoStops = false;
   bool modifyAttempted = false;
   bool modifyOk = false;
   if(!ok && ret == TRADE_RETCODE_INVALID_STOPS)
   {
      fallbackNoStops = true;
      if(side == "BUY")
         ok = trade.Buy(volume, execSymbol, 0.0, 0.0, 0.0, comment + " fallback");
      else
         ok = trade.Sell(volume, execSymbol, 0.0, 0.0, 0.0, comment + " fallback");

      ret = (int)trade.ResultRetcode();
      retDesc = trade.ResultRetcodeDescription();
      fillPrice = trade.ResultPrice();

      if(ok && (ret == TRADE_RETCODE_DONE || ret == TRADE_RETCODE_DONE_PARTIAL) && (reqSl > 0.0 || reqTp > 0.0))
      {
         double finalSl = reqSl;
         double finalTp = reqTp;
         AdjustStopsForBroker(execSymbol, side, finalSl, finalTp);
         modifyAttempted = true;
         modifyOk = trade.PositionModify(execSymbol, finalSl > 0.0 ? finalSl : 0.0, finalTp > 0.0 ? finalTp : 0.0);
      }
   }

   if(fillPrice <= 0.0)
   {
      MqlTick tick;
      if(SymbolInfoTick(execSymbol, tick))
      {
         if(side == "BUY") fillPrice = tick.ask;
         else fillPrice = tick.bid;
      }
   }

   string status = "REJECTED";
   if(ok && (ret == TRADE_RETCODE_DONE || ret == TRADE_RETCODE_DONE_PARTIAL))
      status = "FILLED";

   string note = status + " | " + retDesc;
   if(fallbackNoStops)
      note += " | fallback_no_stops";
   if(modifyAttempted)
      note += modifyOk ? " | sltp_applied" : " | sltp_modify_failed";
   if(SendAck(commandId, status, fillPrice, volume, note))
   {
      g_lastCommandId = commandId;
      g_lastAction = side + " " + execSymbol + " " + status;
      Print("AriAutoExec: ", g_lastAction, " @ ", DoubleToString(fillPrice, _Digits));
   }
}

int OnInit()
{
   int safePoll = MathMax(1, PollIntervalSec);
   EventSetTimer(safePoll);
   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(DeviationPoints);

   Print("Ari_MT5_AutoExecutor started | symbol=", _Symbol,
         " | poll=", safePoll,
         "s | heartbeat=", HeartbeatEverySec,
         "s");
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("Ari_MT5_AutoExecutor stopped");
}

void OnTimer()
{
   SendHeartbeat();
   PollAndExecute();

   Comment("Ari MT5 AutoExecutor\n",
           "Symbol: ", _Symbol, "\n",
           "Last Action: ", g_lastAction, "\n",
           "Last Command: ", g_lastCommandId == "" ? "none" : g_lastCommandId, "\n",
           "AutoTrade: ", AutoTradeEnabled ? "ON" : "OFF");
}
