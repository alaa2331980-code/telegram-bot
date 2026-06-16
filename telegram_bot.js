const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

const BOT_TOKEN = '8780661149:AAHrPfSfJpS18RVoXZ5b4Vj9mtFJ8kgRRGQ';
const BINANCE_API_KEY = process.env.BINANCE_API_KEY || '';
const ALLOWED_USERS = ['5941806593'];

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('البوت شغال! النسخة B — 50 عملة');

async function getKlines(symbol, interval = '1h', limit = 150) {
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
    const tr = Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1]));
    const upMove = highs[i]-highs[i-1], downMove = lows[i-1]-lows[i];
    trArr.push(tr);
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const smoothTR = trArr.slice(-period).reduce((a,b)=>a+b,0);
  const smoothPDM = plusDM.slice(-period).reduce((a,b)=>a+b,0);
  const smoothMDM = minusDM.slice(-period).reduce((a,b)=>a+b,0);
  const plusDI = smoothTR===0?0:(smoothPDM/smoothTR)*100;
  const minusDI = smoothTR===0?0:(smoothMDM/smoothTR)*100;
  const dx = (plusDI+minusDI)===0?0:(Math.abs(plusDI-minusDI)/(plusDI+minusDI))*100;
  return { adx: parseFloat(dx.toFixed(1)), plusDI: parseFloat(plusDI.toFixed(1)), minusDI: parseFloat(minusDI.toFixed(1)) };
}

function calcSupertrend(klines, period=14, multiplier=3) {
  if (klines.length < period+1) return 'غير محدد';
  const highs=klines.map(k=>parseFloat(k[2]));
  const lows=klines.map(k=>parseFloat(k[3]));
  const closes=klines.map(k=>parseFloat(k[4]));
  const trs=[0];
  for(let i=1;i<klines.length;i++)
    trs.push(Math.max(highs[i]-lows[i],Math.abs(highs[i]-closes[i-1]),Math.abs(lows[i]-closes[i-1])));
  const atrArr=new Array(klines.length).fill(0);
  for(let i=period;i<klines.length;i++)
    atrArr[i]=trs.slice(i-period+1,i+1).reduce((a,b)=>a+b,0)/period;
  let dir=new Array(klines.length).fill(1);
  let upper=new Array(klines.length).fill(0);
  let lower=new Array(klines.length).fill(0);
  for(let i=period;i<klines.length;i++){
    const hl2=(highs[i]+lows[i])/2;
    upper[i]=hl2+multiplier*atrArr[i];
    lower[i]=hl2-multiplier*atrArr[i];
    if(i===period){dir[i]=closes[i]>lower[i]?1:-1;continue;}
    lower[i]=(lower[i]>lower[i-1]||closes[i-1]<lower[i-1])?lower[i]:lower[i-1];
    upper[i]=(upper[i]<upper[i-1]||closes[i-1]>upper[i-1])?upper[i]:upper[i-1];
    if(dir[i-1]===-1&&closes[i]>upper[i])dir[i]=1;
    else if(dir[i-1]===1&&closes[i]<lower[i])dir[i]=-1;
    else dir[i]=dir[i-1];
  }
  return dir[dir.length-1]===1?'صاعد':'هابط';
}

function calcVWAP(klines) {
  const slice=klines.slice(-24);
  let cTPV=0,cVol=0;
  for(const k of slice){
    const tp=(parseFloat(k[2])+parseFloat(k[3])+parseFloat(k[4]))/3;
    cTPV+=tp*parseFloat(k[5]);cVol+=parseFloat(k[5]);
  }
  return cVol===0?0:cTPV/cVol;
}

function calcVolume(klines) {
  const volumes=klines.map(k=>parseFloat(k[5]));
  const avg=volumes.slice(-20).reduce((a,b)=>a+b,0)/20;
  return {current:volumes[volumes.length-1],avg,ratio:parseFloat((volumes[volumes.length-1]/avg).toFixed(2))};
}

function calcSupportResistance(klines) {
  const slice=klines.slice(-50);
  const highs=slice.map(k=>parseFloat(k[2]));
  const lows=slice.map(k=>parseFloat(k[3]));
  const closes=slice.map(k=>parseFloat(k[4]));
  const price=closes[closes.length-1];
  const pivots=[];
  for(let i=2;i<slice.length-2;i++){
    if(highs[i]>highs[i-1]&&highs[i]>highs[i-2]&&highs[i]>highs[i+1]&&highs[i]>highs[i+2])
      pivots.push({type:'R',price:highs[i]});
    if(lows[i]<lows[i-1]&&lows[i]<lows[i-2]&&lows[i]<lows[i+1]&&lows[i]<lows[i+2])
      pivots.push({type:'S',price:lows[i]});
  }
  const resistances=pivots.filter(p=>p.type==='R'&&p.price>price).map(p=>p.price).sort((a,b)=>a-b);
  const supports=pivots.filter(p=>p.type==='S'&&p.price<price).map(p=>p.price).sort((a,b)=>b-a);
  return {
    r1:resistances[0]||price*1.02,
    s1:supports[0]||price*0.98,
  };
}

function getFrameDirection(klines) {
  const closes=klines.map(k=>parseFloat(k[4]));
  const price=closes[closes.length-1];
  const ema20=calcEMA(closes,20);
  const ema50=calcEMA(closes,50);
  const macd=calcMACD(closes);
  if(price>ema20&&price>ema50&&macd.macd>0)return 'صاعد';
  if(price<ema20&&price<ema50&&macd.macd<0)return 'هابط';
  return 'محايد';
}async function analyzeSymbol(symbol) {
  try {
    const [klines1h, klines4h] = await Promise.all([
      getKlines(symbol, '1h', 150),
      getKlines(symbol, '4h', 150),
    ]);
    if (!klines1h || klines1h.length < 50) return null;

    const closes = klines1h.map(k => parseFloat(k[4]));
    const price = closes[closes.length - 1];
    const ema200 = closes.length >= 150 ? calcEMA(closes, 150) : calcEMA(closes, closes.length);
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

    // اتجاه عام
    const bullish = price > ema200 && price > vwap;
    const bearish = price < ema200 && price < vwap;
    const direction = bullish ? 'Long' : bearish ? 'Short' : null;
    if (!direction) return null;

    // حساب Score من 100
    let score = 0;

    // الاتجاه (25)
    if (direction === 'Long') {
      if (price > ema200) score += 12;
      if (price > vwap) score += 8;
      if (supertrend === 'صاعد') score += 5;
    } else {
      if (price < ema200) score += 12;
      if (price < vwap) score += 8;
      if (supertrend === 'هابط') score += 5;
    }

    // توافق الفريمات (20)
    if (dir1h === dir4h) score += 15;
    if (dir1h === direction) score += 5;

    // ADX (15) - أخف من v4
    if (adx.adx >= 25) score += 15;
    else if (adx.adx >= 20) score += 12;
    else if (adx.adx >= 15) score += 8;
    else if (adx.adx >= 10) score += 4;

    // MACD (15)
    if (direction === 'Long') {
      if (macdData.macd > 0) score += 8;
      if (macdData.histogram > 0) score += 7;
    } else {
      if (macdData.macd < 0) score += 8;
      if (macdData.histogram < 0) score += 7;
    }

    // RSI (15) - نطاق أوسع من v4
    if (direction === 'Long') {
      if (rsi >= 50 && rsi <= 70) score += 15;
      else if (rsi >= 45 && rsi <= 75) score += 8;
    } else {
      if (rsi >= 30 && rsi <= 50) score += 15;
      else if (rsi >= 25 && rsi <= 55) score += 8;
    }

    // الحجم (10)
    if (volume.ratio >= 1.5) score += 10;
    else if (volume.ratio >= 1.2) score += 7;
    else if (volume.ratio >= 1.0) score += 4;

    // R:R
    const entry = price;
    const target = direction === 'Long' ? sr.r1 : sr.s1;
    const stopLoss = direction === 'Long'
      ? Math.max(sr.s1, price - atr * 1.5)
      : Math.min(sr.r1, price + atr * 1.5);
    const rr = parseFloat((Math.abs(target - entry) / Math.abs(entry - stopLoss)).toFixed(2));

    // رفض لو R:R أقل من 1.5
    if (rr < 1.5) return null;

    console.log(`${symbol} | Score=${score} | Dir=${direction} | ADX=${adx.adx} | RSI=${rsi.toFixed(1)} | RR=${rr} | 1H=${dir1h} | 4H=${dir4h}`);

    return { symbol, score, direction, price, rsi, macdData, adx, volume, supertrend, sr, dir1h, dir4h, entry, target, stopLoss, rr, atr, vwap, ema200 };
  } catch (e) {
    console.log(`${symbol} | خطأ: ${e.message}`);
    return null;
  }
}

function getGrade(score) {
  if (score >= 75) return '🔥 قوي جداً';
  if (score >= 55) return '🟡 عادي';
  return '🔴 مرفوض';
}

function formatSignal(r) {
  const grade = getGrade(r.score);
  const dirEmoji = r.direction === 'Long' ? '📈' : '📉';
  return (
    `${grade} *${r.symbol} — ${r.direction} ${dirEmoji}*\n\n` +
    `💰 السعر: \`${r.price.toFixed(4)}\`\n` +
    `⭐ Score: *${r.score}/100*\n\n` +
    `🕐 *الفريمات:*\n` +
    `• 1H: ${r.dir1h === 'صاعد' ? '✅' : '❌'} ${r.dir1h}\n` +
    `• 4H: ${r.dir4h === 'صاعد' ? '✅' : '❌'} ${r.dir4h}\n\n` +
    `📊 *المؤشرات:*\n` +
    `• RSI: ${r.rsi.toFixed(1)}\n` +
    `• MACD: ${r.macdData.macd > 0 ? '✅ صاعد' : '❌ هابط'}\n` +
    `• ADX: ${r.adx.adx} ${r.adx.adx >= 15 ? '✅' : '⚠️'}\n` +
    `• Supertrend: ${r.supertrend === 'صاعد' ? '✅ صاعد' : '❌ هابط'}\n` +
    `• الحجم: x${r.volume.ratio} ${r.volume.ratio >= 1.0 ? '✅' : '❌'}\n` +
    `• VWAP: ${r.price > r.vwap ? '✅ فوق' : '❌ تحت'}\n\n` +
    `📐 *الصفقة:*\n` +
    `• الدخول: \`${r.entry.toFixed(4)}\`\n` +
    `• الهدف: \`${r.target.toFixed(4)}\`\n` +
    `• وقف الخسارة: \`${r.stopLoss.toFixed(4)}\`\n` +
    `• R:R = 1:${r.rr}\n\n` +
    `⚠️ للأغراض التعليمية فقط`
  );
}

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

async function scanMarket() {
  console.log('=== بدء مسح 50 عملة ===');
  const results = [];
  for (const symbol of SYMBOLS) {
    const r = await analyzeSymbol(symbol);
    if (r && r.score >= 55) results.push(r);
  }
  console.log(`=== انتهى المسح: ${results.length} إشارة ===`);
  return results.sort((a, b) => b.score - a.score);
}

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

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) { bot.sendMessage(chatId, '🚫 البوت خاص.'); return; }
  bot.sendMessage(chatId, '👋 أهلاً! النسخة B — 50 عملة\n\n🎯 إشارات أكثر بجودة عالية\nاختار من القائمة 👇', getMainMenu());
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!isAllowed(chatId)) return;
  if (!text) return;

  if (text === '🔍 مسح السوق' || text === '🚀 أفضل الفرص') {
    await bot.sendMessage(chatId, '⏳ جاري مسح 50 عملة... (3-4 دقائق)');
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
      '📖 *النسخة B*\n\n' +
      '✅ 50 عملة\n' +
      '✅ Score من 100\n' +
      '✅ فلتر R:R فوق 1:1.5\n' +
      '✅ ADX فوق 10\n\n' +
      '🔥 75+ = قوي جداً\n' +
      '🟡 55-74 = عادي\n\n' +
      '⚠️ للأغراض التعليمية فقط',
      { parse_mode: 'Markdown', ...getMainMenu() }
    );
    return;
  }

  if (/^[a-zA-Z]{2,10}$/.test(text)) {
    const symbol = text.toUpperCase().replace('USDT', '') + 'USDT';
    await bot.sendMessage(chatId, `⏳ جاري تحليل ${symbol}...`);
    const result = await analyzeSymbol(symbol);
    if (!result) {
      await bot.sendMessage(chatId, '❌ مش لاقي إشارة أو الشروط مش مكتملة', getMainMenu());
      return;
    }
    await bot.sendMessage(chatId, formatSignal(result), { parse_mode: 'Markdown', ...getMainMenu() });
  }
});

bot.on('polling_error', (error) => console.error('خطأ:', error.message));
