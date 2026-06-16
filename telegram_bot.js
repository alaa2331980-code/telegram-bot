const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

// ============================================================
// الإعدادات الأساسية
// ============================================================
const BOT_TOKEN = '8780661149:AAHrPfSfJpS18RVoXZ5b4Vj9mtFJ8kgRRGQ';
const BINANCE_API_KEY = process.env.BINANCE_API_KEY || '';

// Whitelist - فقط هذا الـ ID يستطيع استخدام البوت
const ALLOWED_USERS = ['5941806593'];

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('البوت شغال! النسخة الاحترافية v4');

// ============================================================
// JSON Schema للإشارة
// ============================================================
/*
{
  symbol: "BTCUSDT",
  direction: "Long" | "Short",
  score: 85,
  grade: "قوي" | "قوي جداً" | "عادي" | "مرفوض",
  entry: 65000.00,
  target: 67500.00,
  stopLoss: 63800.00,
  riskReward: "1:1.8",
  scoreBreakdown: {
    trend: 18,        // max 20
    alignment: 12,    // max 15
    adx: 8,           // max 10
    volume: 9,        // max 10
    macd: 8,          // max 10
    rsi: 8,           // max 10
    marketStructure: 9, // max 10
    supportResistance: 4, // max 5
    riskReward: 9     // max 10
  },
  rejectReasons: [],
  indicators: {
    rsi: 58.5,
    adx: 28.3,
    macd: "Bullish",
    histogram: "Positive",
    supertrend: "صاعد",
    vwap: 64800.00,
    ema200: 62000.00,
    volume_ratio: 1.45,
    trend_1h: "صاعد",
    trend_4h: "صاعد"
  },
  timestamp: "2026-06-16T10:30:00Z"
}
*/

// ============================================================
// دالة جلب الكاندلز
// ============================================================
async function getKlines(symbol, interval = '1h', limit = 200) {
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
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ============================================================
// المؤشرات
// ============================================================
function calcEMA(closes, period) {
  const k = 2 / (period + 1);
  let val = closes[0];
  for (let i = 1; i < closes.length; i++) val = closes[i] * k + val * (1 - k);
  return val;
}

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

function calcStochRSI(closes, period = 14) {
  const rsiValues = [];
  for (let i = period; i < closes.length; i++)
    rsiValues.push(calcRSI(closes.slice(i - period, i + 1)));
  const recent = rsiValues.slice(-period);
  const minRSI = Math.min(...recent), maxRSI = Math.max(...recent);
  if (maxRSI === minRSI) return 50;
  return ((rsiValues[rsiValues.length - 1] - minRSI) / (maxRSI - minRSI)) * 100;
}

function calcMACD(closes) {
  const ema12 = calcEMA(closes, 12), ema26 = calcEMA(closes, 26);
  const macdLine = ema12 - ema26;
  const signalLine = calcEMA(
    closes.slice(-9).map((_, i) =>
      calcEMA(closes.slice(0, closes.length - 9 + i + 1), 12) -
      calcEMA(closes.slice(0, closes.length - 9 + i + 1), 26)), 9);
  return { macd: macdLine, signal: signalLine, histogram: macdLine - signalLine };
}

function calcATR(klines, period = 14) {
  const trs = [];
  for (let i = 1; i < klines.length; i++) {
    const high = parseFloat(klines[i][2]), low = parseFloat(klines[i][3]);
    const prevClose = parseFloat(klines[i - 1][4]);
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcADX(klines, period = 14) {
  if (klines.length < period * 2) return { adx: 0, plusDI: 0, minusDI: 0 };
  const highs = klines.map(k => parseFloat(k[2]));
  const lows = klines.map(k => parseFloat(k[3]));
  const closes = klines.map(k => parseFloat(k[4]));
  const trArr = [], plusDM = [], minusDM = [];
  for (let i = 1; i < klines.length; i++) {
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1]));
    const upMove = highs[i] - highs[i-1], downMove = lows[i-1] - lows[i];
    trArr.push(tr);
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const smoothTR = trArr.slice(-period).reduce((a, b) => a + b, 0);
  const smoothPDM = plusDM.slice(-period).reduce((a, b) => a + b, 0);
  const smoothMDM = minusDM.slice(-period).reduce((a, b) => a + b, 0);
  const plusDI = smoothTR === 0 ? 0 : (smoothPDM / smoothTR) * 100;
  const minusDI = smoothTR === 0 ? 0 : (smoothMDM / smoothTR) * 100;
  const dx = (plusDI + minusDI) === 0 ? 0 : (Math.abs(plusDI - minusDI) / (plusDI + minusDI)) * 100;
  return { adx: parseFloat(dx.toFixed(1)), plusDI: parseFloat(plusDI.toFixed(1)), minusDI: parseFloat(minusDI.toFixed(1)) };
}

function calcSupertrend(klines, period = 14, multiplier = 3) {
  if (klines.length < period + 1) return 'غير محدد';
  const highs = klines.map(k => parseFloat(k[2]));
  const lows = klines.map(k => parseFloat(k[3]));
  const closes = klines.map(k => parseFloat(k[4]));
  const trs = [0];
  for (let i = 1; i < klines.length; i++)
    trs.push(Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1])));
  const atrArr = new Array(klines.length).fill(0);
  for (let i = period; i < klines.length; i++)
    atrArr[i] = trs.slice(i-period+1, i+1).reduce((a,b) => a+b, 0) / period;
  let direction = new Array(klines.length).fill(1);
  let upper = new Array(klines.length).fill(0);
  let lower = new Array(klines.length).fill(0);
  for (let i = period; i < klines.length; i++) {
    const hl2 = (highs[i]+lows[i])/2;
    upper[i] = hl2 + multiplier * atrArr[i];
    lower[i] = hl2 - multiplier * atrArr[i];
    if (i === period) { direction[i] = closes[i] > lower[i] ? 1 : -1; continue; }
    lower[i] = (lower[i] > lower[i-1] || closes[i-1] < lower[i-1]) ? lower[i] : lower[i-1];
    upper[i] = (upper[i] < upper[i-1] || closes[i-1] > upper[i-1]) ? upper[i] : upper[i-1];
    if (direction[i-1] === -1 && closes[i] > upper[i]) direction[i] = 1;
    else if (direction[i-1] === 1 && closes[i] < lower[i]) direction[i] = -1;
    else direction[i] = direction[i-1];
  }
  return direction[direction.length-1] === 1 ? 'صاعد' : 'هابط';
}

function calcVWAP(klines) {
  const slice = klines.slice(-24);
  let cTPV = 0, cVol = 0;
  for (const k of slice) {
    const tp = (parseFloat(k[2])+parseFloat(k[3])+parseFloat(k[4]))/3;
    cTPV += tp * parseFloat(k[5]); cVol += parseFloat(k[5]);
  }
  return cVol === 0 ? 0 : cTPV / cVol;
}

function calcVolume(klines) {
  const volumes = klines.map(k => parseFloat(k[5]));
  const avg = volumes.slice(-20).reduce((a,b) => a+b, 0) / 20;
  return { current: volumes[volumes.length-1], avg, ratio: parseFloat((volumes[volumes.length-1]/avg).toFixed(2)) };
}

function calcSupportResistance(klines) {
  const slice = klines.slice(-60);
  const highs = slice.map(k => parseFloat(k[2]));
  const lows = slice.map(k => parseFloat(k[3]));
  const closes = slice.map(k => parseFloat(k[4]));
  const price = closes[closes.length-1];
  const pivots = [];
  for (let i = 2; i < slice.length-2; i++) {
    if (highs[i] > highs[i-1] && highs[i] > highs[i-2] && highs[i] > highs[i+1] && highs[i] > highs[i+2])
      pivots.push({ type: 'R', price: highs[i] });
    if (lows[i] < lows[i-1] && lows[i] < lows[i-2] && lows[i] < lows[i+1] && lows[i] < lows[i+2])
      pivots.push({ type: 'S', price: lows[i] });
  }
  const resistances = pivots.filter(p => p.type==='R' && p.price > price).map(p => p.price).sort((a,b)=>a-b);
  const supports = pivots.filter(p => p.type==='S' && p.price < price).map(p => p.price).sort((a,b)=>b-a);
  return {
    r1: resistances[0] || price*1.02,
    r2: resistances[1] || price*1.04,
    s1: supports[0] || price*0.98,
    s2: supports[1] || price*0.96,
  };
}
// ============================================================
// Market Structure - كشف HH/HL أو LL/LH
// ============================================================
function calcMarketStructure(klines) {
  const slice = klines.slice(-20);
  const highs = slice.map(k => parseFloat(k[2]));
  const lows = slice.map(k => parseFloat(k[3]));

  const recentHighs = highs.slice(-5);
  const recentLows = lows.slice(-5);

  const hhhl = recentHighs[4] > recentHighs[2] && recentLows[4] > recentLows[2];
  const lllh = recentHighs[4] < recentHighs[2] && recentLows[4] < recentLows[2];

  if (hhhl) return { structure: 'صاعد', label: 'HH/HL ✅' };
  if (lllh) return { structure: 'هابط', label: 'LL/LH ✅' };
  return { structure: 'محايد', label: 'Range ⚠️' };
}

// ============================================================
// اتجاه فريم معين
// ============================================================
function getFrameDirection(klines) {
  const closes = klines.map(k => parseFloat(k[4]));
  const price = closes[closes.length-1];
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const macd = calcMACD(closes);
  if (price > ema20 && price > ema50 && macd.macd > 0) return 'صاعد';
  if (price < ema20 && price < ema50 && macd.macd < 0) return 'هابط';
  return 'محايد';
}

// ============================================================
// نظام التقييم الاحترافي من 100
// ============================================================
function calculateScore(data) {
  const {
    price, ema200, vwap, rsi, stochRsi, macdData, adx,
    volume, supertrend, sr, marketStructure, dir1h, dir4h, atr
  } = data;

  let score = 0;
  let rejectReasons = [];
  const breakdown = {};

  // تحديد الاتجاه المقترح
  const bullish = price > ema200 && price > vwap;
  const bearish = price < ema200 && price < vwap;
  const direction = bullish ? 'Long' : bearish ? 'Short' : null;

  // ============================================================
  // قواعد الرفض الفوري
  // ============================================================
  if (!direction) {
    rejectReasons.push('❌ السعر بين EMA200 و VWAP — اتجاه غير واضح');
    return { score: 0, direction: null, rejectReasons, breakdown };
  }

  if (adx.adx < 18) {
    rejectReasons.push(`❌ ADX=${adx.adx} أقل من 18 — السوق Range`);
    return { score: 0, direction, rejectReasons, breakdown };
  }

  if (dir1h !== dir4h) {
    rejectReasons.push(`❌ الفريمات غير متوافقة — 1H: ${dir1h} / 4H: ${dir4h}`);
    return { score: 0, direction, rejectReasons, breakdown };
  }

  if (marketStructure.structure === 'محايد') {
    rejectReasons.push('❌ Market Structure غير واضح — Range ضيق');
    return { score: 0, direction, rejectReasons, breakdown };
  }

  // RSI للـ Long لازم 55-68، للـ Short لازم 32-45
  const rsiOk = direction === 'Long' ? (rsi >= 55 && rsi <= 68) : (rsi >= 32 && rsi <= 45);
  if (!rsiOk) {
    rejectReasons.push(`❌ RSI=${rsi.toFixed(1)} خارج النطاق المثالي (Long: 55-68 / Short: 32-45)`);
    return { score: 0, direction, rejectReasons, breakdown };
  }

  // ============================================================
  // حساب النقاط
  // ============================================================

  // 1. الاتجاه العام (20 نقطة)
  let trendScore = 0;
  if (direction === 'Long') {
    if (price > ema200) trendScore += 8;
    if (price > vwap) trendScore += 6;
    if (supertrend === 'صاعد') trendScore += 6;
  } else {
    if (price < ema200) trendScore += 8;
    if (price < vwap) trendScore += 6;
    if (supertrend === 'هابط') trendScore += 6;
  }
  breakdown.trend = trendScore;
  score += trendScore;

  // 2. توافق الفريمات (15 نقطة)
  let alignScore = 0;
  if (dir1h === dir4h) alignScore += 10;
  if (dir1h === direction) alignScore += 5;
  breakdown.alignment = alignScore;
  score += alignScore;

  // 3. ADX (10 نقاط)
  let adxScore = 0;
  if (adx.adx >= 30) adxScore = 10;
  else if (adx.adx >= 25) adxScore = 8;
  else if (adx.adx >= 20) adxScore = 6;
  else if (adx.adx >= 18) adxScore = 4;
  breakdown.adx = adxScore;
  score += adxScore;

  // 4. الحجم (10 نقاط)
  let volScore = 0;
  if (volume.ratio >= 2.0) volScore = 10;
  else if (volume.ratio >= 1.5) volScore = 8;
  else if (volume.ratio >= 1.2) volScore = 6;
  else if (volume.ratio >= 1.0) volScore = 3;
  if (volume.ratio < 1.2) rejectReasons.push(`⚠️ الحجم منخفض: x${volume.ratio}`);
  breakdown.volume = volScore;
  score += volScore;

  // 5. MACD + Histogram (10 نقاط)
  let macdScore = 0;
  if (direction === 'Long') {
    if (macdData.macd > 0) macdScore += 5;
    if (macdData.histogram > 0) macdScore += 5;
  } else {
    if (macdData.macd < 0) macdScore += 5;
    if (macdData.histogram < 0) macdScore += 5;
  }
  breakdown.macd = macdScore;
  score += macdScore;

  // 6. RSI (10 نقاط)
  let rsiScore = 0;
  if (direction === 'Long') {
    if (rsi >= 60 && rsi <= 65) rsiScore = 10;
    else if (rsi >= 55 && rsi <= 68) rsiScore = 7;
  } else {
    if (rsi >= 35 && rsi <= 40) rsiScore = 10;
    else if (rsi >= 32 && rsi <= 45) rsiScore = 7;
  }
  // StochRSI ضد الاتجاه = خصم
  const stochAgainst = direction === 'Long' ? stochRsi < 30 : stochRsi > 70;
  if (stochAgainst) {
    rsiScore = Math.max(0, rsiScore - 3);
    rejectReasons.push(`⚠️ StochRSI=${stochRsi.toFixed(1)} ضد الاتجاه`);
    if (adx.adx < 22) {
      rejectReasons.push('❌ StochRSI ضد الاتجاه مع ADX ضعيف — رفض');
      return { score: 0, direction, rejectReasons, breakdown };
    }
  }
  breakdown.rsi = rsiScore;
  score += rsiScore;

  // 7. Market Structure (10 نقاط)
  let msScore = 0;
  if (direction === 'Long' && marketStructure.structure === 'صاعد') msScore = 10;
  else if (direction === 'Short' && marketStructure.structure === 'هابط') msScore = 10;
  else msScore = 3;
  breakdown.marketStructure = msScore;
  score += msScore;

  // 8. الدعم/المقاومة (5 نقاط)
  let srScore = 5;
  const atrDistance = atr * 0.3; // مسافة "قريب جداً"
  if (direction === 'Long') {
    if (sr.r1 - price < atrDistance) {
      srScore = 0;
      rejectReasons.push(`❌ مقاومة قريبة جداً: ${sr.r1.toFixed(4)} (فرق ${(sr.r1-price).toFixed(4)})`);
    }
  } else {
    if (price - sr.s1 < atrDistance) {
      srScore = 0;
      rejectReasons.push(`❌ دعم قريب جداً: ${sr.s1.toFixed(4)} (فرق ${(price-sr.s1).toFixed(4)})`);
    }
  }
  breakdown.supportResistance = srScore;
  score += srScore;

  // 9. Risk/Reward (10 نقاط)
  const entry = price;
  const target = direction === 'Long' ? sr.r1 : sr.s1;
  const stopLoss = direction === 'Long'
    ? Math.max(sr.s1, price - atr * 1.5)
    : Math.min(sr.r1, price + atr * 1.5);
  const rrRaw = Math.abs(target - entry) / Math.abs(entry - stopLoss);
  const rr = parseFloat(rrRaw.toFixed(2));

  let rrScore = 0;
  if (rr >= 3.0) rrScore = 10;
  else if (rr >= 2.5) rrScore = 9;
  else if (rr >= 2.0) rrScore = 8;
  else if (rr >= 1.5) rrScore = 6;
  else {
    rrScore = 0;
    rejectReasons.push(`❌ R:R=${rr} أقل من 1:1.5 — رفض`);
    return { score: 0, direction, rejectReasons, breakdown, entry, target, stopLoss, rr };
  }
  breakdown.riskReward = rrScore;
  score += rrScore;

  return { score, direction, rejectReasons, breakdown, entry, target, stopLoss, rr };
}

// ============================================================
// تحليل عملة واحدة
// ============================================================
async function analyzeSymbol(symbol) {
  try {
    const [klines1h, klines4h] = await Promise.all([
      getKlines(symbol, '1h', 200),
      getKlines(symbol, '4h', 200),
    ]);

    if (!klines1h || klines1h.length < 60) return null;

    const closes = klines1h.map(k => parseFloat(k[4]));
    const price = closes[closes.length-1];

    const ema200 = closes.length >= 200 ? calcEMA(closes, 200) : calcEMA(closes, closes.length);
    const vwap = calcVWAP(klines1h);
    const rsi = calcRSI(closes);
    const stochRsi = calcStochRSI(closes);
    const macdData = calcMACD(closes);
    const adx = calcADX(klines1h);
    const atr = calcATR(klines1h);
    const volume = calcVolume(klines1h);
    const supertrend = calcSupertrend(klines1h);
    const sr = calcSupportResistance(klines1h);
    const marketStructure = calcMarketStructure(klines1h);
    const dir1h = getFrameDirection(klines1h);
    const dir4h = getFrameDirection(klines4h);

    const result = calculateScore({
      price, ema200, vwap, rsi, stochRsi, macdData, adx,
      volume, supertrend, sr, marketStructure, dir1h, dir4h, atr
    });

    console.log(`${symbol} | Score=${result.score}/100 | Dir=${result.direction} | ADX=${adx.adx} | RSI=${rsi.toFixed(1)} | 1H=${dir1h} | 4H=${dir4h} | RR=${result.rr}`);

    return {
      symbol, price, ema200, vwap, rsi, stochRsi, macdData,
      adx, volume, supertrend, sr, marketStructure,
      dir1h, dir4h, atr,
      ...result,
      timestamp: new Date().toISOString()
    };
  } catch (e) {
    console.log(`${symbol} | خطأ: ${e.message}`);
    return null;
  }
}

// ============================================================
// تقييم الإشارة
// ============================================================
function getGrade(score) {
  if (score >= 90) return { label: '🔥 قوي جداً', emoji: '🔥' };
  if (score >= 80) return { label: '🟢 قوي', emoji: '🟢' };
  if (score >= 65) return { label: '🟡 عادي', emoji: '🟡' };
  return { label: '🔴 مرفوض', emoji: '🔴' };
}

// ============================================================
// تنسيق الإشارة
// ============================================================
function formatSignal(r) {
  if (r.score === 0 || !r.direction) {
    return (
      `❌ *${r.symbol} — مرفوض*\n\n` +
      `*أسباب الرفض:*\n` +
      r.rejectReasons.map(x => `${x}`).join('\n')
    );
  }

  const grade = getGrade(r.score);
  const dirEmoji = r.direction === 'Long' ? '📈' : '📉';
  const rrStr = `1:${r.rr}`;

  return (
    `${grade.emoji} *${r.symbol} — ${r.direction} ${dirEmoji}*\n\n` +
    `💰 السعر: \`${r.price.toFixed(4)}\`\n` +
    `🎯 التقييم: *${grade.label}* (${r.score}/100)\n\n` +

    `📋 *تفاصيل النقاط:*\n` +
    `• الاتجاه العام: ${r.breakdown.trend}/20\n` +
    `• توافق الفريمات: ${r.breakdown.alignment}/15\n` +
    `• ADX: ${r.breakdown.adx}/10 (${r.adx.adx})\n` +
    `• الحجم: ${r.breakdown.volume}/10 (x${r.volume.ratio})\n` +
    `• MACD/Histogram: ${r.breakdown.macd}/10\n` +
    `• RSI: ${r.breakdown.rsi}/10 (${r.rsi.toFixed(1)})\n` +
    `• Market Structure: ${r.breakdown.marketStructure}/10 (${r.marketStructure.label})\n` +
    `• الدعم/المقاومة: ${r.breakdown.supportResistance}/5\n` +
    `• Risk/Reward: ${r.breakdown.riskReward}/10\n\n` +

    `🕐 *الفريمات:*\n` +
    `• 1H: ${r.dir1h === 'صاعد' ? '✅' : '❌'} ${r.dir1h}\n` +
    `• 4H: ${r.dir4h === 'صاعد' ? '✅' : '❌'} ${r.dir4h}\n\n` +

    `🏗️ *الدعم والمقاومة:*\n` +
    `• مقاومة 1: \`${r.sr.r1.toFixed(4)}\`\n` +
    `• السعر: \`${r.price.toFixed(4)}\`\n` +
    `• دعم 1: \`${r.sr.s1.toFixed(4)}\`\n\n` +

    `📊 *الصفقة:*\n` +
    `• الدخول: \`${r.entry.toFixed(4)}\`\n` +
    `• الهدف: \`${r.target.toFixed(4)}\`\n` +
    `• وقف الخسارة: \`${r.stopLoss.toFixed(4)}\`\n` +
    `• R:R = ${rrStr}\n\n` +

    (r.rejectReasons.length > 0 ? `⚠️ *تحذيرات:*\n${r.rejectReasons.join('\n')}\n\n` : '') +
    `⚠️ للأغراض التعليمية فقط`
  );
}

// ============================================================
// قائمة العملات
// ============================================================
const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
  'MATICUSDT', 'LTCUSDT', 'ATOMUSDT', 'NEARUSDT', 'OPUSDT',
  'ARBUSDT', 'APTUSDT', 'INJUSDT', 'SUIUSDT', 'TIAUSDT'
];

// ============================================================
// مسح السوق
// ============================================================
async function scanMarket() {
  console.log('=== بدء المسح الاحترافي ===');
  const results = [];
  for (const symbol of SYMBOLS) {
    const r = await analyzeSymbol(symbol);
    if (r && r.score >= 65) results.push(r);
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

// ============================================================
// التحقق من المستخدم
// ============================================================
function isAllowed(chatId) {
  return ALLOWED_USERS.includes(chatId.toString());
}

// ============================================================
// أوامر البوت
// ============================================================
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) { bot.sendMessage(chatId, '🚫 البوت خاص.'); return; }
  bot.sendMessage(chatId,
    '👋 أهلاً! النسخة الاحترافية v4\n\n' +
    '🎯 نظام تقييم من 100 نقطة\n' +
    '✅ 12 شرط للفلترة\n' +
    '📊 رفض فوري للإشارات الضعيفة\n\n' +
    'اختار من القائمة 👇',
    getMainMenu()
  );
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!isAllowed(chatId)) { bot.sendMessage(chatId, '🚫 البوت خاص.'); return; }
  if (!text) return;

  if (text === '🔍 مسح السوق' || text === '🚀 أفضل الفرص') {
    await bot.sendMessage(chatId, '⏳ جاري المسح الاحترافي... (2-3 دقائق)');
    const results = await scanMarket();

    if (results.length === 0) {
      await bot.sendMessage(chatId,
        '📊 *لا توجد إشارات تجاوزت 65 نقطة الآن*\n\n' +
        'السوق في حالة Range أو الشروط غير مكتملة.\n' +
        'انتظر فرصة أفضل. ⏳',
        { parse_mode: 'Markdown', ...getMainMenu() }
      );
      return;
    }

    for (const r of results.slice(0, 3)) {
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
      '📖 *النسخة الاحترافية v4*\n\n' +
      '*نظام التقييم (100 نقطة):*\n' +
      '• الاتجاه العام: 20\n' +
      '• توافق الفريمات: 15\n' +
      '• ADX: 10\n' +
      '• الحجم: 10\n' +
      '• MACD/Histogram: 10\n' +
      '• RSI: 10\n' +
      '• Market Structure: 10\n' +
      '• الدعم/المقاومة: 5\n' +
      '• Risk/Reward: 10\n\n' +
      '*قرار الإرسال:*\n' +
      '🔥 90+ = قوي جداً\n' +
      '🟢 80-89 = قوي\n' +
      '🟡 65-79 = عادي\n' +
      '🔴 أقل من 65 = مرفوض\n\n' +
      '*شروط الرفض الفوري:*\n' +
      '• ADX أقل من 18\n' +
      '• R:R أقل من 1:1.5\n' +
      '• الفريمات غير متوافقة\n' +
      '• RSI خارج النطاق\n' +
      '• Market Structure غير واضح\n\n' +
      '⚠️ للأغراض التعليمية فقط',
      { parse_mode: 'Markdown', ...getMainMenu() }
    );
    return;
  }

  if (/^[a-zA-Z]{2,10}$/.test(text)) {
    const symbol = text.toUpperCase().replace('USDT', '') + 'USDT';
    await bot.sendMessage(chatId, `⏳ جاري التحليل الاحترافي لـ ${symbol}...`);
    const result = await analyzeSymbol(symbol);
    if (!result) {
      await bot.sendMessage(chatId, '❌ مش لاقي العملة دي أو في خطأ', getMainMenu());
      return;
    }
    await bot.sendMessage(chatId, formatSignal(result), { parse_mode: 'Markdown', ...getMainMenu() });
  }
});

bot.on('polling_error', (error) => console.error('خطأ:', error.message));

