const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

const BOT_TOKEN = '8780661149:AAHrPfSfJpS18RVoXZ5b4Vj9mtFJ8kgRRGQ';
const ADMIN_CHAT_ID = '5941806593';
const BINANCE_API_KEY = 'UM0u4I8GqfDefQDsLyITTNDLbVgqQyD1MHbe2DasvEXYerK5UIILC7SIqku22jgN';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('بوت التداول شغال!');

async function getKlines(symbol, interval = '1h', limit = 100) {
  return new Promise((resolve, reject) => {
    const path = `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const options = {
      hostname: 'api.binance.com',
      path,
      method: 'GET',
      headers: { 'X-MBX-APIKEY': BINANCE_API_KEY }
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
    if (diff > 0) gains += diff;
    else losses -= diff;
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
  const signalLine = calcEMA(closes.slice(-9).map((_, i) => calcEMA(closes.slice(0, closes.length - 9 + i + 1), 12) - calcEMA(closes.slice(0, closes.length - 9 + i + 1), 26)), 9);
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
    const prevClose = parseFloat(klines[i-1][4]);
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcSupertrend(klines, period = 10, multiplier = 3) {
  const closes = klines.map(k => parseFloat(k[4]));
  const highs = klines.map(k => parseFloat(k[2]));
  const lows = klines.map(k => parseFloat(k[3]));
  const atr = calcATR(klines, period);
  const price = closes[closes.length - 1];
  const hl2 = (highs[highs.length - 1] + lows[lows.length - 1]) / 2;
  const upperBand = hl2 + multiplier * atr;
  const lowerBand = hl2 - multiplier * atr;
  return price > lowerBand ? 'صاعد' : 'هابط';
}

function calcVolume(klines) {
  const volumes = klines.map(k => parseFloat(k[5]));
  const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const currentVolume = volumes[volumes.length - 1];
  return { current: currentVolume, avg: avgVolume, ratio: (currentVolume / avgVolume).toFixed(2) };
}

async function analyzeSymbol(symbol) {
  try {
    const klines = await getKlines(symbol);
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
    if (volume.ratio > 1.2) score++;
    if (currentPrice > ema9 && currentPrice > ema21) score++;

    return {
      symbol, price: currentPrice, rsi, stochRsi, macdData,
      bb, atr, supertrend, volume, ema9, ema21, ema50,
      stopLoss, target, riskReward, score
    };
  } catch (e) {
    return null;
  }
}

function formatAnalysis(r) {
  const signal = r.score >= 6 ? '🟢 دخول قوي' : r.score >= 4 ? '🟡 دخول محتمل' : '🔴 انتظر';
  const pct = (n) => ((n - r.price) / r.price * 100).toFixed(2);

  return (
    `📊 *${r.symbol}*\n\n` +
    `💰 السعر: ${r.price.toFixed(4)}\n\n` +
    `📈 *المؤشرات:*\n` +
    `• RSI: ${r.rsi.toFixed(1)} ${r.rsi > 50 && r.rsi < 70 ? '✅' : '❌'}\n` +
    `• StochRSI: ${r.stochRsi.toFixed(1)} ${r.stochRsi > 50 ? '✅' : '❌'}\n` +
    `• MACD: ${r.macdData.macd > 0 ? '✅ صاعد' : '❌ هابط'}\n` +
    `• Histogram: ${r.macdData.histogram > 0 ? '✅ موجب' : '❌ سالب'}\n` +
    `• Bollinger: ${r.price > r.bb.middle ? '✅ فوق المتوسط' : '❌ تحت المتوسط'}\n` +
    `• Supertrend: ${r.supertrend === 'صاعد' ? '✅ صاعد' : '❌ هابط'}\n` +
    `• Volume: ${r.volume.ratio}x ${r.volume.ratio > 1.2 ? '✅ مرتفع' : '❌ منخفض'}\n` +
    `• EMA9: ${r.price > r.ema9 ? '✅ فوق' : '❌ تحت'}\n` +
    `• EMA21: ${r.price > r.ema21 ? '✅ فوق' : '❌ تحت'}\n` +
    `• EMA50: ${r.price > r.ema50 ? '✅ فوق' : '❌ تحت'}\n\n` +
    `*النتيجة: ${r.score}/8*\n` +
    `${signal}\n\n` +
    `🎯 الهدف: ${r.target.toFixed(4)} (+${pct(r.target)}%)\n` +
    `🛑 وقف الخسارة: ${r.stopLoss.toFixed(4)} (${pct(r.stopLoss)}%)\n` +
    `⚖️ نسبة المخاطرة: 1:${r.riskReward}\n\n` +
    `⚠️ للأغراض التعليمية فقط.`
  );
}

async function scanMarket() {
  const symbols = [
    'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
    'ADAUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','LINKUSDT',
    'MATICUSDT','LTCUSDT','ATOMUSDT','NEARUSDT','OPUSDT',
    'ARBUSDT','APTUSDT','INJUSDT','SUIUSDT','TIAUSDT'
  ];
  const results = [];
  for (const symbol of symbols) {
    const r = await analyzeSymbol(symbol);
    if (r && r.score >= 4) results.push(r);
  }
  return results.sort((a, b) => b.score - a.score);
}

function getMainMenu() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '🔍 مسح السوق' }, { text: '📊 تحليل عملة' }],
        [{ text: '⭐ Spot فرص' }, { text: '🚀 Futures فرص' }],
        [{ text: 'ℹ️ مساعدة' }]
      ],
      resize_keyboard: true
    }
  };
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (chatId.toString() !== ADMIN_CHAT_ID) {
    bot.sendMessage(chatId, '⛔ البوت خاص.');
    return;
  }
  bot.sendMessage(chatId, '👑 أهلاً!\n\nبوت التداول الشخصي جاهز 🚀\n\nاختار من القائمة:', getMainMenu());
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (chatId.toString() !== ADMIN_CHAT_ID) return;
  if (!text || text.startsWith('/')) return;

  if (text === '🔍 مسح السوق' || text === '⭐ Spot فرص' || text === '🚀 Futures فرص') {
    bot.sendMessage(chatId, '⏳ جاري مسح السوق، استنى دقيقة...');
    const results = await scanMarket();
    if (results.length === 0) {
      bot.sendMessage(chatId, '😐 مفيش فرص كويسة دلوقتي.', getMainMenu());
      return;
    }
    for (const r of results.slice(0, 3)) {
      await bot.sendMessage(chatId, formatAnalysis(r), { parse_mode: 'Markdown' });
    }
    bot.sendMessage(chatId, '✅ انتهى المسح!', getMainMenu());
    return;
  }

  if (text === '📊 تحليل عملة') {
    bot.sendMessage(chatId, '📊 اكتب اسم العملة:\nمثال: BTC أو ETH أو SOL');
    return;
  }

  if (text === 'ℹ️ مساعدة') {
    bot.sendMessage(chatId,
      '📖 *كيفية الاستخدام:*\n\n' +
      '🔍 *مسح السوق* — يفحص 20 عملة\n' +
      '📊 *تحليل عملة* — تكتب اسم العملة\n\n' +
      '*المؤشرات المستخدمة:*\n' +
      '• RSI + StochRSI\n• MACD + Histogram\n• Bollinger Bands\n• Supertrend\n• Volume\n• EMA 9/21/50\n• ATR\n\n' +
      '⚠️ للأغراض التعليمية فقط.',
      { parse_mode: 'Markdown', ...getMainMenu() }
    );
    return;
  }

  const symbol = text.toUpperCase().replace('/', '').replace('USDT', '') + 'USDT';
  bot.sendMessage(chatId, `⏳ جاري تحليل ${symbol}...`);
  const result = await analyzeSymbol(symbol);

  if (!result) {
    bot.sendMessage(chatId, '❌ مش لاقي العملة دي.', getMainMenu());
    return;
  }

  bot.sendMessage(chatId, formatAnalysis(result), { parse_mode: 'Markdown', ...getMainMenu() });
});

bot.on('polling_error', (error) => console.error('خطأ:', error.message));
