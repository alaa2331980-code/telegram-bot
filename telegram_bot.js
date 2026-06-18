const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

const BOT_TOKEN = '8780661149:AAEnuY9zBOnOCZ3281ypEoRnXSJg11laWKE';
const BINANCE_API_KEY = process.env.BINANCE_API_KEY || '';
const ALLOWED_USERS = ['5941806593'];

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('VIP AI BOT RUNNING');

async function getKlines(symbol, interval = '1h', limit = 300) {
  return new Promise((resolve, reject) => {
    const path = `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const options = {
      hostname: 'api.binance.com',
      path,
      method: 'GET',
      headers: { 'X-MBX-APIKEY': BINANCE_API_KEY },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });

    req.on('error', reject);
    req.end();
  });
}

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
}

function detectSwingHighs(klines, lb = 3) {
  const h = klines.map(k => +k[2]);
  const out = [];
  for (let i = lb; i < h.length - lb; i++) {
    let ok = true;
    for (let j = 1; j <= lb; j++) {
      if (h[i] <= h[i - j] || h[i] <= h[i + j]) ok = false;
    }
    if (ok) out.push(h[i]);
  }
  return out;
}

function detectSwingLows(klines, lb = 3) {
  const l = klines.map(k => +k[3]);
  const out = [];
  for (let i = lb; i < l.length - lb; i++) {
    let ok = true;
    for (let j = 1; j <= lb; j++) {
      if (l[i] >= l[i - j] || l[i] >= l[i + j]) ok = false;
    }
    if (ok) out.push(l[i]);
  }
  return out;
}

function detectBOS(klines) {
  const highs = detectSwingHighs(klines);
  const lows = detectSwingLows(klines);
  const price = +klines.at(-1)[4];

  return {
    bullish: price > Math.max(...highs),
    bearish: price < Math.min(...lows),
  };
}

function detectLiquidity(klines) {
  const highs = klines.map(k => +k[2]);
  const lows = klines.map(k => +k[3]);

  return {
    sweepHigh: highs.at(-1) > Math.max(...highs.slice(-10)),
    sweepLow: lows.at(-1) < Math.min(...lows.slice(-10)),
  };
}

function detectPatterns(klines) {
  const o = +klines.at(-1)[1];
  const c = +klines.at(-1)[4];

  return {
    bullish: c > o,
    bearish: c < o,
  };
}

function calcSR(klines) {
  const highs = klines.map(k => +k[2]);
  const lows = klines.map(k => +k[3]);
  const price = +klines.at(-1)[4];

  return {
    r1: Math.max(...highs.slice(-20)),
    s1: Math.min(...lows.slice(-20)),
    price
  };
}

function getSignalGrade(score) {
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  return 'C';
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
  const sr = calcSR(k);

  let score = 0;

  if (direction === 'Long') {
    if (price > ema) score += 20;
    if (macd.macd > 0) score += 15;
    if (rsi > 50) score += 10;
    if (bos.bullish) score += 20;
    if (liq.sweepLow) score += 15;
  } else {
    if (price < ema) score += 20;
    if (macd.macd < 0) score += 15;
    if (rsi < 50) score += 10;
    if (bos.bearish) score += 20;
    if (liq.sweepHigh) score += 15;
  }

  if (btc.trend !== (direction === 'Long' ? 'Bearish' : 'Bullish')) score += 10;

  const entry = price;
  const tp1 = direction === 'Long' ? sr.r1 : sr.s1;
  const sl = direction === 'Long' ? price - atr : price + atr;

  return {
    symbol,
    direction,
    price,
    score,
    grade: getSignalGrade(score),
    entry,
    tp1,
    sl,
  };
}

function formatSignal(r) {
  return `
🔥 ${r.symbol} (${r.grade}) ${r.direction}

💰 Price: ${r.price}
⭐ Score: ${r.score}/100

🎯 Entry: ${r.entry}
TP1: ${r.tp1}
🔴 SL: ${r.sl}

💡 VIP AI SIGNAL
`;
}

const SYMBOLS = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT'];

async function scanMarket() {
  const btc = await getBTCTrend();
  const results = [];

  for (const s of SYMBOLS) {
    const r = await analyzeSymbol(s, btc);
    if (r.score >= 60) results.push(r);
  }

  return results.sort((a,b)=>b.score-a.score);
}

bot.onText(/\/start/, (msg) => {
  const userId = String(msg.from.id);
  if (!ALLOWED_USERS.includes(userId)) return;
  bot.sendMessage(msg.chat.id, 'VIP AI Bot Ready 🚀');
});

bot.on('message', async (msg) => {
  const userId = String(msg.from.id);
  if (!ALLOWED_USERS.includes(userId)) return;

  if (msg.text === 'scan') {
    const res = await scanMarket();
    for (const r of res.slice(0, 5)) {
      bot.sendMessage(msg.chat.id, formatSignal(r));
    }
  }
});
