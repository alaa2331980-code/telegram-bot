const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

const BOT_TOKEN = '8780661149:AAHrPfSfJpS18RVoXZ5b4Vj9mtFJ8kgRRGQ';
const ADMIN_CHAT_ID = '5941806593';
const BINANCE_API_KEY = process.env.BINANCE_API_KEY || '';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('البوت شغال!');

// ============================================================
// دالة جلب بيانات Futures من fapi.binance.com
// ============================================================
async function getKlines(symbol, interval = '1h', limit = 100) {
  return new Promise((resolve, reject) => {
    const path = `/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const options = {
      hostname: 'fapi.binance.com',
      path,
      method: 'GET',
      headers: { 'X-MBX-APIKEY': BINANCE_API_KEY },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ============================================================
// المؤشرات
// ============================================================
function calcEMA(closes, period = 14) {
  const k = 2 / (period + 1);
  let val = closes[0];
  for (let i = 1; i < closes.length; i++) val = closes[i] * k + val * (1 - k);
  return val;
}

function calcRSI(closes, period = 14) {
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function calcStochRSI(closes, period = 14) {
  const rsiValues = [];
  for (let i = period; i < closes.length; i++) {
    rsiValues.push(calcRSI(closes.slice(i - period, i + 1)));
  }
  const recent = rsiValues.slice(-period);
  const minRSI = Math.min(...recent);
  const maxRSI = Math.max(...recent);
  if (maxRSI === minRSI) return 50;
  return ((rsiValues[rsiValues.length - 1] - minRSI) / (maxRSI - minRSI)) * 100;
}

function calcMACD(closes) {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine = ema12 - ema26;
  const signalLine = calcEMA(closes.slice(-9).map((_, i) =>
    calcEMA(closes.slice(0, closes.length - 9 + i + 1), 12) -
    calcEMA(closes.slice(0, closes.length - 9 + i + 1), 26)), 9);
  return { macd: macdLine, signal: signalLine, histogram: macdLine - signalLine };
}

function calcBollinger(closes, period = 20) {
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period);
  return { upper: mean + 2 * std, middle: mean, lower: mean - 2 * std };
}

function calcATR(klines, period = 14) {
  const trs = [];
  for (let i = 1; i < klines.length; i++) {
    const high = parseFloat(klines[i][2]);
    const low = parseFloat(klines[i][3]);
    const prevClose = parseFloat(klines[i - 1][4]);
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ============================================================
// Supertrend حقيقي مبني على ATR واتجاه سابق
// ============================================================
function calcSupertrend(klines, period = 14, multiplier = 3) {
  if (klines.length < period + 1) return 'غير محدد';

  const highs = klines.map(k => parseFloat(k[2]));
  const lows = klines.map(k => parseFloat(k[3]));
  const closes = klines.map(k => parseFloat(k[4]));

  // حساب ATR لكل شمعة
  const trs = [0];
  for (let i = 1; i < klines.length; i++) {
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
  }

  // ATR متحرك
  const atrArr = new Array(klines.length).fill(0);
  for (let i = period; i < klines.length; i++) {
    atrArr[i] = trs.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
  }

  // حساب الـ bands والـ supertrend
  let supertrend = new Array(klines.length).fill(0);
  let direction = new Array(klines.length).fill(1); // 1 = صاعد, -1 = هابط
  let upperBand = new Array(klines.length).fill(0);
  let lowerBand = new Array(klines.length).fill(0);

  for (let i = period; i < klines.length; i++) {
    const hl2 = (highs[i] + lows[i]) / 2;
    upperBand[i] = hl2 + multiplier * atrArr[i];
    lowerBand[i] = hl2 - multiplier * atrArr[i];

    if (i === period) {
      direction[i] = closes[i] > lowerBand[i] ? 1 : -1;
      supertrend[i] = direction[i] === 1 ? lowerBand[i] : upperBand[i];
      continue;
    }

    // تعديل الـ bands بناءً على القيمة السابقة
    lowerBand[i] = lowerBand[i] > lowerBand[i - 1] || closes[i - 1] < lowerBand[i - 1]
      ? lowerBand[i] : lowerBand[i - 1];
    upperBand[i] = upperBand[i] < upperBand[i - 1] || closes[i - 1] > upperBand[i - 1]
      ? upperBand[i] : upperBand[i - 1];

    // تحديد الاتجاه
    if (direction[i - 1] === -1 && closes[i] > upperBand[i]) {
      direction[i] = 1;
    } else if (direction[i - 1] === 1 && closes[i] < lowerBand[i]) {
      direction[i] = -1;
    } else {
      direction[i] = direction[i - 1];
    }

    supertrend[i] = direction[i] === 1 ? lowerBand[i] : upperBand[i];
  }

  return direction[direction.length - 1] === 1 ? 'صاعد' : 'هابط';
}

function calcVolume(klines) {
  const volumes = klines.map(k => parseFloat(k[5]));
  const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const currentVolume = volumes[volumes.length - 1];
  return { current: currentVolume, avg: avgVolume, ratio: (currentVolume / avgVolume).toFixed(2) };
}

// ============================================================
// تحديد اتجاه 4H
// ============================================================
async function getTrend4H(symbol) {
  try {
    const klines4h = await getKlines(symbol, '4h', 100);
    const closes4h = klines4h.map(k => parseFloat(k[4]));
    const macd4h = calcMACD(closes4h);
    const rsi4h = calcRSI(closes4h);
    const ema21_4h = calcEMA(closes4h, 21);
    const currentPrice4h = closes4h[closes4h.length - 1];

    if (currentPrice4h > ema21_4h && macd4h.macd > 0 && rsi4h > 50) return 'صاعد';
    if (currentPrice4h < ema21_4h && macd4h.macd < 0 && rsi4h < 50) return 'هابط';
    return 'محايد';
  } catch (e) {
    return 'غير محدد';
  }
}

// ============================================================
// تحليل عملة واحدة
// ============================================================
async function analyzeSymbol(symbol) {
  try {
    const klines = await getKlines(symbol, '1h', 100);
    const closes = klines.map(k => parseFloat(k[4]));
    const currentPrice = closes[closes.length - 1];

    const rsi = calcRSI(closes);
    const stochRsi = calcStochRSI(closes);
    const macdData = calcMACD(closes);
    const bb = calcBollinger(closes);
    const atr = calcATR(klines);
    const supertrend = calcSupertrend(klines);
    const volume = calcVolume(klines);
    const ema9 = calcEMA(closes, 9);
    const ema21 = calcEMA(closes, 21);
    const ema50 = calcEMA(closes, 50);

    // اتجاه 4H
    const trend4H = await getTrend4H(symbol);

    const stopLoss = currentPrice - (atr * 1.5);
    const target = currentPrice + (atr * 3);
    const riskReward = ((target - currentPrice) / (currentPrice - stopLoss)).toFixed(1);

    // حساب النقاط
    let score = 0;
    if (rsi > 50 && rsi < 70) score++;
    if (stochRsi > 50) score++;
    if (macdData.macd > 0) score++;
    if (macdData.histogram > 0) score++;
    if (currentPrice > bb.middle) score++;
    if (supertrend === 'صاعد') score++;
    if (volume.ratio > 1.0) score++;   // تعديل: من 1.2 إلى 1.0
    if (currentPrice > ema9 && currentPrice > ema21) score++;

    // Debug log
    const macdLabel = macdData.macd > 0 ? 'Bullish' : 'Bearish';
    console.log(`${symbol} | Score=${score} | RSI=${rsi.toFixed(1)} | MACD=${macdLabel} | Vol=${volume.ratio} | 4H=${trend4H}`);

    // فلتر الاتجاه 4H: Long فقط لو صاعد، Short لو هابط
    let signal = 'Long 📈';
    if (trend4H === 'هابط') signal = 'Short 📉';
    else if (trend4H === 'محايد') signal = 'انتظار ⏳';

    return {
      symbol,
      score,
      rsi,
      stochRsi,
      macdData,
      bb,
      supertrend,
      volume,
      atr,
      ema9,
      ema21,
      ema50,
      stopLoss,
      target,
      riskReward,
      price: currentPrice,
      signal,
      trend4H,
    };
  } catch (e) {
    return null;
  }
}

// ============================================================
// تصنيف الفرصة
// ============================================================
function getOpportunityLabel(score) {
  if (score >= 7) return '🟢 فرصة قوية';
  if (score >= 5) return '🟡 فرصة جيدة';
  if (score >= 3) return '🔵 فرصة مراقبة';
  return null;
}

// ============================================================
// مسح السوق
// ============================================================
async function scanMarket() {
  const symbols = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
    'MATICUSDT', 'LTCUSDT', 'ATOMUSDT', 'NEARUSDT', 'OPUSDT',
    'ARBUSDT', 'APTUSDT', 'INJUSDT', 'SUIUSDT', 'TIAUSDT'
  ];

  console.log('=== بدء مسح السوق ===');
  const results = [];
  for (const symbol of symbols) {
    const r = await analyzeSymbol(symbol);
    if (r && r.score >= 3) {  // تعديل: من 4 إلى 3
      results.push(r);
    }
  }
  console.log(`=== انتهى المسح: ${results.length} فرصة ===`);
  return results.sort((a, b) => b.score - a.score);
}

// ============================================================
// تنسيق التحليل
// ============================================================
function formatAnalysis(r) {
  const label = getOpportunityLabel(r.score);
  const pct = (n => ((n - r.price) / r.price * 100).toFixed(2))(r.price);

  return (
    `📊 *${r.symbol}*\n\n` +
    `💰 السعر: \`${r.price.toFixed(4)}\`\n` +
    `🎯 ${label || '🔵 فرصة مراقبة'}\n` +
    `📡 اتجاه 4H: *${r.trend4H}*\n` +
    `🚦 الإشارة: *${r.signal}*\n\n` +
    `📈 *المؤشرات:*\n` +
    `• RSI: ${r.rsi.toFixed(1)} ${r.rsi > 50 && r.rsi < 70 ? '✅' : '❌'}\n` +
    `• StochRSI: ${r.stochRsi.toFixed(1)} ${r.stochRsi > 50 ? '✅' : '❌'}\n` +
    `• MACD: ${r.macdData.macd > 0 ? '✅ صاعد' : '❌ هابط'}\n` +
    `• Histogram: ${r.macdData.histogram > 0 ? '✅ موجب' : '❌ سالب'}\n` +
    `• بولينجر: ${r.price > r.bb.middle ? '✅ فوق المتوسط' : '❌ تحت المتوسط'}\n` +
    `• Supertrend: ${r.supertrend === 'صاعد' ? '✅ صاعد' : '❌ هابط'}\n` +
    `• الحجم: ${r.volume.ratio > 1.0 ? '✅' : '❌'} x${r.volume.ratio}\n` +
    `• EMA9: ${r.price > r.ema9 ? '✅ فوق' : '❌ تحت'}\n` +
    `• EMA21: ${r.price > r.ema21 ? '✅ فوق' : '❌ تحت'}\n` +
    `• EMA50: ${r.price > r.ema50 ? '✅ فوق' : '❌ تحت'}\n\n` +
    `*⭐ النتيجة: ${r.score}/8*\n\n` +
    `🎯 الهدف: \`${r.target.toFixed(4)}\`\n` +
    `🔴 وقف الخسارة: \`${r.stopLoss.toFixed(4)}\`\n` +
    `📐 Risk/Reward: ${r.riskReward}:1\n\n` +
    `⚠️ للأغراض التعليمية فقط`
  );
}

// ============================================================
// عرض أفضل 5 عملات عند غياب الفرص
// ============================================================
async function getTop5Summary() {
  const symbols = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
    'MATICUSDT', 'LTCUSDT', 'ATOMUSDT', 'NEARUSDT', 'OPUSDT',
    'ARBUSDT', 'APTUSDT', 'INJUSDT', 'SUIUSDT', 'TIAUSDT'
  ];
  const all = [];
  for (const symbol of symbols) {
    const r = await analyzeSymbol(symbol);
    if (r) all.push(r);
  }
  all.sort((a, b) => b.score - a.score);
  const top5 = all.slice(0, 5);
  let msg = '📊 *لا توجد فرص كافية الآن — أفضل 5 عملات:*\n\n';
  for (const r of top5) {
    msg += `${r.symbol}  Score: ${r.score}/8\n`;
  }
  return msg;
}

// ============================================================
// القائمة الرئيسية
// ============================================================
function getMainMenu() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '🔍 مسح السوق' }, { text: '📊 تحليل العملة' }],
        [{ text: '🚀 Futures فرص' }, { text: '💎 حدد الفرص' }],
        [{ text: 'ℹ️ المساعدة' }],
      ],
      resize_keyboard: true,
    },
  };
}

// ============================================================
// أوامر البوت
// ============================================================
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (chatId.toString() !== ADMIN_CHAT_ID) {
    bot.sendMessage(chatId, '🚫 البوت خاص.');
    return;
  }
  bot.sendMessage(chatId, '👋 أهلاً!\n\nاختار من القائمة 🎮', getMainMenu());
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (chatId.toString() !== ADMIN_CHAT_ID) return;
  if (!text) return;

  // ============================================================
  // مسح السوق العادي
  // ============================================================
  if (text === '🔍 مسح السوق' || text === '💎 حدد الفرص' || text === '🚀 Futures فرص') {
    bot.sendMessage(chatId, '⏳ جاري مسح السوق...');
    const results = await scanMarket();

    if (text === '🚀 Futures فرص') {
      // أفضل 3 فرص فقط
      if (results.length === 0) {
        const top5msg = await getTop5Summary();
        bot.sendMessage(chatId, top5msg, { parse_mode: 'Markdown', ...getMainMenu() });
        return;
      }
      const top3 = results.slice(0, 3);
      for (const r of top3) {
        await bot.sendMessage(chatId, formatAnalysis(r), { parse_mode: 'Markdown' });
      }
      bot.sendMessage(chatId, '✅ انتهى المسح', getMainMenu());
      return;
    }

    if (results.length === 0) {
      const top5msg = await getTop5Summary();
      bot.sendMessage(chatId, top5msg, { parse_mode: 'Markdown', ...getMainMenu() });
      return;
    }

    for (const r of results.slice(0, 3)) {
      await bot.sendMessage(chatId, formatAnalysis(r), { parse_mode: 'Markdown' });
    }
    bot.sendMessage(chatId, '✅ انتهى المسح', getMainMenu());
    return;
  }

  // ============================================================
  // تحليل عملة بالاسم
  // ============================================================
  if (text === '📊 تحليل العملة') {
    bot.sendMessage(chatId, '📊 اكتب اسم العملة:\nمثال: BTC أو ETH أو SOL');
    return;
  }

  if (text === 'ℹ️ المساعدة') {
    bot.sendMessage(chatId,
      '📖 *كيفية الاستخدام:*\n\n' +
      '🔍 *مسح السوق* - يفحص 20 عملة ويعرض الفرص\n' +
      '📊 *تحليل العملة* - يفحص عملة معينة\n' +
      '🚀 *Futures فرص* - أفضل 3 فرص Futures\n\n' +
      '*المؤشرات المستخدمة:*\n' +
      '• RSI • MACD • StochRSI • البولينجر\n' +
      '• Supertrend (حقيقي) • ATR • الحجم\n' +
      '• EMA9/21/50 • اتجاه 4H\n\n' +
      '*تصنيف الفرص:*\n' +
      '🟢 7-8 نقاط = فرصة قوية\n' +
      '🟡 5-6 نقاط = فرصة جيدة\n' +
      '🔵 3-4 نقاط = فرصة مراقبة\n\n' +
      '⚠️ للأغراض التعليمية فقط',
      { parse_mode: 'Markdown', ...getMainMenu() }
    );
    return;
  }

  // تحليل عملة محددة
  const symbol = text.toUpperCase().replace('/', '').replace('USDT', '') + 'USDT';
  if (text.length >= 2 && text.length <= 10 && /^[a-zA-Z]+$/.test(text)) {
    bot.sendMessage(chatId, `⏳ جاري تحليل ${symbol}...`);
    const result = await analyzeSymbol(symbol);
    if (!result) {
      bot.sendMessage(chatId, '❌ مش تلاقي العملة دي', getMainMenu());
      return;
    }
    bot.sendMessage(chatId, formatAnalysis(result), { parse_mode: 'Markdown', ...getMainMenu() });
  }
});

bot.on('polling_error', (error) => console.error('خطأ:', error.message));
