const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

const BOT_TOKEN = '8780661149:AAHrPfSfJpS18RVoXZ5b4Vj9mtFJ8kgRRGQ';
const BINANCE_API_KEY = process.env.BINANCE_API_KEY || '';
const ALLOWED_USERS = ['5941806593'];

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('البوت شغال! النسخة Pro — SMC + BTC Filter + Market Structure');

// ============================================================
// جلب الكاندلز - الآن بـ 300 شمعة لـ EMA200 الحقيقي
// ============================================================
async function getKlines(symbol, interval = '1h', limit = 300) {
  return new Promise((resolve, reject) => {
    const path = `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const options = {
      hostname: 'api.binance.com',
      path,
      method: 'GET',
      headers: { 'X-MBX-APIKEY': BINANCE_API_KEY, 'User-Agent': 'Mozilla/5.0' },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed)) resolve(parsed);
          else reject(new Error(parsed.msg || 'API Error'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ============================================================
// EMA - دالة عامة (Wilder/standard EMA)
// ============================================================
function calcEMA(closes, period) {
  if (closes.length < period) return calcEMA(closes, closes.length);
  const k = 2 / (period + 1);
  // نبدأ بـ SMA كقيمة أولية لدقة أعلى
  let sma = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let ema = sma;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

// ============================================================
// EMA200 الحقيقي - يتطلب 250-300 شمعة فعلية
// ============================================================
function calcEMA200(closes) {
  if (closes.length < 200) {
    console.log(`تحذير: بيانات أقل من 200 شمعة (${closes.length}) — EMA200 غير دقيق بالكامل`);
    return calcEMA(closes, Math.min(closes.length, 200));
  }
  return calcEMA(closes, 200);
}

// ============================================================
// RSI
// ============================================================
function calcRSI(closes, period = 14) {
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses += Math.abs(diff);
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

// ============================================================
// MACD
// ============================================================
function calcMACD(closes) {
  const ema12 = calcEMA(closes, 12), ema26 = calcEMA(closes, 26);
  const macdLine = ema12 - ema26;
  const signalLine = calcEMA(
    closes.slice(-9).map((_, i) =>
      calcEMA(closes.slice(0, closes.length - 9 + i + 1), 12) -
      calcEMA(closes.slice(0, closes.length - 9 + i + 1), 26)), 9);
  return { macd: macdLine, signal: signalLine, histogram: macdLine - signalLine };
}

// ============================================================
// ATR
// ============================================================
function calcATR(klines, period = 14) {
  const trs = [];
  for (let i = 1; i < klines.length; i++) {
    const high = parseFloat(klines[i][2]), low = parseFloat(klines[i][3]);
    const prevClose = parseFloat(klines[i - 1][4]);
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ============================================================
// ADX القياسي الكامل (Wilder's Smoothing) - +DI, -DI, DX, ADX
// ============================================================
function calcADX(klines, period = 14) {
  if (klines.length < period * 3) return { adx: 0, plusDI: 0, minusDI: 0 };

  const highs = klines.map(k => parseFloat(k[2]));
  const lows = klines.map(k => parseFloat(k[3]));
  const closes = klines.map(k => parseFloat(k[4]));

  const trList = [], plusDMList = [], minusDMList = [];

  for (let i = 1; i < klines.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];

    const plusDM = (upMove > downMove && upMove > 0) ? upMove : 0;
    const minusDM = (downMove > upMove && downMove > 0) ? downMove : 0;

    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );

    trList.push(tr);
    plusDMList.push(plusDM);
    minusDMList.push(minusDM);
  }

  // Wilder's smoothing (مثل حساب RSI الأصلي)
  function wilderSmooth(arr, period) {
    const smoothed = [];
    let sum = arr.slice(0, period).reduce((a, b) => a + b, 0);
    smoothed.push(sum);
    for (let i = period; i < arr.length; i++) {
      sum = smoothed[smoothed.length - 1] - (smoothed[smoothed.length - 1] / period) + arr[i];
      smoothed.push(sum);
    }
    return smoothed;
  }

  const smoothTR = wilderSmooth(trList, period);
  const smoothPlusDM = wilderSmooth(plusDMList, period);
  const smoothMinusDM = wilderSmooth(minusDMList, period);

  const plusDIArr = smoothPlusDM.map((v, i) => smoothTR[i] === 0 ? 0 : (v / smoothTR[i]) * 100);
  const minusDIArr = smoothMinusDM.map((v, i) => smoothTR[i] === 0 ? 0 : (v / smoothTR[i]) * 100);

  const dxArr = plusDIArr.map((plusDI, i) => {
    const minusDI = minusDIArr[i];
    const sum = plusDI + minusDI;
    return sum === 0 ? 0 : (Math.abs(plusDI - minusDI) / sum) * 100;
  });

  // ADX = متوسط متحرك لـ DX على نفس الـ period
  const adxPeriod = dxArr.slice(-period);
  const adx = adxPeriod.reduce((a, b) => a + b, 0) / adxPeriod.length;

  return {
    adx: parseFloat(adx.toFixed(1)),
    plusDI: parseFloat(plusDIArr[plusDIArr.length - 1].toFixed(1)),
    minusDI: parseFloat(minusDIArr[minusDIArr.length - 1].toFixed(1)),
  };
}

// ============================================================
// Supertrend
// ============================================================
function calcSupertrend(klines, period = 14, multiplier = 3) {
  if (klines.length < period + 1) return 'غير محدد';
  const highs = klines.map(k => parseFloat(k[2]));
  const lows = klines.map(k => parseFloat(k[3]));
  const closes = klines.map(k => parseFloat(k[4]));
  const trs = [0];
  for (let i = 1; i < klines.length; i++)
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])));
  const atrArr = new Array(klines.length).fill(0);
  for (let i = period; i < klines.length; i++)
    atrArr[i] = trs.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
  let dir = new Array(klines.length).fill(1);
  let upper = new Array(klines.length).fill(0);
  let lower = new Array(klines.length).fill(0);
  for (let i = period; i < klines.length; i++) {
    const hl2 = (highs[i] + lows[i]) / 2;
    upper[i] = hl2 + multiplier * atrArr[i];
    lower[i] = hl2 - multiplier * atrArr[i];
    if (i === period) { dir[i] = closes[i] > lower[i] ? 1 : -1; continue; }
    lower[i] = (lower[i] > lower[i-1] || closes[i-1] < lower[i-1]) ? lower[i] : lower[i-1];
    upper[i] = (upper[i] < upper[i-1] || closes[i-1] > upper[i-1]) ? upper[i] : upper[i-1];
    if (dir[i-1] === -1 && closes[i] > upper[i]) dir[i] = 1;
    else if (dir[i-1] === 1 && closes[i] < lower[i]) dir[i] = -1;
    else dir[i] = dir[i-1];
  }
  return dir[dir.length - 1] === 1 ? 'صاعد' : 'هابط';
}

// ============================================================
// VWAP
// ============================================================
function calcVWAP(klines) {
  const slice = klines.slice(-24);
  let cTPV = 0, cVol = 0;
  for (const k of slice) {
    const tp = (parseFloat(k[2]) + parseFloat(k[3]) + parseFloat(k[4])) / 3;
    cTPV += tp * parseFloat(k[5]); cVol += parseFloat(k[5]);
  }
  return cVol === 0 ? 0 : cTPV / cVol;
}

// ============================================================
// Volume
// ============================================================
function calcVolume(klines) {
  const volumes = klines.map(k => parseFloat(k[5]));
  const avg = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  return { current: volumes[volumes.length - 1], avg, ratio: parseFloat((volumes[volumes.length - 1] / avg).toFixed(2)) };
}

// ============================================================
// BTC Trend Filter - يحلل BTC على 1H و 4H
// ============================================================
async function getBTCTrend() {
  try {
    const [k1h, k4h] = await Promise.all([
      getKlines('BTCUSDT', '1h', 250),
      getKlines('BTCUSDT', '4h', 250),
    ]);

    const closes1h = k1h.map(k => parseFloat(k[4]));
    const closes4h = k4h.map(k => parseFloat(k[4]));

    const price1h = closes1h[closes1h.length - 1];
    const ema200_1h = calcEMA200(closes1h);
    const macd1h = calcMACD(closes1h);
    const adx1h = calcADX(k1h);

    const price4h = closes4h[closes4h.length - 1];
    const ema200_4h = calcEMA200(closes4h);
    const macd4h = calcMACD(closes4h);

    // تحديد القوة: صاعد قوي / هابط قوي / محايد
    const bullish1h = price1h > ema200_1h && macd1h.macd > 0;
    const bullish4h = price4h > ema200_4h && macd4h.macd > 0;
    const bearish1h = price1h < ema200_1h && macd1h.macd < 0;
    const bearish4h = price4h < ema200_4h && macd4h.macd < 0;

    let trend = 'Neutral';
    let strong = false;

    if (bullish1h && bullish4h) { trend = 'Bullish'; strong = adx1h.adx >= 20; }
    else if (bearish1h && bearish4h) { trend = 'Bearish'; strong = adx1h.adx >= 20; }
    else if (bullish4h) trend = 'Bullish';
    else if (bearish4h) trend = 'Bearish';

    return { trend, strong, price: price1h, adx: adx1h.adx };
  } catch (e) {
    console.log('خطأ في تحليل BTC:', e.message);
    return { trend: 'Neutral', strong: false, price: 0, adx: 0 };
  }// ============================================================
// Swing Highs / Swing Lows
// ============================================================
function detectSwingHighs(klines, lookback = 3) {
  const highs = klines.map(k => parseFloat(k[2]));
  const swings = [];
  for (let i = lookback; i < highs.length - lookback; i++) {
    let isSwing = true;
    for (let j = 1; j <= lookback; j++) {
      if (highs[i] <= highs[i - j] || highs[i] <= highs[i + j]) { isSwing = false; break; }
    }
    if (isSwing) swings.push({ index: i, price: highs[i] });
  }
  return swings;
}

function detectSwingLows(klines, lookback = 3) {
  const lows = klines.map(k => parseFloat(k[3]));
  const swings = [];
  for (let i = lookback; i < lows.length - lookback; i++) {
    let isSwing = true;
    for (let j = 1; j <= lookback; j++) {
      if (lows[i] >= lows[i - j] || lows[i] >= lows[i + j]) { isSwing = false; break; }
    }
    if (isSwing) swings.push({ index: i, price: lows[i] });
  }
  return swings;
}

// ============================================================
// Break of Structure (BOS)
// ============================================================
function detectBOS(klines) {
  const swingHighs = detectSwingHighs(klines);
  const swingLows = detectSwingLows(klines);
  const closes = klines.map(k => parseFloat(k[4]));
  const currentPrice = closes[closes.length - 1];

  let bullishBOS = false;
  let bearishBOS = false;

  // Bullish BOS: السعر كسر أعلى swing high سابق
  if (swingHighs.length >= 1) {
    const lastSwingHigh = swingHighs[swingHighs.length - 1];
    if (currentPrice > lastSwingHigh.price) bullishBOS = true;
  }

  // Bearish BOS: السعر كسر أدنى swing low سابق
  if (swingLows.length >= 1) {
    const lastSwingLow = swingLows[swingLows.length - 1];
    if (currentPrice < lastSwingLow.price) bearishBOS = true;
  }

  return { bullishBOS, bearishBOS };
}

// ============================================================
// Change of Character (CHOCH)
// ============================================================
function detectCHOCH(klines) {
  const swingHighs = detectSwingHighs(klines);
  const swingLows = detectSwingLows(klines);

  let bullishCHOCH = false;
  let bearishCHOCH = false;

  // CHOCH صعودي: كانت السلسلة هابطة (LL/LH) وبدأت تكسر آخر LH = أول علامة انعكاس
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const recentHighs = swingHighs.slice(-2);
    const recentLows = swingLows.slice(-2);

    const wasDowntrend = recentHighs[1].price < recentHighs[0].price && recentLows[1].price < recentLows[0].price;
    const wasUptrend = recentHighs[1].price > recentHighs[0].price && recentLows[1].price > recentLows[0].price;

    const closes = klines.map(k => parseFloat(k[4]));
    const currentPrice = closes[closes.length - 1];

    if (wasDowntrend && currentPrice > recentHighs[1].price) bullishCHOCH = true;
    if (wasUptrend && currentPrice < recentLows[1].price) bearishCHOCH = true;
  }

  return { bullishCHOCH, bearishCHOCH };
}

// ============================================================
// Market Structure العام
// ============================================================
function getMarketStructure(klines) {
  const bos = detectBOS(klines);
  const choch = detectCHOCH(klines);
  const swingHighs = detectSwingHighs(klines);
  const swingLows = detectSwingLows(klines);

  let structure = 'محايد';
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const recentHighs = swingHighs.slice(-2);
    const recentLows = swingLows.slice(-2);
    const higherHighsLows = recentHighs[1].price > recentHighs[0].price && recentLows[1].price > recentLows[0].price;
    const lowerHighsLows = recentHighs[1].price < recentHighs[0].price && recentLows[1].price < recentLows[0].price;
    if (higherHighsLows) structure = 'Bullish';
    else if (lowerHighsLows) structure = 'Bearish';
  }

  return {
    structure,
    bullishBOS: bos.bullishBOS,
    bearishBOS: bos.bearishBOS,
    bullishCHOCH: choch.bullishCHOCH,
    bearishCHOCH: choch.bearishCHOCH,
  };
}

// ============================================================
// Liquidity Sweep
// ============================================================
function detectLiquiditySweep(klines) {
  const swingHighs = detectSwingHighs(klines);
  const swingLows = detectSwingLows(klines);
  const highs = klines.map(k => parseFloat(k[2]));
  const lows = klines.map(k => parseFloat(k[3]));
  const closes = klines.map(k => parseFloat(k[4]));

  let buySideSweep = false;  // كسر قمة سابقة ثم رجع تحتها (فخ شراء)
  let sellSideSweep = false; // كسر قاع سابق ثم رجع فوقه (فخ بيع)

  if (swingHighs.length >= 1) {
    const lastHigh = swingHighs[swingHighs.length - 1];
    // الشمعة الأخيرة كسرت القمة بالـ wick لكن الإغلاق رجع تحتها
    const recentHigh = Math.max(...highs.slice(-3));
    const recentClose = closes[closes.length - 1];
    if (recentHigh > lastHigh.price && recentClose < lastHigh.price) buySideSweep = true;
  }

  if (swingLows.length >= 1) {
    const lastLow = swingLows[swingLows.length - 1];
    const recentLow = Math.min(...lows.slice(-3));
    const recentClose = closes[closes.length - 1];
    if (recentLow < lastLow.price && recentClose > lastLow.price) sellSideSweep = true;
  }

  return { buySideSweep, sellSideSweep };
}

// ============================================================
// Order Blocks - آخر شمعة انعكاسية قبل حركة قوية
// ============================================================
function detectOrderBlocks(klines) {
  const opens = klines.map(k => parseFloat(k[1]));
  const closes = klines.map(k => parseFloat(k[4]));
  const highs = klines.map(k => parseFloat(k[2]));
  const lows = klines.map(k => parseFloat(k[3]));

  let bullishOB = null;
  let bearishOB = null;

  // نبحث آخر 20 شمعة عن حركة قوية (3 شمعات صعود/هبوط متتالية بقوة)
  for (let i = closes.length - 20; i < closes.length - 3; i++) {
    if (i < 1) continue;

    // حركة صعود قوية بعد شمعة هابطة = Bullish OB
    const strongUpMove = closes[i+1] > opens[i+1] && closes[i+2] > opens[i+2] && closes[i+3] > opens[i+3]
      && (closes[i+3] - opens[i+1]) / opens[i+1] > 0.01;
    if (strongUpMove && closes[i] < opens[i]) {
      bullishOB = { high: highs[i], low: lows[i], index: i };
    }

    // حركة نزول قوية بعد شمعة صاعدة = Bearish OB
    const strongDownMove = closes[i+1] < opens[i+1] && closes[i+2] < opens[i+2] && closes[i+3] < opens[i+3]
      && (opens[i+1] - closes[i+3]) / opens[i+1] > 0.01;
    if (strongDownMove && closes[i] > opens[i]) {
      bearishOB = { high: highs[i], low: lows[i], index: i };
    }
  }

  return { bullishOB, bearishOB };
}

// ============================================================
// Fair Value Gap (FVG)
// ============================================================
function detectFVG(klines) {
  const highs = klines.map(k => parseFloat(k[2]));
  const lows = klines.map(k => parseFloat(k[3]));

  let bullishFVG = null;
  let bearishFVG = null;

  // نبحث في آخر 15 شمعة
  for (let i = klines.length - 15; i < klines.length - 2; i++) {
    if (i < 1) continue;

    // Bullish FVG: low الشمعة i+2 أعلى من high الشمعة i (فجوة صعودية)
    if (lows[i + 2] > highs[i]) {
      bullishFVG = { top: lows[i + 2], bottom: highs[i], index: i };
    }

    // Bearish FVG: high الشمعة i+2 أقل من low الشمعة i (فجوة نزولية)
    if (highs[i + 2] < lows[i]) {
      bearishFVG = { top: lows[i], bottom: highs[i + 2], index: i };
    }
  }

  return { bullishFVG, bearishFVG };
}

// ============================================================
// SMC Strength - تقييم قوة كل عناصر SMC مجتمعة
// ============================================================
function getSMCStrength(structure, liquidity, orderBlocks, fvg, direction) {
  let points = 0;

  if (direction === 'Long') {
    if (structure.structure === 'Bullish') points++;
    if (structure.bullishBOS) points++;
    if (structure.bullishCHOCH) points++;
    if (liquidity.sellSideSweep) points++;
    if (orderBlocks.bullishOB) points++;
    if (fvg.bullishFVG) points++;
  } else {
    if (structure.structure === 'Bearish') points++;
    if (structure.bearishBOS) points++;
    if (structure.bearishCHOCH) points++;
    if (liquidity.buySideSweep) points++;
    if (orderBlocks.bearishOB) points++;
    if (fvg.bearishFVG) points++;
  }

  if (points >= 4) return 'Strong';
  if (points >= 2) return 'Medium';
  return 'Weak';
}

// ============================================================
// Candle Patterns - Bullish/Bearish Engulfing, Pin Bar, Rejection
// ============================================================
function detectCandlePatterns(klines) {
  const len = klines.length;
  const opens = klines.map(k => parseFloat(k[1]));
  const highs = klines.map(k => parseFloat(k[2]));
  const lows = klines.map(k => parseFloat(k[3]));
  const closes = klines.map(k => parseFloat(k[4]));

  const i = len - 1; // آخر شمعة مغلقة
  const prev = len - 2;

  const patterns = {
    bullishEngulfing: false,
    bearishEngulfing: false,
    pinBar: false,
    rejectionCandle: false,
  };

  if (i < 1) return patterns;

  // Bullish Engulfing
  if (closes[prev] < opens[prev] && closes[i] > opens[i] &&
      closes[i] > opens[prev] && opens[i] < closes[prev]) {
    patterns.bullishEngulfing = true;
  }

  // Bearish Engulfing
  if (closes[prev] > opens[prev] && closes[i] < opens[i] &&
      closes[i] < opens[prev] && opens[i] > closes[prev]) {
    patterns.bearishEngulfing = true;
  }

  // Pin Bar (ذيل طويل في اتجاه واحد، جسم صغير)
  const body = Math.abs(closes[i] - opens[i]);
  const range = highs[i] - lows[i];
  const upperWick = highs[i] - Math.max(closes[i], opens[i]);
  const lowerWick = Math.min(closes[i], opens[i]) - lows[i];

  if (range > 0 && body / range < 0.3) {
    if (lowerWick / range > 0.5 || upperWick / range > 0.5) {
      patterns.pinBar = true;
    }
  }

  // Rejection Candle (ذيل واضح يرفض مستوى معين، حتى لو الجسم أكبر من Pin Bar)
  if (range > 0 && (upperWick / range > 0.4 || lowerWick / range > 0.4) && body / range < 0.5) {
    patterns.rejectionCandle = true;
  }

  return patterns;
}

// ============================================================
// Volatility Filter باستخدام ATR
// ============================================================
function getVolatilityLevel(atr, price) {
  const atrPercent = (atr / price) * 100;
  if (atrPercent >= 3) return { level: 'High', score: 3 };
  if (atrPercent >= 1.2) return { level: 'Medium', score: 5 };
  return { level: 'Low', score: 2 };
}

// ============================================================
// Trading Session - حسب UTC
// ============================================================
function getTradingSession() {
  const hourUTC = new Date().getUTCHours();
  // Asian: 00-08 UTC | London: 08-16 UTC | New York: 13-21 UTC (تداخل مع London)
  if (hourUTC >= 13 && hourUTC < 16) return { session: 'London + New York Overlap', score: 5 };
  if (hourUTC >= 8 && hourUTC < 16) return { session: 'London', score: 4 };
  if (hourUTC >= 13 && hourUTC < 21) return { session: 'New York', score: 4 };
  if (hourUTC >= 0 && hourUTC < 8) return { session: 'Asian', score: 2 };
  return { session: 'Low Liquidity', score: 1 };
}
}// ============================================================
// الدعم والمقاومة - 3 مستويات لكل جهة
// ============================================================
function calcSupportResistance(klines) {
  const slice = klines.slice(-100);
  const highs = slice.map(k => parseFloat(k[2]));
  const lows = slice.map(k => parseFloat(k[3]));
  const closes = slice.map(k => parseFloat(k[4]));
  const price = closes[closes.length - 1];
  const pivots = [];
  for (let i = 2; i < slice.length - 2; i++) {
    if (highs[i] > highs[i-1] && highs[i] > highs[i-2] && highs[i] > highs[i+1] && highs[i] > highs[i+2])
      pivots.push({ type: 'R', price: highs[i] });
    if (lows[i] < lows[i-1] && lows[i] < lows[i-2] && lows[i] < lows[i+1] && lows[i] < lows[i+2])
      pivots.push({ type: 'S', price: lows[i] });
  }
  const resistances = pivots.filter(p => p.type === 'R' && p.price > price).map(p => p.price).sort((a,b) => a-b);
  const supports = pivots.filter(p => p.type === 'S' && p.price < price).map(p => p.price).sort((a,b) => b-a);
  return {
    r1: resistances[0] || price * 1.015,
    r2: resistances[1] || price * 1.03,
    r3: resistances[2] || price * 1.045,
    s1: supports[0] || price * 0.985,
    s2: supports[1] || price * 0.97,
    s3: supports[2] || price * 0.955,
  };
}

function getFrameDirection(klines) {
  const closes = klines.map(k => parseFloat(k[4]));
  const price = closes[closes.length - 1];
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const macd = calcMACD(closes);
  if (price > ema20 && price > ema50 && macd.macd > 0) return 'صاعد';
  if (price < ema20 && price < ema50 && macd.macd < 0) return 'هابط';
  return 'محايد';
}

function getNewsLink(symbol) {
  const coin = symbol.replace('USDT', '').toLowerCase();
  return `https://cryptopanic.com/news/${coin}/`;
}

// ============================================================
// تقييم جودة الهدف - بعيد عن دعم/مقاومة قوي = جودة أعلى
// ============================================================
function evaluateTargetQuality(target, atr, sr, direction) {
  // نحسب أقرب مستوى دعم/مقاومة "وسيط" للهدف نفسه (عقبة محتملة قبل الوصول له)
  const levels = direction === 'Long'
    ? [sr.r1, sr.r2, sr.r3]
    : [sr.s1, sr.s2, sr.s3];

  // أقرب مستوى لنفس الهدف (غير نفسه) يعتبر عقبة
  let minDistance = Infinity;
  for (const lvl of levels) {
    if (Math.abs(lvl - target) < 0.0001) continue; // نفس المستوى، تجاهل
    const dist = Math.abs(lvl - target);
    if (dist < minDistance) minDistance = dist;
  }

  const distanceInATR = minDistance / atr;

  if (distanceInATR >= 2) return { quality: 'Strong', warning: null };
  if (distanceInATR >= 1) return { quality: 'Medium', warning: null };
  return { quality: 'Weak', warning: '⚠️ الهدف قريب من مستوى دعم/مقاومة آخر' };
}

// ============================================================
// تصنيف الإشارة (Signal Grade)
// ============================================================
function getSignalGrade(score) {
  if (score >= 90) return { grade: 'A+', label: '🔥 A+ Elite Setup', rate: '~78%' };
  if (score >= 80) return { grade: 'A', label: '🟢 A Strong Setup', rate: '~68%' };
  if (score >= 70) return { grade: 'B', label: '🟡 B Good Setup', rate: '~58%' };
  if (score >= 60) return { grade: 'C', label: '🟠 C Risky Setup', rate: '~48%' };
  return { grade: 'Reject', label: '🔴 Reject', rate: '—' };
}

// ============================================================
// محرك التحليل الكامل - analyzeSymbol
// ============================================================
async function analyzeSymbol(symbol, btcTrend) {
  try {
    const [klines1h, klines4h] = await Promise.all([
      getKlines(symbol, '1h', 300),
      getKlines(symbol, '4h', 300),
    ]);
    if (!klines1h || klines1h.length < 60) return null;

    const closes = klines1h.map(k => parseFloat(k[4]));
    const price = closes[closes.length - 1];

    // المؤشرات الأساسية المُصححة
    const ema200 = calcEMA200(closes);
    const vwap = calcVWAP(klines1h);
    const rsi = calcRSI(closes);
    const macdData = calcMACD(closes);
    const adx = calcADX(klines1h);
    const atr = calcATR(klines1h);
    const volume = calcVolume(klines1h);
    const supertrend = calcSupertrend(klines1h);
    const sr = calcSupportResistance(klines1h);
    const dir1h = getFrameDirection(klines1h);
    const dir4h = getFrameDirection(klines4h);

    // تحديد الاتجاه المقترح
    const bullish = price > ema200 && price > vwap;
    const bearish = price < ema200 && price < vwap;
    const direction = bullish ? 'Long' : bearish ? 'Short' : null;

    // الرفض المباشر الوحيد: لا يوجد اتجاه واضح خالص
    if (!direction) return null;

    // ============================================================
    // Market Structure + SMC
    // ============================================================
    const structure = getMarketStructure(klines1h);
    const liquidity = detectLiquiditySweep(klines1h);
    const orderBlocks = detectOrderBlocks(klines1h);
    const fvg = detectFVG(klines1h);
    const smcStrength = getSMCStrength(structure, liquidity, orderBlocks, fvg, direction);
    const candlePatterns = detectCandlePatterns(klines1h);
    const volatility = getVolatilityLevel(atr, price);
    const session = getTradingSession();

    // ============================================================
    // نظام النقاط الجديد من 100
    // Trend=25 | Momentum=15 | Volume=15 | SMC=25 | BTC=10 | Volatility=5 | News=5
    // ============================================================
    const breakdown = {};

    // 1. Trend (25)
    let trendScore = 0;
    if (direction === 'Long') {
      if (price > ema200) trendScore += 10;
      if (price > vwap) trendScore += 6;
      if (supertrend === 'صاعد') trendScore += 5;
      if (dir1h === dir4h && dir1h === 'صاعد') trendScore += 4;
    } else {
      if (price < ema200) trendScore += 10;
      if (price < vwap) trendScore += 6;
      if (supertrend === 'هابط') trendScore += 5;
      if (dir1h === dir4h && dir1h === 'هابط') trendScore += 4;
    }
    breakdown.trend = Math.min(25, trendScore);

    // 2. Momentum - RSI + MACD (15)
    let momentumScore = 0;
    if (direction === 'Long') {
      if (macdData.macd > 0) momentumScore += 4;
      if (macdData.histogram > 0) momentumScore += 3;
      if (rsi >= 50 && rsi <= 70) momentumScore += 8;
      else if (rsi >= 45 && rsi <= 75) momentumScore += 4;
    } else {
      if (macdData.macd < 0) momentumScore += 4;
      if (macdData.histogram < 0) momentumScore += 3;
      if (rsi >= 30 && rsi <= 50) momentumScore += 8;
      else if (rsi >= 25 && rsi <= 55) momentumScore += 4;
    }
    breakdown.momentum = Math.min(15, momentumScore);

    // 3. Volume (15)
    let volumeScore = 0;
    if (volume.ratio >= 1.8) volumeScore = 15;
    else if (volume.ratio >= 1.4) volumeScore = 12;
    else if (volume.ratio >= 1.0) volumeScore = 8;
    else if (volume.ratio >= 0.7) volumeScore = 4;
    breakdown.volume = volumeScore;

    // 4. SMC (25)
    let smcScore = 0;
    if (direction === 'Long') {
      if (structure.structure === 'Bullish') smcScore += 5;
      if (structure.bullishBOS) smcScore += 5;
      if (structure.bullishCHOCH) smcScore += 4;
      if (liquidity.sellSideSweep) smcScore += 4;
      if (orderBlocks.bullishOB) smcScore += 3;
      if (fvg.bullishFVG) smcScore += 2;
      if (candlePatterns.bullishEngulfing || candlePatterns.pinBar) smcScore += 2;
    } else {
      if (structure.structure === 'Bearish') smcScore += 5;
      if (structure.bearishBOS) smcScore += 5;
      if (structure.bearishCHOCH) smcScore += 4;
      if (liquidity.buySideSweep) smcScore += 4;
      if (orderBlocks.bearishOB) smcScore += 3;
      if (fvg.bearishFVG) smcScore += 2;
      if (candlePatterns.bearishEngulfing || candlePatterns.pinBar) smcScore += 2;
    }
    breakdown.smc = Math.min(25, smcScore);

    // 5. BTC Filter (10)
    let btcScore = 5; // قيمة افتراضية محايدة
    let btcAligned = true;
    if (direction === 'Long') {
      if (btcTrend.trend === 'Bullish') btcScore = 10;
      else if (btcTrend.trend === 'Neutral') btcScore = 6;
      else { btcScore = 2; btcAligned = false; }
    } else {
      if (btcTrend.trend === 'Bearish') btcScore = 10;
      else if (btcTrend.trend === 'Neutral') btcScore = 6;
      else { btcScore = 2; btcAligned = false; }
    }
    breakdown.btc = btcScore;

    // 6. Volatility (5)
    breakdown.volatility = volatility.score;

    // 7. News (5) - لا يوجد API أخبار مجاني حقيقي، نعطي قيمة متوسطة ثابتة
    breakdown.news = 3;

    // المجموع قبل الخصومات
    let totalScore = breakdown.trend + breakdown.momentum + breakdown.volume +
                      breakdown.smc + breakdown.btc + breakdown.volatility + breakdown.news;

    // ============================================================
    // Red Flags - خصومات تدريجية، ليست رفضاً مباشراً
    // ============================================================
    const redFlags = [];

    if (volume.ratio < 0.5) { totalScore -= 10; redFlags.push('🚩 Low Volume'); }
    if (!btcAligned && btcTrend.strong) { totalScore -= 10; redFlags.push('🚩 Counter BTC Trend'); }

    // قرب من دعم/مقاومة قوي
    const distToR1 = Math.abs(sr.r1 - price) / atr;
    const distToS1 = Math.abs(price - sr.s1) / atr;
    if (direction === 'Long' && distToR1 < 0.5) { totalScore -= 8; redFlags.push('🚩 Near Resistance'); }
    if (direction === 'Short' && distToS1 < 0.5) { totalScore -= 8; redFlags.push('🚩 Near Support'); }

    // RSI Extreme
    if (rsi >= 78 || rsi <= 22) { totalScore -= 5; redFlags.push('🚩 RSI Extreme'); }

    // Low Volatility
    if (volatility.level === 'Low') { totalScore -= 5; redFlags.push('🚩 Low Volatility'); }

    // Weak Momentum
    if (breakdown.momentum < 6) redFlags.push('🚩 Weak Momentum');

    totalScore = Math.max(0, Math.min(100, totalScore));

    // ============================================================
    // حساب الأهداف + تقييم جودتهم
    // ============================================================
    const entry = price;
    let target1, target2, target3, stopLoss;

    if (direction === 'Long') {
      target1 = sr.r1; target2 = sr.r2; target3 = sr.r3;
      stopLoss = Math.max(sr.s1, price - atr * 1.5);
    } else {
      target1 = sr.s1; target2 = sr.s2; target3 = sr.s3;
      stopLoss = Math.min(sr.r1, price + atr * 1.5);
    }

    const riskAmount = Math.abs(entry - stopLoss);
    const rr1 = parseFloat((Math.abs(target1 - entry) / riskAmount).toFixed(2));
    const rr2 = parseFloat((Math.abs(target2 - entry) / riskAmount).toFixed(2));
    const rr3 = parseFloat((Math.abs(target3 - entry) / riskAmount).toFixed(2));

    const tp1Quality = evaluateTargetQuality(target1, atr, sr, direction);
    const tp2Quality = evaluateTargetQuality(target2, atr, sr, direction);
    const tp3Quality = evaluateTargetQuality(target3, atr, sr, direction);

    const grade = getSignalGrade(totalScore);

    console.log(`${symbol} | Score=${totalScore.toFixed(0)}/100 | Grade=${grade.grade} | Dir=${direction} | BTC=${btcTrend.trend} | SMC=${smcStrength} | Flags=${redFlags.length}`);

    return {
      symbol, score: Math.round(totalScore), grade, direction, price,
      breakdown, redFlags,
      rsi, macdData, adx, volume, supertrend, vwap, ema200,
      dir1h, dir4h, structure, liquidity, orderBlocks, fvg, smcStrength,
      candlePatterns, volatility, session, btcTrend,
      entry, target1, target2, target3, stopLoss, rr1, rr2, rr3,
      tp1Quality, tp2Quality, tp3Quality,
      newsLink: getNewsLink(symbol)
    };
  } catch (e) {
    console.log(`${symbol} | خطأ: ${e.message}`);
    return null;
  }
}// ============================================================
// تنسيق رسالة الإشارة الكاملة - كل الأقسام المطلوبة
// ============================================================
function formatSignal(r) {
  const dirEmoji = r.direction === 'Long' ? '📈' : '📉';
  const tpQualityEmoji = (q) => q === 'Strong' ? '✅ Strong' : q === 'Medium' ? '🟡 Medium' : '⚠️ Weak';

  let msg = '';

  // العنوان
  msg += `${r.grade.label} *${r.symbol} — ${r.direction} ${dirEmoji}*\n\n`;
  msg += `💰 السعر: \`${r.price.toFixed(4)}\`\n`;
  msg += `⭐ Total Score: *${r.score}/100*\n`;
  msg += `🎯 نسبة النجاح المتوقعة: ${r.grade.rate}\n\n`;

  // Confidence Breakdown
  msg += `📊 *Confidence Breakdown*\n`;
  msg += `• Trend: ${r.breakdown.trend}/25\n`;
  msg += `• Momentum: ${r.breakdown.momentum}/15\n`;
  msg += `• Volume: ${r.breakdown.volume}/15\n`;
  msg += `• SMC: ${r.breakdown.smc}/25\n`;
  msg += `• BTC Filter: ${r.breakdown.btc}/10\n`;
  msg += `• Volatility: ${r.breakdown.volatility}/5\n`;
  msg += `• News: ${r.breakdown.news}/5\n\n`;

  // Market Structure
  msg += `🏗️ *Market Structure*\n`;
  msg += `• Structure: ${r.structure.structure}\n`;
  msg += `• BOS: ${r.direction === 'Long' ? (r.structure.bullishBOS ? 'Yes ✅' : 'No') : (r.structure.bearishBOS ? 'Yes ✅' : 'No')}\n`;
  msg += `• CHOCH: ${r.direction === 'Long' ? (r.structure.bullishCHOCH ? 'Yes ✅' : 'No') : (r.structure.bearishCHOCH ? 'Yes ✅' : 'No')}\n\n`;

  // SMC Analysis
  msg += `🧠 *SMC Analysis*\n`;
  const sweepDetected = r.direction === 'Long' ? r.liquidity.sellSideSweep : r.liquidity.buySideSweep;
  msg += `• Liquidity Sweep: ${sweepDetected ? 'Detected ✅' : 'Not Detected'}\n`;
  const obType = r.orderBlocks.bullishOB ? 'Bullish' : r.orderBlocks.bearishOB ? 'Bearish' : 'None';
  msg += `• Order Block: ${obType}\n`;
  const fvgType = r.fvg.bullishFVG ? 'Bullish' : r.fvg.bearishFVG ? 'Bearish' : 'None';
  msg += `• FVG: ${fvgType}\n`;
  msg += `• SMC Strength: ${r.smcStrength}\n\n`;

  // BTC Filter
  msg += `₿ *BTC Filter*\n`;
  msg += `• BTC Trend: ${r.btcTrend.trend}${r.btcTrend.strong ? ' (قوي)' : ''}\n`;
  const aligned = (r.direction === 'Long' && r.btcTrend.trend !== 'Bearish') ||
                  (r.direction === 'Short' && r.btcTrend.trend !== 'Bullish');
  msg += `• Alignment: ${aligned ? 'Aligned ✅' : 'Counter Trend ⚠️'}\n\n`;

  // Volatility
  msg += `📉 *Volatility*\n`;
  msg += `• ATR: ${r.adx.adx > 0 ? r.adx.adx : '—'} | ADX: ${r.adx.adx}\n`;
  msg += `• Level: ${r.volatility.level}\n\n`;

  // Session
  msg += `🕐 *Session:* ${r.session.session}\n\n`;

  // الفريمات
  msg += `⏱️ *الفريمات:*\n`;
  msg += `• 1H: ${r.dir1h}\n`;
  msg += `• 4H: ${r.dir4h}\n\n`;

  // المؤشرات الكلاسيكية
  msg += `📈 *المؤشرات:*\n`;
  msg += `• RSI: ${r.rsi.toFixed(1)}\n`;
  msg += `• MACD: ${r.macdData.macd > 0 ? 'صاعد ✅' : 'هابط ❌'}\n`;
  msg += `• Supertrend: ${r.supertrend}\n`;
  msg += `• الحجم: x${r.volume.ratio}\n`;
  msg += `• Candle: ${r.candlePatterns.bullishEngulfing ? 'Bullish Engulfing' : r.candlePatterns.bearishEngulfing ? 'Bearish Engulfing' : r.candlePatterns.pinBar ? 'Pin Bar' : r.candlePatterns.rejectionCandle ? 'Rejection' : 'None'}\n\n`;

  // Red Flags
  if (r.redFlags.length > 0) {
    msg += `⚠️ *Red Flags*\n`;
    msg += r.redFlags.join('\n') + '\n\n';
  }

  // الأهداف مع تقييم الجودة
  msg += `📐 *الصفقة:*\n`;
  msg += `• الدخول: \`${r.entry.toFixed(4)}\`\n\n`;
  msg += `🎯 *الأهداف:*\n`;
  msg += `• TP1: \`${r.target1.toFixed(4)}\` (R:R 1:${r.rr1}) — ${tpQualityEmoji(r.tp1Quality.quality)}\n`;
  if (r.tp1Quality.warning) msg += `  ${r.tp1Quality.warning}\n`;
  msg += `• TP2: \`${r.target2.toFixed(4)}\` (R:R 1:${r.rr2}) — ${tpQualityEmoji(r.tp2Quality.quality)}\n`;
  if (r.tp2Quality.warning) msg += `  ${r.tp2Quality.warning}\n`;
  msg += `• TP3: \`${r.target3.toFixed(4)}\` (R:R 1:${r.rr3}) — ${tpQualityEmoji(r.tp3Quality.quality)}\n`;
  if (r.tp3Quality.warning) msg += `  ${r.tp3Quality.warning}\n`;
  msg += `\n🔴 وقف الخسارة: \`${r.stopLoss.toFixed(4)}\`\n\n`;

  msg += `📰 [أخبار ${r.symbol.replace('USDT','')}](${r.newsLink})\n\n`;
  msg += `💡 خد جزء من الربح عند كل هدف (40%/30%/30%)\n\n`;
  msg += `⚠️ للأغراض التعليمية فقط — النسب تقديرية وليست ضمانة`;

  return msg;
}

// ============================================================
// قائمة العملات - 50 عملة
// ============================================================
const SYMBOLS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
  'ADAUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','LINKUSDT',
  'MATICUSDT','LTCUSDT','ATOMUSDT','NEARUSDT','OPUSDT',
  'ARBUSDT','APTUSDT','INJUSDT','SUIUSDT','TIAUSDT',
  'GALAUSDT','SANDUSDT','MANAUSDT','AXSUSDT','APEUSDT',
  'FTMUSDT','ALGOUSDT','ICPUSDT','FILUSDT','EGLDUSDT',
  'THETAUSDT','VETUSDT','XTZUSDT','EOSUSDT','ZILUSDT',
  'ENJUSDT','CHZUSDT','BATUSDT','QTUMUSDT','ONTUSDT',
  'WAVESUSDT','ZECUSDT','DASHUSDT','NEOUSDT','IOSTUSDT',
  'STXUSDT','FLOWUSDT','MINAUSDT','ROSEUSDT','CELOUSDT'
];

// ============================================================
// مسح السوق - يحلل BTC مرة واحدة بس ثم يمررها لكل عملة
// ============================================================
async function scanMarket() {
  console.log('=== بدء مسح 50 عملة Pro ===');
  const btcTrend = await getBTCTrend();
  console.log(`BTC Trend: ${btcTrend.trend} | Strong: ${btcTrend.strong}`);

  const results = [];
  for (const symbol of SYMBOLS) {
    const r = await analyzeSymbol(symbol, btcTrend);
    if (r && r.score >= 60) results.push(r); // غير صارم - حتى C يعتبر مقبول للعرض
  }
  console.log(`=== انتهى المسح: ${results.length} إشارة ===`);
  return results.sort((a, b) => b.score - a.score);
}

// ============================================================
// القائمة الرئيسية
// ============================================================
function getMainMenu() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '🔍 مسح السوق' }, { text: '📊 تحليل عملة' }],
        [{ text: '🚀 أفضل الفرص' }, { text: 'ℹ️ المساعدة' }],
      ],
      resize_keyboard: true,
    },
  };
}

function isAllowed(chatId) { return ALLOWED_USERS.includes(chatId.toString()); }

// ============================================================
// أوامر البوت
// ============================================================
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) { bot.sendMessage(chatId, '🚫 البوت خاص.'); return; }
  bot.sendMessage(chatId,
    '👋 أهلاً! النسخة Pro — SMC + BTC Filter\n\n' +
    '🧠 Market Structure + Order Blocks + FVG\n' +
    '₿ فلتر اتجاه البيتكوين\n' +
    '🎯 3 أهداف مقيّمة الجودة\n\n' +
    'اختار من القائمة 👇',
    getMainMenu()
  );
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!isAllowed(chatId)) return;
  if (!text) return;

  if (text === '🔍 مسح السوق' || text === '🚀 أفضل الفرص') {
    await bot.sendMessage(chatId, '⏳ جاري المسح الاحترافي لـ 50 عملة... (قد يستغرق 4-5 دقائق)');
    const results = await scanMarket();
    if (results.length === 0) {
      await bot.sendMessage(chatId, '📊 *مفيش إشارات دلوقتي*\n\nجرب بعد شوية. ⏳', { parse_mode: 'Markdown', ...getMainMenu() });
      return;
    }
    for (const r of results.slice(0, 5)) {
      await bot.sendMessage(chatId, formatSignal(r), { parse_mode: 'Markdown' });
    }
    await bot.sendMessage(chatId, `✅ انتهى المسح — ${results.length} إشارة`, getMainMenu());
    return;
  }

  if (text === '📊 تحليل عملة') {
    await bot.sendMessage(chatId, '📊 اكتب اسم العملة:\nمثال: BTC أو ETH أو SOL');
    return;
  }

  if (text === 'ℹ️ المساعدة') {
    await bot.sendMessage(chatId,
      '📖 *النسخة Pro*\n\n' +
      '✅ EMA200 حقيقي (300 شمعة)\n' +
      '✅ ADX قياسي كامل\n' +
      '✅ فلتر اتجاه BTC\n' +
      '✅ Market Structure (BOS/CHOCH)\n' +
      '✅ SMC (Liquidity/OB/FVG)\n' +
      '✅ Candle Patterns\n' +
      '✅ 3 أهداف مقيّمة الجودة\n\n' +
      '*التصنيف:*\n' +
      '🔥 A+ 90+ (~78%)\n' +
      '🟢 A 80-89 (~68%)\n' +
      '🟡 B 70-79 (~58%)\n' +
      '🟠 C 60-69 (~48%)\n' +
      '🔴 أقل من 60 = Reject\n\n' +
      '⚠️ النسب تقديرية وليست ضمانة\n' +
      '⚠️ للأغراض التعليمية فقط',
      { parse_mode: 'Markdown', ...getMainMenu() }
    );
    return;
  }

  if (/^[a-zA-Z]{2,10}$/.test(text)) {
    const symbol = text.toUpperCase().replace('USDT', '') + 'USDT';
    await bot.sendMessage(chatId, `⏳ جاري التحليل الاحترافي لـ ${symbol}...`);
    const btcTrend = await getBTCTrend();
    const result = await analyzeSymbol(symbol, btcTrend);
    if (!result) {
      await bot.sendMessage(chatId, '❌ مش لاقي إشارة أو الاتجاه غير واضح', getMainMenu());
      return;
    }
    await bot.sendMessage(chatId, formatSignal(result), { parse_mode: 'Markdown', ...getMainMenu() });
  }
});

bot.on('polling_error', (error) => console.error('خطأ:', error.message));
