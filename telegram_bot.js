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

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
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

function calcMACD(closes) {
  const ema = (data, period) => {
    const k = 2 / (period + 1);
    let val = data[0];
    for (let i = 1; i < data.length; i++) val = data[i] * k + val * (1 - k);
    return val;
  };
  return ema(closes, 12) - ema(closes, 26);
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

async function analyzeSymbol(symbol) {
  try {
    const klines = await getKlines(symbol);
    const closes = klines.map(k => parseFloat(k[4]));
    const highs = klines.map(k => parseFloat(k[2]));
    const lows = klines.map(k => parseFloat(k[3]));
    const currentPrice = closes[closes.length - 1];

    const rsi = calcRSI(closes);
    const macd = calcMACD(closes);
    const bb = calcBollinger(closes);
    const atr = calcATR(klines);

    // حساب الهدف ووقف الخسارة
    const recentHigh = Math.max(...highs.slice(-20));
    const recentLow = Math.min(...lows.slice(-20));
    const stopLoss = currentPrice - (atr * 1.5);
    const target = currentPrice + (atr * 3);
    const riskReward = ((target - currentPrice) / (currentPrice - stopLoss)).toFixed(1);

    const score = (rsi > 50 ? 1 : 0) + (macd > 0 ? 1 : 0) + (currentPrice > bb.middle ? 1 : 0);

    return {
      symbol, price: currentPrice, rsi: rsi.toFixed(1),
      macd, bb, atr, stopLoss, target, riskReward,
      recentHigh, recentLow, score
    };
  } catch (e) {
    return null;
  }
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
    if (r && r.score >= 2) results.push(r);
  }
  return results.sort((a, b) => b.score - a.score);
}

function formatAnalysis(r) {
  const signal = r.score === 3 ? '🟢 دخول قوي' : r.score === 2 ? '🟡 دخول محتمل' : '🔴 انتظر';
  const pct = (n) => ((n - r.price) / r.price * 100).toFixed(2);

  return (
    `📊 *${r.symbol}*\n\n` +
    `💰 السعر: ${r.price.toFixed(4)}\n` +
    `📈 RSI: ${r.rsi} ${r.rsi > 50 ? '✅' : '❌'}\n` +
    `📉 MACD: ${r.macd > 0 ? '✅ صاعد' : '❌ هابط'}\n` +
    `📊 Bollinger: ${r.price > r.bb.middle ? '✅ فوق المتوسط' : '❌ تحت المتوسط'}\n\n` +
    `${signal}\n\n` +
    `🎯 الهدف: ${r.target.toFixed(4)} (+${pct(r.target)}%)\n` +
    `🛑 وقف الخسارة: ${r.stopLoss.toFixed(4)} (${pct(r.stopLoss)}%)\n` +
    `⚖️ نسبة المخاطرة: 1:${r.riskReward}\n\n` +
    `⚠️ للأغراض التعليمية فقط.`
  );
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
    bot.sendMessage(chatId, '⏳ جاري مسح السوق، استنى...');
    const results = await scanMarket();
    if (results.length === 0) {
      bot.sendMessage(chatId, '😐 مفيش فرص كويسة دلوقتي.', getMainMenu());
      return;
    }
    let response = `📊 *أفضل الفرص دلوقتي:*\n\n`;
    for (const r of results.slice(0, 5)) {
      response += formatAnalysis(r) + '\n\n---\n\n';
    }
    bot.sendMessage(chatId, response, { parse_mode: 'Markdown', ...getMainMenu() });
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
      'البوت بيحسب:\n' +
      '• RSI و MACD و Bollinger\n' +
      '• الهدف ووقف الخسارة تلقائي\n' +
      '• نسبة المخاطرة\n\n' +
      '⚠️ للأغراض التعليمية فقط.',
      { parse_mode: 'Markdown', ...getMainMenu() }
    );
    return;
  }

  // تحليل عملة محددة
  const symbol = text.toUpperCase().replace('/', '').replace('USDT', '') + 'USDT';
  bot.sendMessage(chatId, `⏳ جاري تحليل ${symbol}...`);
  const result = await analyzeSymbol(symbol);

  if (!result) {
    bot.sendMessage(chatId, '❌ مش لاقي العملة دي. تأكد من الاسم.', getMainMenu());
    return;
  }

  bot.sendMessage(chatId, formatAnalysis(result), { parse_mode: 'Markdown', ...getMainMenu() });
});

bot.on('polling_error', (error) => console.error('خطأ:', error.message));
