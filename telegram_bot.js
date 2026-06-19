const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

const BOT_TOKEN = '8780661149:AAHwFEKncDPfJpPcms6SVYodOeHq03Gf2Lc';
const BINANCE_API_KEY = process.env.BINANCE_API_KEY || '';
const ALLOWED_USERS = ['5941806593'];

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const mainKeyboard = {
  reply_markup: {
    keyboard: [
      ['🔍 مسح السوق', '🚀 أفضل الفرص'],
      ['ℹ️ المساعدة']
    ],
    resize_keyboard: true
  }
};

console.log('VIP AI BOT RUNNING');

bot.on('polling_error', (err) => {
  console.log('POLLING ERROR:', err.code, err.message);
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getKlines(symbol, interval = '1h', limit = 300) {
  return new Promise((resolve, reject) => {
    const path = `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const options = {
      hostname: 'api.binance.com',
      path,
      method: 'GET',
      headers: { 'X-MBX-APIKEY': BINANCE_API_KEY },
      timeout: 8000,
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (!Array.isArray(parsed)) {
            reject(new Error('Invalid symbol'));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.on('error', reject);
    req.end();
  });
function calcEMA(closes, period) {
  const k = 2 / (period + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcEMA200(closes) {
  return calcEMA(closes, 200);
}

function calcRSI(closes, period = 14) {
  let gain = 0, loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gain += diff;
    else loss += Math.abs(diff);
  }
  const rs = gain / (loss || 1);
  return 100 - (100 / (1 + rs));
}

function calcMACD(closes) {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  return { macd: ema12 - ema26 };
}

function calcATR(klines, period = 14) {
  const trs = [];
  for (let i = 1; i < klines.length; i++) {
    const h = +klines[i][2];
    const l = +klines[i][3];
    const pc = +klines[i - 1][4];
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcVWAP(klines) {
  let tpv = 0, vol = 0;
  klines.slice(-24).forEach(k => {
    const tp = (+k[2] + +k[3] + +k[4]) / 3;
    tpv += tp * +k[5];
    vol += +k[5];
  });
  return tpv / vol;
}

async function getBTCTrend() {
  const k = await getKlines('BTCUSDT', '1h', 250);
  const closes = k.map(x => +x[4]);
  const price = closes.at(-1);
  const ema = calcEMA200(closes);
  const macd = calcMACD(closes);
  let trend = 'Neutral';
  if (price > ema && macd.macd > 0) trend = 'Bullish';
  if (price < ema && macd.macd < 0) trend = 'Bearish';
  return { trend, price };
  function calcEMA(closes, period) {
  const k = 2 / (period + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcEMA200(closes) {
  return calcEMA(closes, 200);
}

function calcRSI(closes, period = 14) {
  let gain = 0, loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gain += diff;
    else loss += Math.abs(diff);
  }
  const rs = gain / (loss || 1);
  return 100 - (100 / (1 + rs));
}

function calcMACD(closes) {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  return { macd: ema12 - ema26 };
}

function calcATR(klines, period = 14) {
  const trs = [];
  for (let i = 1; i < klines.length; i++) {
    const h = +klines[i][2];
    const l = +klines[i][3];
    const pc = +klines[i - 1][4];
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcVWAP(klines) {
  let tpv = 0, vol = 0;
  klines.slice(-24).forEach(k => {
    const tp = (+k[2] + +k[3] + +k[4]) / 3;
    tpv += tp * +k[5];
    vol += +k[5];
  });
  return tpv / vol;
}

async function getBTCTrend() {
  const k = await getKlines('BTCUSDT', '1h', 250);
  const closes = k.map(x => +x[4]);
  const price = closes.at(-1);
  const ema = calcEMA200(closes);
  const macd = calcMACD(closes);
  let trend = 'Neutral';
  if (price > ema && macd.macd > 0) trend = 'Bullish';
  if (price < ema && macd.macd < 0) trend = 'Bearish';
  return { trend, price };
    }function calcSR(klines) {
  const swingHighs = detectSwingHighs(klines, 3).map(h => h.price);
  const swingLows = detectSwingLows(klines, 3).map(l => l.price);
  const price = +klines.at(-1)[4];
  const resistances = swingHighs.filter(h => h > price).sort((a, b) => a - b);
  const supports = swingLows.filter(l => l < price).sort((a, b) => b - a);
  const r1 = resistances[0] || price * 1.02;
  const s1 = supports[0] || price * 0.98;
  return { r1, s1, price };
}

function calcSmartSL(klines, direction, atr) {
  const swingHighs = detectSwingHighs(klines, 3).map(h => h.price);
  const swingLows = detectSwingLows(klines, 3).map(l => l.price);
  const price = +klines.at(-1)[4];
  if (direction === 'Long') {
    const below = swingLows.filter(l => l < price).sort((a, b) => b - a);
    const structureSL = below[0] || (price - atr);
    return structureSL - atr * 0.3;
  } else {
    const above = swingHighs.filter(h => h > price).sort((a, b) => a - b);
    const structureSL = above[0] || (price + atr);
    return structureSL + atr * 0.3;
  }
}

function calcTargets(direction, entry, sl) {
  const risk = Math.abs(entry - sl);
  if (direction === 'Long') {
    return { tp1: entry + risk * 1, tp2: entry + risk * 2, tp3: entry + risk * 3 };
  } else {
    return { tp1: entry - risk * 1, tp2: entry - risk * 2, tp3: entry - risk * 3 };
  }
}

function getSignalGrade(score) {
  if (score >= 85) return '🟢 ممتازة';
  if (score >= 75) return '🔵 جيدة جداً';
  if (score >= 65) return '🟡 جيدة';
  return '⚪ عادية';
}

async function get4hConfirmation(symbol, direction) {
  try {
    const k = await getKlines(symbol, '4h', 100);
    const closes = k.map(x => +x[4]);
    const price = closes.at(-1);
    const ema = calcEMA(closes, Math.min(50, closes.length - 1));
    const macd = calcMACD(closes);
    if (direction === 'Long') {
      return price > ema && macd.macd > 0;
    } else {
      return price < ema && macd.macd < 0;
    }
  } catch (e) {
    return false;
  }
}

async function analyzeSymbol(symbol, btc) {
  const k = await getKlines(symbol, '1h', 200);
  const closes = k.map(x => +x[4]);
  const price = closes.at(-1);
  const ema = calcEMA200(closes);
  const rsi = calcRSI(closes);
  const macd = calcMACD(closes);
  const atr = calcATR(k);
  const vwap = calcVWAP(k);
  const direction = price > ema ? 'Long' : 'Short';
  const bos = detectBOS(k);
  const liq = detectLiquidity(k);
  const pat = detectPatterns(k);
  const ob = detectOrderBlocks(k, direction);
  const fvg = detectFVG(k, direction);
  let score = 0;
  if (direction === 'Long') {
    if (price > ema) score += 15;
    if (macd.macd > 0) score += 10;
    if (rsi > 50 && rsi < 70) score += 10;
    if (bos.bullish) score += 15;
    if (liq.sweepLow) score += 10;
    if (price > vwap) score += 5;
    if (pat.bullish) score += 5;
    if (ob) score += 15;
    if (fvg) score += 10;
  } else {
    if (price < ema) score += 15;
    if (macd.macd < 0) score += 10;
    if (rsi < 50 && rsi > 30) score += 10;
    if (bos.bearish) score += 15;
    if (liq.sweepHigh) score += 10;
    if (price < vwap) score += 5;
    if (pat.bearish) score += 5;
    if (ob) score += 15;
    if (fvg) score += 10;
  }
  if (btc.trend !== (direction === 'Long' ? 'Bearish' : 'Bullish')) score += 5;
  const confirmed4h = await get4hConfirmation(symbol, direction);
  if (confirmed4h) score += 10;
  const entry = price;
  const sl = calcSmartSL(k, direction, atr);
  const targets = calcTargets(direction, entry, sl);
  return {
    symbol, direction, price, score,
    grade: getSignalGrade(score),
    entry,
    tp1: targets.tp1, tp2: targets.tp2, tp3: targets.tp3,
    sl, hasOB: !!ob, hasFVG: !!fvg, confirmed4h,
    function formatSignal(r) {
  return `
🔥 ${r.symbol} ${r.direction}
${r.grade}

💰 Price: ${r.price}
⭐ Score: ${r.score}/100
✅ تأكيد 4 ساعات: ${r.confirmed4h ? 'نعم' : 'لا'}
📦 Order Block: ${r.hasOB ? 'موجود' : 'لا'}
📊 Fair Value Gap: ${r.hasFVG ? 'موجود' : 'لا'}

🎯 Entry: ${r.entry}
🥇 TP1: ${r.tp1}
🥈 TP2: ${r.tp2}
🥉 TP3: ${r.tp3}
🔴 SL: ${r.sl}

💡 VIP AI SIGNAL
`;
}

const SYMBOLS = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','MATICUSDT','LINKUSDT','LTCUSDT','BCHUSDT','UNIUSDT','ATOMUSDT','XLMUSDT','ETCUSDT','FILUSDT','APTUSDT','ARBUSDT','OPUSDT','NEARUSDT','INJUSDT','SUIUSDT','TIAUSDT','SEIUSDT','RUNEUSDT','FTMUSDT','SANDUSDT','MANAUSDT','AAVEUSDT','ALGOUSDT','EGLDUSDT','EOSUSDT','XTZUSDT','THETAUSDT','AXSUSDT','GALAUSDT','CHZUSDT','ENJUSDT','ZECUSDT','DASHUSDT','KAVAUSDT','MKRUSDT','COMPUSDT','SNXUSDT','YFIUSDT','CRVUSDT','BATUSDT','ZILUSDT','ICXUSDT','ONTUSDT','QTUMUSDT','OMGUSDT','KSMUSDT','WAVESUSDT','RVNUSDT','HOTUSDT','ANKRUSDT','CELRUSDT','IOSTUSDT','STORJUSDT','SKLUSDT','CTSIUSDT','RSRUSDT','OCEANUSDT','BANDUSDT','NKNUSDT','COTIUSDT','GRTUSDT','LRCUSDT','DYDXUSDT','ENSUSDT','IMXUSDT','GMTUSDT','APEUSDT','LDOUSDT','MASKUSDT','CFXUSDT','HOOKUSDT','MAGICUSDT','HIGHUSDT','CTKUSDT','PEOPLEUSDT','ROSEUSDT','DUSKUSDT','FLOWUSDT','ALICEUSDT','TLMUSDT','C98USDT','CLVUSDT','ARPAUSDT','LITUSDT','SFPUSDT','BAKEUSDT','BNXUSDT','RAYUSDT','PERPUSDT','TRUUSDT','CKBUSDT','TWTUSDT','FIDAUSDT','AGIXUSDT','OGNUSDT','REEFUSDT','POLYXUSDT','PHBUSDT','HFTUSDT','GLMRUSDT','LOOMUSDT','BICOUSDT','API3USDT','WOOUSDT','ASTRUSDT','RADUSDT','IDEXUSDT','PONDUSDT','VGXUSDT','MDTUSDT','STMXUSDT','DGBUSDT','SXPUSDT','LSKUSDT','NMRUSDT','MTLUSDT','PAXGUSDT','TOMOUSDT','WANUSDT','FUNUSDT','CVCUSDT','BNTUSDT','RLCUSDT','STPTUSDT','DENTUSDT','WINUSDT','BTTCUSDT','ARDRUSDT','VITEUSDT','CHRUSDT','PERLUSDT','COSUSDT','NULSUSDT','VTHOUSDT','KEYUSDT','MITHUSDT','DREPUSDT','TCTUSDT','WRXUSDT','BURGERUSDT','ALPACAUSDT','SUPERUSDT','XVSUSDT','ALPHAUSDT','AUDIOUSDT','EPSUSDT','DODOUSDT','BELUSDT','PNTUSDT','UNFIUSDT','TKOUSDT','PUNDIXUSDT','VIDTUSDT','GTOUSDT','POAUSDT','QKCUSDT','BTSUSDT','BLZUSDT','IRISUSDT','KMDUSDT','JSTUSDT','SCUSDT','ZENUSDT','SRMUSDT','ANTUSDT','NANOUSDT','ATAUSDT','GTCUSDT','TORNUSDT','KEEPUSDT','ERNUSDT','KLAYUSDT','BONDUSDT','MLNUSDT','QUICKUSDT','FORTHUSDT','TRBUSDT','BSWUSDT','VOXELUSDT','XECUSDT','HIVEUSDT','FRONTUSDT','COMBOUSDT','ACMUSDT','AUCTIONUSDT','PROSUSDT','PYRUSDT','LAZIOUSDT','PORTOUSDT','SANTOSUSDT','ALPINEUSDT','CITYUSDT','OGUSDT','ASRUSDT','JUVUSDT','PSGUSDT','BARUSDT','ATMUSDT','ACAUSDT','ANCUSDT','BOSONUSDT','TVKUSDT','BADGERUSDT','FISUSDT','OMUSDT','DARUSDT','ALCXUSDT','SYSUSDT','XNOUSDT','UFTUSDT','REQUSDT','UMAUSDT','XEMUSDT','RENUSDT','KP3RUSDT','TRIBEUSDT','GHSTUSDT','DIAUSDT','ORNUSDT','UTKUSDT','MBLUSDT','SUNUSDT','MDXUSDT','ZRXUSDT','BALUSDT','GNOUSDT','LPTUSDT','RAREUSDT','VIBUSDT','DCRUSDT','ARKUSDT','MFTUSDT','POLSUSDT','CVPUSDT','EPXUSDT','XYOUSDT','LUNAUSDT','LUNCUSDT','USTCUSDT','ICPUSDT','MOVRUSDT','GLMUSDT','SCRTUSDT','AKROUSDT'];

async function scanMarket() {
  const btc = await getBTCTrend();
  const results = [];
  for (const s of SYMBOLS) {
    try {
      const r = await analyzeSymbol(s, btc);
      if (r.score >= 60) results.push(r);
    } catch (err) {
      console.log('Skip ' + s + ': ' + err.message);
    }
    await sleep(150);
  }
  return results.sort((a, b) => b.score - a.score);
}

process.on('SIGTERM', () => {
  bot.stopPolling();
  process.exit(0);
});

process.on('SIGINT', () => {
  bot.stopPolling();
  process.exit(0);
});

bot.onText(/\/start/, (msg) => {
  const userId = String(msg.from.id);
  console.log('START - USER ID:', userId);
  if (!ALLOWED_USERS.includes(userId)) return;
  bot.sendMessage(msg.chat.id, 'VIP AI Bot Ready 🚀', mainKeyboard);
});

bot.on('message', async (msg) => {
  const userId = String(msg.from.id);
  console.log('MESSAGE - USER ID:', userId);
  if (!ALLOWED_USERS.includes(userId)) return;
  const text = msg.text;

  if (text === 'scan' || text === '🔍 مسح السوق') {
    bot.sendMessage(msg.chat.id, '⏳ بفحص 300 عملة، ممكن ياخد دقيقة أو اتنين...');
    try {
      const res = await scanMarket();
      if (res.length === 0) {
        bot.sendMessage(msg.chat.id, 'مفيش فرص قوية دلوقتي');
      } else {
        for (const r of res.slice(0, 5)) {
          bot.sendMessage(msg.chat.id, formatSignal(r));
        }
      }
    } catch (err) {
      console.log('SCAN ERROR:', err.message);
      bot.sendMessage(msg.chat.id, '❌ حصل خطأ: ' + err.message);
    }
  }

  if (text === '🚀 أفضل الفرص') {
    bot.sendMessage(msg.chat.id, '⏳ بحدد أفضل فرصة من 300 عملة...');
    try {
      const res = await scanMarket();
      if (res.length === 0) {
        bot.sendMessage(msg.chat.id, 'مفيش فرص قوية دلوقتي');
      } else {
        bot.sendMessage(msg.chat.id, formatSignal(res[0]));
      }
    } catch (err) {
      bot.sendMessage(msg.chat.id, '❌ حصل خطأ: ' + err.message);
    }
  }

  if (text === 'ℹ️ المساعدة') {
    bot.sendMessage(msg.chat.id,
      'الأوامر المتاحة:\n🔍 مسح السوق - يفحص 300 عملة ويجيب الفرص (سكور 60+)\n🚀 أفضل الفرص - يجيب أقوى فرصة واحدة بس\nℹ️ المساعدة - الرسالة دي\n\nدرجات الإشارة:\n🟢 ممتازة (85+)\n🔵 جيدة جداً (75-84)\n🟡 جيدة (65-74)\n⚪ عادية (60-64)');
  }
});
  };
}
}}
