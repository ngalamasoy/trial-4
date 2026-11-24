export interface BridgeFileAsset {
  id: 'mq5' | 'cpp' | 'header' | 'def' | 'bat';
  filename: string;
  label: string;
  targetFolder: string;
  content: string;
}

export function buildBridgeFiles(
  origin: string,
  bridgeKey = '',
  strategyFocus: string = 'SCALPING_EMA',
  fullAiControl: boolean = true
): BridgeFileAsset[] {
  const endpointUrl = `${origin}/api/ea/analyze`;
  const syncUrl = `${origin}/api/mt5/sync`;
  const safeBridgeKey = bridgeKey || 'MASUKKAN_BRIDGE_KEY_DARI_WEB';

  const mq5Content = `//+------------------------------------------------------------------+
//|                                          AurumEA_XAUUSD_M5.mq5   |
//|   AI Decision Judge Scalper XAUUSD M5/M1 - 100% Kendali AI       |
//+------------------------------------------------------------------+
#property copyright "AurumEA AI Judge Edition"
#property version   "2.20"
#property strict

#include <Trade\\Trade.mqh>

//--- Import DLL Windows x64 (letakkan di MQL5\\Libraries\\AurumGeminiBridge.dll)
#import "AurumGeminiBridge.dll"
int AurumAnalyzeM5(const string endpointUrl, const string jsonPayload, string &outBuffer, int outBufferLen);
#import

input group "=== 1. Koneksi Web Terminal & AI Hakim Keputusan ==="
input string   InpEndpointUrl        = "${endpointUrl}";
input string   InpSyncUrl            = "${syncUrl}";
input string   InpBridgeKey          = "${safeBridgeKey}";
input bool     InpUseDll             = true;             // true = pakai AurumGeminiBridge.dll, false = WebRequest bawaan MT5
input bool     InpFullAiControl      = ${fullAiControl ? 'true' : 'false'}; // 100% Kendali AI Judge (Indikator hanya data, AI mutlak putuskan HOLD/BUY/SELL)
input bool     InpNoSlAiExit         = true;             // 100% Tanpa SL (SL=0, TP tetap aktif, AI pantau posisi sesuai timeframe chart & close jika tren berbalik/akan lose)
input string   InpStrategyFocus      = "${strategyFocus}"; // SCALPING_EMA | ULTRA_SCALP | LIQUIDITY_SMC | BALANCED

input group "=== 2. Kecepatan & Filter Opsional (Diabaikan jika InpFullAiControl = true) ==="
input int      InpScalpScanSec       = 30;               // Interval scan saat belum ada posisi (detik). Set 0 = saat candle chart baru
input bool     InpPauseScanWhenOpen  = true;             // Diabaikan jika InpNoSlAiExit = true (AI wajib pantau posisi)
input int      InpTradeCooldownSec   = 45;               // Jeda minimal antar entry baru (detik)
input int      InpMinConfidence      = 76;               // Hanya dipakai jika InpFullAiControl = false
input double   InpMaxSpreadPoints    = 35.0;             // Hanya dipakai jika InpFullAiControl = false
input double   InpMinAtrUsd          = 0.70;             // Hanya dipakai jika InpFullAiControl = false
input double   InpMaxAtrUsd          = 14.00;            // Hanya dipakai jika InpFullAiControl = false
input bool     InpUseSessionFilter   = false;            // Hanya dipakai jika InpFullAiControl = false
input int      InpSessionStartHour   = 7;                // Jam mulai sesi (Server Time)
input int      InpSessionEndHour     = 21;               // Jam selesai sesi (Server Time)

input group "=== 3. Manajemen Risiko & Lot ==="
input bool     InpUseRiskPercent     = true;             // true = Lot dinamis (% Risk), false = Fixed Lot
input double   InpRiskPercent        = 1.0;              // Risiko per trade (%)
input double   InpFixedLot           = 0.05;             // Lot tetap jika InpUseRiskPercent = false
input int      InpMaxPositions       = 2;                // Maksimal posisi aktif bersamaan
input double   InpMaxDailyLossPct    = 5.0;              // Batas rugi harian (%) sebelum stop entry baru
input int      InpMagicNumber        = 5052026;          // Magic Number EA

input group "=== 4. Proteksi Profit Scalping (Bypass saat InpNoSlAiExit = true) ==="
input bool     InpUseBreakeven       = true;             // Geser SL ke Breakeven+ otomatis (hanya jika InpNoSlAiExit = false)
input int      InpBreakevenTrigPts   = 120;              // Trigger BE saat profit >= points (120 pts = $1.20)
input int      InpBreakevenLockPts   = 20;               // Kunci profit saat BE (20 pts = $0.20)
input bool     InpUsePartialClose    = true;             // Tutup 50% lot otomatis saat profit mencapai target awal
input int      InpPartialTrigPts     = 150;              // Trigger Partial Close (150 pts = $1.50)
input bool     InpUseTrailingStop    = true;             // Aktifkan Trailing Stop ketat berbasis ATR (hanya jika InpNoSlAiExit = false)
input double   InpTrailingAtrMult    = 0.90;             // Pengali ATR untuk Trailing Stop scalping
input int      InpTrailStepPts       = 25;               // Minimal langkah geser SL (points)
input int      InpMaxHoldMinutes     = 25;               // Time-stop scalping (menit, 0 = nonaktif)

CTrade   trade;
datetime g_lastBarTime     = 0;
datetime g_lastScanTime    = 0;
datetime g_lastTradeTime   = 0;
int      g_atrHandle       = INVALID_HANDLE;
ulong    g_partialDoneTickets[];

//+------------------------------------------------------------------+
int OnInit()
{
   if(Period() != PERIOD_M5)
   {
      Print("[AurumEA Scalper] Peringatan: Pasang di chart XAUUSD M5 untuk akurasi optimal.");
   }

   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(25);
   g_atrHandle = iATR(_Symbol, PERIOD_M5, 14);

   EventSetTimer(2);
   SyncWithWebTerminal();

   PrintFormat("[AurumEA v2.10 AI Judge] Aktif di akun %I64d (%s) | FullAI=%s | Focus=%s | Scan=%ds",
               AccountInfoInteger(ACCOUNT_LOGIN),
               AccountInfoString(ACCOUNT_SERVER),
               (InpFullAiControl ? "100%_AI_JUDGE" : "FILTERED"),
               InpStrategyFocus,
               InpScalpScanSec);
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   if(g_atrHandle != INVALID_HANDLE) IndicatorRelease(g_atrHandle);
}

//+------------------------------------------------------------------+
void OnTimer()
{
   SyncWithWebTerminal();
}

//+------------------------------------------------------------------+
void OnTick()
{
   ManageScalpingPositions();

   datetime now = TimeCurrent();
   int eaPositions = CountEaPositions();

   if(eaPositions > 0)
   {
      if(InpNoSlAiExit)
      {
         // Mode 100% Tanpa SL: AI pantau posisi terbuka mengikuti interval timeframe chart aktif
         int tfMonitorSec = PeriodSeconds(_Period);
         if(tfMonitorSec <= 0) tfMonitorSec = 300;
         if(g_lastScanTime != 0 && (now - g_lastScanTime) < tfMonitorSec) return;
         g_lastScanTime = now;
         RunGeminiAnalysisAndTrade();
         return;
      }
      if(InpPauseScanWhenOpen)
      {
         // Jeda scan selama ada posisi terbuka agar tidak boros token
         g_lastScanTime = now;
         datetime currentBarOpen = iTime(_Symbol, _Period, 0);
         if(currentBarOpen > 0) g_lastBarTime = currentBarOpen;
         return;
      }
   }

   if(InpScalpScanSec <= 0)
   {
      datetime currentBar = iTime(_Symbol, _Period, 0);
      if(currentBar == 0 || currentBar == g_lastBarTime) return;
      g_lastBarTime = currentBar;
   }
   else
   {
      if(g_lastScanTime != 0 && (now - g_lastScanTime) < InpScalpScanSec) return;
      g_lastScanTime = now;
   }

   RunGeminiAnalysisAndTrade();
}

//+------------------------------------------------------------------+
bool IsTicketPartialDone(ulong ticket)
{
   int sz = ArraySize(g_partialDoneTickets);
   for(int i = 0; i < sz; i++)
   {
      if(g_partialDoneTickets[i] == ticket) return true;
   }
   return false;
}

//+------------------------------------------------------------------+
void MarkTicketPartialDone(ulong ticket)
{
   if(IsTicketPartialDone(ticket)) return;
   int sz = ArraySize(g_partialDoneTickets);
   ArrayResize(g_partialDoneTickets, sz + 1);
   g_partialDoneTickets[sz] = ticket;
}

//+------------------------------------------------------------------+
double GetTodayClosedProfit()
{
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   dt.hour = 0; dt.min = 0; dt.sec = 0;
   datetime dayStart = StructToTime(dt);

   if(!HistorySelect(dayStart, TimeCurrent())) return 0.0;
   double total = 0.0;
   int deals = HistoryDealsTotal();
   for(int i = 0; i < deals; i++)
   {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket == 0) continue;
      if(HistoryDealGetInteger(dealTicket, DEAL_MAGIC) != InpMagicNumber) continue;
      long entryType = HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
      if(entryType == DEAL_ENTRY_OUT || entryType == DEAL_ENTRY_INOUT)
      {
         total += HistoryDealGetDouble(dealTicket, DEAL_PROFIT);
         total += HistoryDealGetDouble(dealTicket, DEAL_SWAP);
         total += HistoryDealGetDouble(dealTicket, DEAL_COMMISSION);
      }
   }
   return total;
}

//+------------------------------------------------------------------+
bool IsWithinTradingSession()
{
   if(!InpUseSessionFilter) return true;
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   if(InpSessionStartHour <= InpSessionEndHour)
      return (dt.hour >= InpSessionStartHour && dt.hour <= InpSessionEndHour);
   return (dt.hour >= InpSessionStartHour || dt.hour <= InpSessionEndHour);
}

//+------------------------------------------------------------------+
string SendHttpPost(const string url, const string payload, bool expectMt5Line)
{
   if(InpUseDll)
   {
      string outBuf = "";
      StringInit(outBuf, 8192, 0);
      int httpStatus = AurumAnalyzeM5(url, payload, outBuf, 8192);
      if(httpStatus != 200)
      {
         Print("[AurumEA DLL] HTTP=", httpStatus, " | URL=", url, " | ", outBuf);
         return "";
      }
      return outBuf;
   }
   else
   {
      char postData[];
      char result[];
      string resHeaders;
      StringToCharArray(payload, postData, 0, WHOLE_ARRAY, CP_UTF8);
      int sz = ArraySize(postData);
      if(sz > 0) ArrayResize(postData, sz - 1);

      string headers = "Content-Type: application/json\\r\\n";
      int status = WebRequest("POST", url, headers, 12000, postData, result, resHeaders);
      if(status != 200)
      {
         Print("[AurumEA WebRequest] HTTP=", status, " | Pastikan URL didaftarkan di Tools > Options > Expert Advisors");
         return "";
      }
      string jsonResp = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
      return expectMt5Line ? ExtractMt5LineFromJson(jsonResp) : jsonResp;
   }
}

//+------------------------------------------------------------------+
void SyncWithWebTerminal()
{
   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   string posJson = "[";
   int added = 0;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(added > 0) posJson += ",";
      long pType = PositionGetInteger(POSITION_TYPE);
      posJson += StringFormat(
         "{\\"ticket\\":%I64u,\\"symbol\\":\\"%s\\",\\"side\\":\\"%s\\",\\"lots\\":%.2f,\\"openPrice\\":%.*f,\\"sl\\":%.*f,\\"tp\\":%.*f,\\"profit\\":%.2f,\\"openTime\\":%I64d}",
         ticket,
         PositionGetString(POSITION_SYMBOL),
         (pType == POSITION_TYPE_BUY ? "BUY" : "SELL"),
         PositionGetDouble(POSITION_VOLUME),
         digits, PositionGetDouble(POSITION_PRICE_OPEN),
         digits, PositionGetDouble(POSITION_SL),
         digits, PositionGetDouble(POSITION_TP),
         PositionGetDouble(POSITION_PROFIT),
         (long)PositionGetInteger(POSITION_TIME) * 1000
      );
      added++;
   }
   posJson += "]";

   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   string m5SyncJson = BuildCandlesArrayJson(PERIOD_M5, 100, digits);

   string syncPayload = StringFormat(
      "{\\"bridgeKey\\":\\"%s\\",\\"login\\":\\"%I64d\\",\\"server\\":\\"%s\\",\\"company\\":\\"%s\\",\\"currency\\":\\"%s\\",\\"balance\\":%.2f,\\"equity\\":%.2f,\\"margin\\":%.2f,\\"freeMargin\\":%.2f,\\"leverage\\":%I64d,\\"tradeAllowed\\":%s,\\"symbol\\":\\"%s\\",\\"bid\\":%.*f,\\"ask\\":%.*f,\\"candles\\":%s,\\"positions\\":%s}",
      InpBridgeKey,
      AccountInfoInteger(ACCOUNT_LOGIN),
      AccountInfoString(ACCOUNT_SERVER),
      AccountInfoString(ACCOUNT_COMPANY),
      AccountInfoString(ACCOUNT_CURRENCY),
      AccountInfoDouble(ACCOUNT_BALANCE),
      AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_MARGIN),
      AccountInfoDouble(ACCOUNT_MARGIN_FREE),
      AccountInfoInteger(ACCOUNT_LEVERAGE),
      (TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) && MQLInfoInteger(MQL_TRADE_ALLOWED)) ? "true" : "false",
      _Symbol,
      digits, bid,
      digits, ask,
      m5SyncJson,
      posJson
   );

   string cmdLine = SendHttpPost(InpSyncUrl, syncPayload, true);
   if(cmdLine == "" || cmdLine == "NONE") return;

   string parts[];
   int n = StringSplit(cmdLine, '|', parts);
   if(n < 3 || parts[0] != "CMD") return;

   string action = parts[2];
   if(action == "BUY" && n >= 6)
   {
      double lots = StringToDouble(parts[3]);
      double sl   = NormalizeDouble(StringToDouble(parts[4]), digits);
      double tp   = NormalizeDouble(StringToDouble(parts[5]), digits);
      string cmt  = (n > 6) ? parts[6] : "AurumEA Scalp";
      double ask  = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      trade.Buy(lots, _Symbol, ask, sl, tp, cmt);
   }
   else if(action == "SELL" && n >= 6)
   {
      double lots = StringToDouble(parts[3]);
      double sl   = NormalizeDouble(StringToDouble(parts[4]), digits);
      double tp   = NormalizeDouble(StringToDouble(parts[5]), digits);
      string cmt  = (n > 6) ? parts[6] : "AurumEA Scalp";
      double bid  = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      trade.Sell(lots, _Symbol, bid, sl, tp, cmt);
   }
   else if(action == "CLOSE" && n >= 4)
   {
      ulong ticket = (ulong)StringToInteger(parts[3]);
      trade.PositionClose(ticket);
   }
   else if(action == "CLOSE_ALL")
   {
      for(int i = PositionsTotal() - 1; i >= 0; i--)
      {
         ulong t = PositionGetTicket(i);
         if(t > 0 && PositionGetString(POSITION_SYMBOL) == _Symbol) trade.PositionClose(t);
      }
   }
}

//+------------------------------------------------------------------+
int CountEaPositions()
{
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
         PositionGetInteger(POSITION_MAGIC) == InpMagicNumber)
      {
         count++;
      }
   }
   return count;
}

//+------------------------------------------------------------------+
string BuildCandlesArrayJson(ENUM_TIMEFRAMES tf, int countReq, int digits)
{
   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int copied = CopyRates(_Symbol, tf, 0, countReq, rates);
   if(copied <= 0) return "[]";

   string arr = "[";
   for(int i = 0; i < copied; i++)
   {
      if(i > 0) arr += ",";
      arr += StringFormat(
         "{\\"time\\":%I64d,\\"open\\":%.*f,\\"high\\":%.*f,\\"low\\":%.*f,\\"close\\":%.*f,\\"volume\\":%I64d}",
         (long)rates[i].time,
         digits, rates[i].open,
         digits, rates[i].high,
         digits, rates[i].low,
         digits, rates[i].close,
         rates[i].tick_volume
      );
   }
   arr += "]";
   return arr;
}

//+------------------------------------------------------------------+
string GetActiveTimeframeCode()
{
   int sec = PeriodSeconds(_Period);
   if(sec >= 3600) return "H1";
   if(sec >= 1800) return "M30";
   if(sec >= 900)  return "M15";
   return "M5";
}

//+------------------------------------------------------------------+
string BuildRecentClosedTradesJson(int digits)
{
   datetime now = TimeCurrent();
   datetime fromTime = now - 7200; // 120 menit terakhir
   if(!HistorySelect(fromTime, now)) return "[]";

   string entries[];
   int total = HistoryDealsTotal();
   for(int i = total - 1; i >= 0 && ArraySize(entries) < 5; i--)
   {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket == 0) continue;
      if(HistoryDealGetString(dealTicket, DEAL_SYMBOL) != _Symbol) continue;
      if(HistoryDealGetInteger(dealTicket, DEAL_MAGIC) != InpMagicNumber) continue;

      long entryType = HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
      if(entryType != DEAL_ENTRY_OUT && entryType != DEAL_ENTRY_INOUT) continue;

      long dealType = HistoryDealGetInteger(dealTicket, DEAL_TYPE);
      // Out deal untuk posisi BUY adalah DEAL_TYPE_SELL, dan sebaliknya
      string posSide = (dealType == DEAL_TYPE_SELL) ? "BUY" : "SELL";
      double closePrice = HistoryDealGetDouble(dealTicket, DEAL_PRICE);
      double pnl = HistoryDealGetDouble(dealTicket, DEAL_PROFIT)
                 + HistoryDealGetDouble(dealTicket, DEAL_SWAP)
                 + HistoryDealGetDouble(dealTicket, DEAL_COMMISSION);
      long reasonCode = HistoryDealGetInteger(dealTicket, DEAL_REASON);
      string closeReason = "MT5 Sync";
      if(reasonCode == DEAL_REASON_TP) closeReason = "TP Hit";
      else if(reasonCode == DEAL_REASON_SL) closeReason = "SL Hit";
      else if(reasonCode == DEAL_REASON_EXPERT) closeReason = "AI Exit";

      datetime dealTime = (datetime)HistoryDealGetInteger(dealTicket, DEAL_TIME);
      long minsAgo = (long)MathMax(0, (long)((now - dealTime) / 60));

      int idx = ArraySize(entries);
      ArrayResize(entries, idx + 1);
      entries[idx] = StringFormat(
         "{\\"side\\":\\"%s\\",\\"entryPrice\\":%.*f,\\"closePrice\\":%.*f,\\"takeProfit\\":%.*f,\\"pnlUsd\\":%.2f,\\"points\\":0,\\"closeReason\\":\\"%s\\",\\"closedMinutesAgo\\":%I64d}",
         posSide,
         digits, closePrice,
         digits, closePrice,
         digits, closePrice,
         pnl,
         closeReason,
         minsAgo
      );
   }

   string json = "[";
   for(int k = 0; k < ArraySize(entries); k++)
   {
      if(k > 0) json += ",";
      json += entries[k];
   }
   json += "]";
   return json;
}

//+------------------------------------------------------------------+
string BuildMt5PayloadJson()
{
   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   ENUM_TIMEFRAMES chartTf = _Period;
   if(PeriodSeconds(chartTf) < 300) chartTf = PERIOD_M5;
   string tfCandlesJson = BuildCandlesArrayJson(chartTf, 60, digits);
   if(StringLen(tfCandlesJson) < 20) return "";

   string m1Json = BuildCandlesArrayJson(PERIOD_M1, 15, digits);
   string recentClosedJson = BuildRecentClosedTradesJson(digits);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double spreadPts = (double)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);

   string openDetailJson = "[";
   int addedPos = 0;
   datetime now = TimeCurrent();
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol ||
         PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;

      if(addedPos > 0) openDetailJson += ",";
      long pType = PositionGetInteger(POSITION_TYPE);
      datetime openTime = (datetime)PositionGetInteger(POSITION_TIME);
      long minsAgo = (long)MathMax(0, (long)((now - openTime) / 60));
      openDetailJson += StringFormat(
         "{\\"id\\":\\"mt5_%I64u\\",\\"side\\":\\"%s\\",\\"lots\\":%.2f,\\"entryPrice\\":%.*f,\\"takeProfit\\":%.*f,\\"floatingPnlUsd\\":%.2f,\\"openedMinutesAgo\\":%I64d}",
         ticket,
         (pType == POSITION_TYPE_BUY ? "BUY" : "SELL"),
         PositionGetDouble(POSITION_VOLUME),
         digits, PositionGetDouble(POSITION_PRICE_OPEN),
         digits, PositionGetDouble(POSITION_TP),
         PositionGetDouble(POSITION_PROFIT),
         minsAgo
      );
      addedPos++;
   }
   openDetailJson += "]";

   return StringFormat(
      "{\\"strategyFocus\\":\\"%s\\",\\"timeframe\\":\\"%s\\",\\"fullAiControl\\":%s,\\"noSlAiExit\\":%s,\\"riskPercent\\":%.2f,\\"accountBalance\\":%.2f,\\"openPositionsCount\\":%d,\\"openPositionsDetail\\":%s,\\"recentClosedTrades\\":%s,\\"mt5Symbol\\":\\"%s\\",\\"mt5Bid\\":%.*f,\\"mt5Ask\\":%.*f,\\"mt5SpreadPoints\\":%.1f,\\"mt5Candles\\":%s,\\"mt5M1Candles\\":%s}",
      InpStrategyFocus,
      GetActiveTimeframeCode(),
      (InpFullAiControl ? "true" : "false"),
      (InpNoSlAiExit ? "true" : "false"),
      InpRiskPercent,
      AccountInfoDouble(ACCOUNT_BALANCE),
      addedPos,
      openDetailJson,
      recentClosedJson,
      _Symbol,
      digits, bid,
      digits, ask,
      spreadPts,
      tfCandlesJson,
      m1Json
   );
}

//+------------------------------------------------------------------+
void CloseEaPositionsBySide(const string sideFilter)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol ||
         PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;

      long pType = PositionGetInteger(POSITION_TYPE);
      if(sideFilter == "ALL" ||
         (sideFilter == "BUY" && pType == POSITION_TYPE_BUY) ||
         (sideFilter == "SELL" && pType == POSITION_TYPE_SELL))
      {
         trade.PositionClose(ticket);
      }
   }
}

//+------------------------------------------------------------------+
void RunGeminiAnalysisAndTrade()
{
   int eaCount = CountEaPositions();
   if(!InpNoSlAiExit && InpPauseScanWhenOpen && eaCount > 0) return;

   if(eaCount == 0 && g_lastTradeTime != 0 && (TimeCurrent() - g_lastTradeTime) < InpTradeCooldownSec)
   {
      return;
   }

   double maxLossMoney = AccountInfoDouble(ACCOUNT_BALANCE) * (InpMaxDailyLossPct / 100.0);
   if(eaCount == 0 && GetTodayClosedProfit() <= -maxLossMoney)
   {
      Print("[AurumEA AI Judge] Batas rugi harian tercapai. Entry baru dihentikan hari ini.");
      return;
   }

   // Jika InpFullAiControl = false dan belum ada posisi, jalankan filter lokal
   if(!InpFullAiControl && eaCount == 0)
   {
      if(!IsWithinTradingSession()) return;

      double spreadPts = (double)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
      if(spreadPts > InpMaxSpreadPoints)
      {
         Print("[AurumEA] Skip scan: Spread terlalu lebar (", spreadPts, " pts)");
         return;
      }

      if(g_atrHandle != INVALID_HANDLE)
      {
         double atrBuf[];
         if(CopyBuffer(g_atrHandle, 0, 0, 1, atrBuf) >= 1)
         {
            if(atrBuf[0] < InpMinAtrUsd || atrBuf[0] > InpMaxAtrUsd)
            {
               PrintFormat("[AurumEA] Skip scan: ATR M5 (%.2f) di luar rentang [%.2f - %.2f]",
                           atrBuf[0], InpMinAtrUsd, InpMaxAtrUsd);
               return;
            }
         }
      }
   }

   string payload = BuildMt5PayloadJson();
   if(payload == "") return;

   string mt5Line = SendHttpPost(InpEndpointUrl, payload, true);
   if(mt5Line == "") return;

   string fields[];
   int count = StringSplit(mt5Line, '|', fields);
   if(count < 6) return;

   string signal      = fields[0];
   int    confidence  = (int)StringToInteger(fields[1]);
   double sl          = StringToDouble(fields[3]);
   double tp1         = StringToDouble(fields[4]);
   string pattern     = (count > 6) ? fields[6] : "AI Judge";
   string summary     = (count > 7) ? fields[7] : "";
   string posDecision = (count > 8) ? fields[8] : "NONE";
   string posReason   = (count > 9) ? fields[9] : "";

   PrintFormat("[AurumEA AI Judge] Vonis=%s | Conf=%d%% | PosDecision=%s | SLRef=%.2f | TP1=%.2f | %s",
               signal, confidence, posDecision, sl, tp1, summary);

   if(InpNoSlAiExit && eaCount > 0)
   {
      if(posDecision == "CLOSE_ALL")
      {
         Print("[AurumEA AI Exit] Menutup SEMUA posisi: ", posReason);
         CloseEaPositionsBySide("ALL");
         return;
      }
      if(posDecision == "CLOSE_BUY")
      {
         Print("[AurumEA AI Exit] Menutup posisi BUY: ", posReason);
         CloseEaPositionsBySide("BUY");
         return;
      }
      if(posDecision == "CLOSE_SELL")
      {
         Print("[AurumEA AI Exit] Menutup posisi SELL: ", posReason);
         CloseEaPositionsBySide("SELL");
         return;
      }
   }

   if(signal == "HOLD") return;
   if(!InpFullAiControl && confidence < InpMinConfidence) return;
   if(CountEaPositions() >= InpMaxPositions) return;

   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   sl  = NormalizeDouble(sl, digits);
   tp1 = NormalizeDouble(tp1, digits);

   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double execPrice = (signal == "BUY") ? ask : bid;
   double lots = CalculateLotSize(execPrice, sl);
   double execSl = InpNoSlAiExit ? 0.0 : sl;

   bool ok = false;
   if(signal == "BUY" && (InpNoSlAiExit || sl < execPrice) && tp1 > execPrice)
      ok = trade.Buy(lots, _Symbol, ask, execSl, tp1, "Scalp: " + pattern);
   else if(signal == "SELL" && (InpNoSlAiExit || sl > execPrice) && tp1 < execPrice)
      ok = trade.Sell(lots, _Symbol, bid, execSl, tp1, "Scalp: " + pattern);

   if(ok) g_lastTradeTime = TimeCurrent();
}

//+------------------------------------------------------------------+
double CalculateLotSize(double entryPrice, double stopLoss)
{
   double minLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);

   if(!InpUseRiskPercent)
      return MathMax(minLot, MathMin(maxLot, NormalizeDouble(InpFixedLot, 2)));

   double slDistance = MathAbs(entryPrice - stopLoss);
   double tickSize   = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double tickValue  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   if(slDistance <= 0 || tickSize <= 0 || tickValue <= 0) return minLot;

   double riskMoney = AccountInfoDouble(ACCOUNT_BALANCE) * (InpRiskPercent / 100.0);
   double lossPerLot = (slDistance / tickSize) * tickValue;
   if(lossPerLot <= 0) return minLot;

   double rawLots = riskMoney / lossPerLot;
   double stepped = MathFloor(rawLots / lotStep) * lotStep;
   return MathMax(minLot, MathMin(maxLot, NormalizeDouble(stepped, 2)));
}

//+------------------------------------------------------------------+
void ManageScalpingPositions()
{
   if(InpNoSlAiExit) return; // Mode 100% Tanpa SL: jangan pernah pasang/geser BE+ atau Trailing SL

   double point   = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int    digits  = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   double minLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double bid     = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask     = SymbolInfoDouble(_Symbol, SYMBOL_ASK);

   double trailDist = 0.0;
   if(InpUseTrailingStop && g_atrHandle != INVALID_HANDLE)
   {
      double atrBuf[];
      if(CopyBuffer(g_atrHandle, 0, 0, 1, atrBuf) >= 1)
         trailDist = atrBuf[0] * InpTrailingAtrMult;
   }

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol ||
         PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;

      long     posType  = PositionGetInteger(POSITION_TYPE);
      double   openPr   = PositionGetDouble(POSITION_PRICE_OPEN);
      double   curSl    = PositionGetDouble(POSITION_SL);
      double   curTp    = PositionGetDouble(POSITION_TP);
      double   vol      = PositionGetDouble(POSITION_VOLUME);
      datetime openTime = (datetime)PositionGetInteger(POSITION_TIME);

      double gainPts = (posType == POSITION_TYPE_BUY)
                       ? (bid - openPr) / point
                       : (openPr - ask) / point;

      // 1. Time-stop scalping: tutup posisi macet jika terlalu lama & sudah dekat impas/profit
      if(InpMaxHoldMinutes > 0 && (TimeCurrent() - openTime) >= InpMaxHoldMinutes * 60)
      {
         if(gainPts >= -30)
         {
            PrintFormat("[AurumEA Scalper] Time-stop (%dm) menutup #%I64u pada %.1f pts",
                        InpMaxHoldMinutes, ticket, gainPts);
            trade.PositionClose(ticket);
            continue;
         }
      }

      // 2. Partial Close 50% saat profit mencapai InpPartialTrigPts
      if(InpUsePartialClose && !IsTicketPartialDone(ticket) && gainPts >= InpPartialTrigPts)
      {
         double halfLot = MathFloor((vol * 0.5) / lotStep) * lotStep;
         if(halfLot >= minLot && (vol - halfLot) >= minLot)
         {
            if(trade.PositionClosePartial(ticket, halfLot))
            {
               MarkTicketPartialDone(ticket);
               PrintFormat("[AurumEA Scalper] Partial Close %.2f lot pada #%I64u (+%.0f pts)",
                           halfLot, ticket, gainPts);
            }
         }
         else
         {
            MarkTicketPartialDone(ticket);
         }
      }

      // 3. Auto Breakeven+ untuk mengunci entry scalping
      if(InpUseBreakeven && gainPts >= InpBreakevenTrigPts)
      {
         if(posType == POSITION_TYPE_BUY)
         {
            double beSl = NormalizeDouble(openPr + InpBreakevenLockPts * point, digits);
            if(beSl > curSl && beSl < bid)
            {
               trade.PositionModify(ticket, beSl, curTp);
               curSl = beSl;
            }
         }
         else
         {
            double beSl = NormalizeDouble(openPr - InpBreakevenLockPts * point, digits);
            if((curSl == 0 || beSl < curSl) && beSl > ask)
            {
               trade.PositionModify(ticket, beSl, curTp);
               curSl = beSl;
            }
         }
      }

      // 4. Trailing Stop Ketat berbasis ATR
      if(InpUseTrailingStop && trailDist > 0)
      {
         double minStep = InpTrailStepPts * point;
         if(posType == POSITION_TYPE_BUY && (bid - openPr) >= trailDist)
         {
            double newSl = NormalizeDouble(bid - trailDist, digits);
            if(newSl > curSl + minStep && newSl < bid)
               trade.PositionModify(ticket, newSl, curTp);
         }
         else if(posType == POSITION_TYPE_SELL && (openPr - ask) >= trailDist)
         {
            double newSl = NormalizeDouble(ask + trailDist, digits);
            if((curSl == 0 || newSl < curSl - minStep) && newSl > ask)
               trade.PositionModify(ticket, newSl, curTp);
         }
      }
   }
}

//+------------------------------------------------------------------+
string ExtractMt5LineFromJson(const string json)
{
   string key = "\\"mt5Line\\":\\"";
   int start = StringFind(json, key);
   if(start < 0) return "";
   start += StringLen(key);
   int end = StringFind(json, "\\"", start);
   if(end <= start) return "";
   return StringSubstr(json, start, end - start);
}
`;

  const cppContent = `// AurumGeminiBridge.cpp — Windows x64 WinHTTP DLL untuk MetaTrader 5
// Zero external dependencies (hanya Windows SDK WinHTTP + kernel32).

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winhttp.h>
#include <string>
#include <vector>
#include "AurumGeminiBridge.h"

#pragma comment(lib, "winhttp.lib")

namespace {

std::string WideToUtf8(const wchar_t* wstr) {
    if (!wstr || !*wstr) return "";
    int len = WideCharToMultiByte(CP_UTF8, 0, wstr, -1, nullptr, 0, nullptr, nullptr);
    if (len <= 0) return "";
    std::string out(len - 1, '\\0');
    WideCharToMultiByte(CP_UTF8, 0, wstr, -1, &out[0], len, nullptr, nullptr);
    return out;
}

std::wstring Utf8ToWide(const std::string& str) {
    if (str.empty()) return L"";
    int len = MultiByteToWideChar(CP_UTF8, 0, str.c_str(), static_cast<int>(str.size()), nullptr, 0);
    if (len <= 0) return L"";
    std::wstring out(len, L'\\0');
    MultiByteToWideChar(CP_UTF8, 0, str.c_str(), static_cast<int>(str.size()), &out[0], len);
    return out;
}

void WriteOutputWide(const std::wstring& msg, wchar_t* outBuffer, int outBufferLen) {
    if (!outBuffer || outBufferLen <= 0) return;
    wcsncpy_s(outBuffer, outBufferLen, msg.c_str(), _TRUNCATE);
}

std::string ExtractJsonStringField(const std::string& json, const std::string& fieldName) {
    const std::string token = "\\"" + fieldName + "\\":\\"";
    size_t pos = json.find(token);
    if (pos == std::string::npos) return "";
    pos += token.size();

    std::string result;
    result.reserve(256);
    bool escaped = false;
    for (size_t i = pos; i < json.size(); ++i) {
        char c = json[i];
        if (escaped) {
            if (c == 'n') result.push_back(' ');
            else result.push_back(c);
            escaped = false;
        } else if (c == '\\\\') {
            escaped = true;
        } else if (c == '"') {
            break;
        } else {
            result.push_back(c);
        }
    }
    return result;
}

} // namespace

extern "C" {

AURUM_API int __stdcall AurumAnalyzeM5(
    const wchar_t* endpointUrl,
    const wchar_t* jsonPayload,
    wchar_t* outBuffer,
    int outBufferLen
) {
    if (!endpointUrl || !jsonPayload || !outBuffer || outBufferLen <= 0) {
        WriteOutputWide(L"Parameter tidak valid", outBuffer, outBufferLen);
        return -1;
    }

    URL_COMPONENTS urlComp{};
    urlComp.dwStructSize = sizeof(urlComp);
    wchar_t hostBuf[256] = {};
    wchar_t pathBuf[1024] = {};
    urlComp.lpszHostName = hostBuf;
    urlComp.dwHostNameLength = _countof(hostBuf);
    urlComp.lpszUrlPath = pathBuf;
    urlComp.dwUrlPathLength = _countof(pathBuf);

    if (!WinHttpCrackUrl(endpointUrl, 0, 0, &urlComp)) {
        WriteOutputWide(L"URL endpoint tidak valid", outBuffer, outBufferLen);
        return -2;
    }

    HINTERNET hSession = WinHttpOpen(
        L"AurumEA-MT5-Bridge/1.2",
        WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
        WINHTTP_NO_PROXY_NAME,
        WINHTTP_NO_PROXY_BYPASS,
        0
    );
    if (!hSession) {
        WriteOutputWide(L"Gagal inisialisasi WinHTTP session", outBuffer, outBufferLen);
        return -3;
    }

    WinHttpSetTimeouts(hSession, 5000, 8000, 10000, 20000);

    HINTERNET hConnect = WinHttpConnect(hSession, hostBuf, urlComp.nPort, 0);
    if (!hConnect) {
        WinHttpCloseHandle(hSession);
        WriteOutputWide(L"Gagal konek ke host endpoint", outBuffer, outBufferLen);
        return -4;
    }

    DWORD flags = (urlComp.nScheme == INTERNET_SCHEME_HTTPS) ? WINHTTP_FLAG_SECURE : 0;
    HINTERNET hRequest = WinHttpOpenRequest(
        hConnect,
        L"POST",
        pathBuf,
        nullptr,
        WINHTTP_NO_REFERER,
        WINHTTP_DEFAULT_ACCEPT_TYPES,
        flags
    );
    if (!hRequest) {
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        WriteOutputWide(L"Gagal membuat request HTTP", outBuffer, outBufferLen);
        return -5;
    }

    std::string utf8Body = WideToUtf8(jsonPayload);
    const wchar_t* headers = L"Content-Type: application/json\\r\\n";

    BOOL sent = WinHttpSendRequest(
        hRequest,
        headers,
        static_cast<DWORD>(-1),
        utf8Body.empty() ? WINHTTP_NO_REQUEST_DATA : const_cast<char*>(utf8Body.data()),
        static_cast<DWORD>(utf8Body.size()),
        static_cast<DWORD>(utf8Body.size()),
        0
    );

    if (!sent || !WinHttpReceiveResponse(hRequest, nullptr)) {
        WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        WriteOutputWide(L"Timeout atau gagal menerima respon endpoint", outBuffer, outBufferLen);
        return -6;
    }

    DWORD statusCode = 0;
    DWORD statusSize = sizeof(statusCode);
    WinHttpQueryHeaders(
        hRequest,
        WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
        WINHTTP_HEADER_NAME_BY_INDEX,
        &statusCode,
        &statusSize,
        WINHTTP_NO_HEADER_INDEX
    );

    std::string responseBody;
    DWORD available = 0;
    while (WinHttpQueryDataAvailable(hRequest, &available) && available > 0) {
        std::vector<char> chunk(available);
        DWORD downloaded = 0;
        if (WinHttpReadData(hRequest, chunk.data(), available, &downloaded) && downloaded > 0) {
            responseBody.append(chunk.data(), downloaded);
        } else {
            break;
        }
    }

    WinHttpCloseHandle(hRequest);
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);

    if (statusCode == 200) {
        std::string mt5Line = ExtractJsonStringField(responseBody, "mt5Line");
        if (mt5Line.empty()) {
            WriteOutputWide(Utf8ToWide(responseBody), outBuffer, outBufferLen);
        } else {
            WriteOutputWide(Utf8ToWide(mt5Line), outBuffer, outBufferLen);
        }
    } else {
        std::string errMsg = ExtractJsonStringField(responseBody, "error");
        WriteOutputWide(Utf8ToWide(errMsg.empty() ? responseBody : errMsg), outBuffer, outBufferLen);
    }

    return static_cast<int>(statusCode);
}

} // extern "C"
`;

  const headerContent = `#pragma once

#ifdef AURUMGEMINIBRIDGE_EXPORTS
#define AURUM_API __declspec(dllexport)
#else
#define AURUM_API __declspec(dllimport)
#endif

extern "C" {
    AURUM_API int __stdcall AurumAnalyzeM5(
        const wchar_t* endpointUrl,
        const wchar_t* jsonPayload,
        wchar_t* outBuffer,
        int outBufferLen
    );
}
`;

  const defContent = `LIBRARY AurumGeminiBridge
EXPORTS
    AurumAnalyzeM5
`;

  const batContent = `@echo off
setlocal
echo === Build AurumGeminiBridge.dll (Windows x64 untuk MetaTrader 5) ===

where cl >nul 2>nul
if %errorlevel%==0 (
    echo [MSVC] Mengompilasi dengan Visual Studio cl.exe...
    cl /LD /O2 /EHsc /DAURUMGEMINIBRIDGE_EXPORTS AurumGeminiBridge.cpp AurumGeminiBridge.def winhttp.lib /Fe:AurumGeminiBridge.dll
    goto :done
)

where x86_64-w64-mingw32-g++ >nul 2>nul
if %errorlevel%==0 (
    echo [MinGW-w64] Mengompilasi dengan x86_64-w64-mingw32-g++...
    x86_64-w64-mingw32-g++ -shared -O2 -DAURUMGEMINIBRIDGE_EXPORTS -municode AurumGeminiBridge.cpp AurumGeminiBridge.def -lwinhttp -static-libgcc -static-libstdc++ -o AurumGeminiBridge.dll
    goto :done
)

where g++ >nul 2>nul
if %errorlevel%==0 (
    echo [MinGW g++] Mengompilasi dengan g++...
    g++ -shared -O2 -DAURUMGEMINIBRIDGE_EXPORTS AurumGeminiBridge.cpp AurumGeminiBridge.def -lwinhttp -static-libgcc -static-libstdc++ -o AurumGeminiBridge.dll
    goto :done
)

echo [ERROR] Tidak ditemukan compiler MSVC (cl.exe) atau MinGW-w64 g++.
echo Jalankan script ini dari "x64 Native Tools Command Prompt for VS" atau install MinGW-w64.
exit /b 1

:done
if exist AurumGeminiBridge.dll (
    echo.
    echo SUKSES! File AurumGeminiBridge.dll siap disalin ke:
    echo   [Data Folder MT5]\\MQL5\\Libraries\\AurumGeminiBridge.dll
)
endlocal
`;

  return [
    {
      id: 'mq5',
      filename: 'AurumEA_XAUUSD_M5.mq5',
      label: 'Expert Advisor MT5 (.mq5)',
      targetFolder: 'MQL5\\Experts\\',
      content: mq5Content,
    },
    {
      id: 'cpp',
      filename: 'AurumGeminiBridge.cpp',
      label: 'Source C++ DLL (.cpp)',
      targetFolder: 'Build Folder',
      content: cppContent,
    },
    {
      id: 'header',
      filename: 'AurumGeminiBridge.h',
      label: 'Header C++ DLL (.h)',
      targetFolder: 'Build Folder',
      content: headerContent,
    },
    {
      id: 'def',
      filename: 'AurumGeminiBridge.def',
      label: 'Export Def (.def)',
      targetFolder: 'Build Folder',
      content: defContent,
    },
    {
      id: 'bat',
      filename: 'build_dll.bat',
      label: 'Script Build DLL (.bat)',
      targetFolder: 'Build Folder',
      content: batContent,
    },
  ];
}
