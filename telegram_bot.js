const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

const BOT_TOKEN = '8780661149:AAHrPfSfJpS18RVoXZ5b4Vj9mtFJ8kgRRGQ';
const ADMIN_CHAT_ID = '5941806593';
const BINANCE_API_KEY = 'UM0u4I8GqfDefQDsLyITTNDLbVgqQyD1MHbe2DasvEXYerK5UIILC7SIqku22jgN';
const BINANCE_SECRET = 'dMdPuyQSLJOS2eZfRqVpTtDhUDhtjw4TyCFAjbvKvGVG5TiC5bCuEkqGjcaafzNN';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('بوت التداول شغال!');

// جلب السعر والبيانات من Binance
async function getKlines(symbol, interval = '1h', limit = 50) {
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

// حساب RSI
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
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// حساب MACD
function calcMACD(closes) {
  const ema = (data, period) => {
    const k = 2 / (period + 1);
    let emaVal = data[0];
    for (let i = 1; i < data.length; i++) emaVal = data[i] * k + emaVal * (1 - k);
    return emaVal;
  };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  return ema12 - ema26;
}

// حساب Bollinger Bands
function calcBollinger(closes, period = 20) {
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period);
  return { upper: mean + 2 * std, middle: mean, lower: mean - 2 * std };
}

// تحليل عملة واحدة
async function analyzeSymbol(symbol) {
  try {
    const klines = await getKlines(symbol);
    const closes = klines.map(k => parseFloat(k[4]));
    const currentPrice = closes[closes.length - 1];

    const rsi = calcRSI(closes);
    const macd = calcMACD(closes);
    const bb = calcBollinger(closes);

    const score = (rsi > 50 ? 1 : 0) + (macd > 0 ? 1 : 0) + (currentPrice > bb.middle ? 1 : 0);

    return { symbol, price: currentPrice, rsi: rsi.toFixed(1), macd: macd.toFixed(4), bb, score };
  } catch (e) {
    return null;
  }
}

// مسح أفضل العملات
async function scanMarket() {
  const symbols = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
    'MATICUSDT', 'LTCUSDT', 'ATOMUSDT', 'NEARUSDT', 'OPUSDT',
    'ARBUSDT', 'APTUSDT', 'INJUSDT', 'SUIUSDT', 'TIAUSDT'
  ];

  const results = [];
  for (const symbol of symbols) {
    const analysis = await analyzeSymbol(symbol);
    if (analysis && analysis.score >= 2) results.push(analysis);
  }

  return results.sort((a, b) => b.score - a.score);
}

// القائمة الرئيسية
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

// /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (chatId.toString() !== ADMIN_CHAT_ID) {
    bot.sendMessage(chatId, '⛔ البوت خاص.');
    return;
  }
  bot.sendMessage(chatId, '👑 أهلاً!\n\nبوت التداول الشخصي جاهز 🚀\n\nاختار من القائمة:', getMainMenu());
});

// الرسائل
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

    let msg2 = `📊 *أفضل الفرص دلوقتي:*\n\n`;
    for (const r of results.slice(0, 5)) {
      const signal = r.score === 3 ? '🟢 قوي' : '🟡 متوسط';
      msg2 += `*${r.symbol}*\n`;
      msg2 += `💰 السعر: ${r.price}\n`;
      msg2 += `📈 RSI: ${r.rsi}\n`;
      msg2 += `📉 MACD: ${r.macd > 0 ? '✅ صاعد' : '❌ هابط'}\n`;
      msg2 += `📊 Bollinger: ${parseFloat(r.price) > r.bb.middle ? '✅ فوق المتوسط' : '❌ تحت المتوسط'}\n`;
      msg2 += `${signal}\n\n`;
    }
    msg2 += `⚠️ للأغراض التعليمية فقط.`;
    bot.sendMessage(chatId, msg2, { parse_mode: 'Markdown', ...getMainMenu() });
    return;
  }

  if (text === '📊 تحليل عملة') {
    bot.sendMessage(chatId, '📊 اكتب اسم العملة:\n\nمثال: BTC أو ETH أو SOL');
    return;
  }

  if (text === 'ℹ️ مساعدة') {
    bot.sendMessage(chatId,
      '📖 *كيفية الاستخدام:*\n\n' +
      '🔍 *مسح السوق* — يفحص 20 عملة ويجيبلك أفضل الفرص\n' +
      '📊 *تحليل عملة* — تكتب اسم العملة وهو يحللها\n' +
      '⭐ *Spot* — فرص للسبوت\n' +
      '🚀 *Futures* — فرص للفيوتشرز\n\n' +
      '⚠️ للأغراض التعليمية فقط.',
      { parse_mode: 'Markdown', ...getMainMenu() }
    );
    return;
  }

  // تحليل عملة محددة
  const symbol = text.toUpperCase().replace('/', '') + (text.toUpperCase().includes('USDT') ? '' : 'USDT');
  bot.sendMessage(chatId, `⏳ جاري تحليل ${symbol}...`);
  const result = await analyzeSymbol(symbol);

  if (!result) {
    bot.sendMessage(chatId, '❌ مش لاقي العملة دي. تأكد من الاسم.', getMainMenu());
    return;
  }

  const signal = result.score === 3 ? '🟢 دخول قوي' : result.score === 2 ? '🟡 دخول محتمل' : '🔴 مش وقت الدخول';

  const response =
    `📊 *تحليل ${result.symbol}*\n\n` +
    `💰 السعر: ${result.price}\n` +
    `📈 RSI: ${result.rsi} ${result.rsi > 50 ? '✅' : '❌'}\n` +
    `📉 MACD: ${result.macd > 0 ? '✅ صاعد' : '❌ هابط'}\n` +
    `📊 Bollinger: ${result.price > result.bb.middle ? '✅ فوق المتوسط' : '❌ تحت المتوسط'}\n\n` +
    `${signal}\n\n` +
    `⚠️ للأغراض التعليمية فقط.`;

  bot.sendMessage(chatId, response, { parse_mode: 'Markdown', ...getMainMenu() });
});

bot.on('polling_error', (error) => console.error('خطأ:', error.message));
