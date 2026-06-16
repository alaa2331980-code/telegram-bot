const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

const BOT_TOKEN = '8780661149:AAHrPfSfJpS18RVoXZ5b4Vj9mtFJ8kgRRGQ';
const ADMIN_CHAT_ID = '5941806593';
const BINANCE_API_KEY = process.env.BINANCE_API_KEY || '';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('البوت شغال! النسخة المتقدمة v3');

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
          else { console.error(`API Error ${symbol}:`, parsed.msg); reject(new Error(parsed.msg)); }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

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

function calcBollinger(closes, period = 20) {
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period);
  return { upper: mean + 2 * std, middle: mean, lower: mean - 2 * std };
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

function calcSupertrend(klines, period = 14, multiplier = 3) {
  if (klines.length < period + 1) return 'غير محدد';
  const highs = klines.map(k => parseFloat(k[2]));
  const lows = klines.map(k => parseFloat(k[3]));
  const closes = klines.map(k => parseFloat(k[4]));
  const trs = [0];
  for (let i = 1; i < klines.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])));
  }
  const atrArr = new Array(klines.length).fill(0);
  for (let i = period; i < klines.length; i++)
    atrArr[i] = trs.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
  let direction = new Array(klines.length).fill(1);
  let upperBand = new Array(klines.length).fill(0);
  let lowerBand = new Array(klines.length).fill(0);
  for (let i = period; i < klines.length; i++) {
    const hl2 = (highs[i] + lows[i]) / 2;
    upperBand[i] = hl2 + multiplier * atrArr[i];
    lowerBand[i] = hl2 - multiplier * atrArr[i];
    if (i === period) { direction[i] = closes[i] > lowerBand[i] ? 1 : -1; continue; }
    lowerBand[i] = (lowerBand[i] > lowerBand[i-1] || closes[i-1] < lowerBand[i-1]) ? lowerBand[i] : lowerBand[i-1];
    upperBand[i] = (upperBand[i] < upperBand[i-1] || closes[i-1] > upperBand[i-1]) ? upperBand[i] : upperBand[i-1];
    if (direction[i-1] === -1 && closes[i] > upperBand[i]) direction[i] = 1;
    else if (direction[i-1] === 1 && closes[i] < lowerBand[i]) direction[i] = -1;
    else direction[i] = direction[i-1];
  }
  return direction[direction.length - 1] === 1 ? 'صاعد' : 'هابط';
}

function calcVolume(klines) {
  const volumes = klines.map(k => parseFloat(k[5]));
  const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const currentVolume = volumes[volumes.length - 1];
  return { current: currentVolume, avg: avgVolume, ratio: parseFloat((currentVolume / avgVolume).toFixed(2)) };
}

function calcVWAP(klines) {
  const slice = klines.slice(-24);
  let cTPV = 0, cVol = 0;
  for (const k of slice) {
    const tp = (parseFloat(k[2]) + parseFloat(k[3]) + parseFloat(k[4])) / 3;
    const vol = parseFloat(k[5]);
    cTPV += tp * vol; cVol += vol;
  }
  return cVol === 0 ? 0 : cTPV / cVol;
}

function calcOBV(klines) {
  const slice = klines.slice(-50);
  let obv = 0;
  const obvValues = [0];
  for (let i = 1; i < slice.length; i++) {
    const close = parseFloat(slice[i][4]), prevClose = parseFloat(slice[i-1][4]);
    const volume = parseFloat(slice[i][5]);
    if (close > prevClose) obv += volume;
    else if (close < prevClose) obv -= volume;
    obvValues.push(obv);
  }
  const recent = obvValues.slice(-10);
  return { value: obv, trend: recent[recent.length-1] > recent[0] ? 'صاعد' : 'هابط' };
}

function calcADX(klines, period = 14) {
  if (klines.length < period * 2) return { adx: 0, trend: 'ضعيف' };
  const highs = klines.map(k => parseFloat(k[2]));
  const lows = klines.map(k => parseFloat(k[3]));
  const closes = klines.map(k => parseFloat(k[4]));
  const trArr = [], plusDM = [], minusDM = [];
  for (let i = 1; i < klines.length; i++) {
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1]));
    const upMove = highs[i] - highs[i-1];
    const downMove = lows[i-1] - lows[i];
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
  let trend = 'ضعيف';
  if (dx > 25) trend = plusDI > minusDI ? 'صاعد قوي' : 'هابط قوي';
  else if (dx > 15) trend = 'متوسط';
  return { adx: parseFloat(dx.toFixed(1)), plusDI: parseFloat(plusDI.toFixed(1)), minusDI: parseFloat(minusDI.toFixed(1)), trend };
}function calcDivergence(klines) {
  const closes = klines.slice(-30).map(k => parseFloat(k[4]));
  const rsiValues = [];
  for (let i = 14; i < closes.length; i++)
    rsiValues.push(calcRSI(closes.slice(i - 14, i + 1)));
  if (rsiValues.length < 5) return 'لا يوجد';
  const recentCloses = closes.slice(-5);
  const recentRSI = rsiValues.slice(-5);
  const priceHigher = recentCloses[recentCloses.length-1] > recentCloses[0];
  const rsiLower = recentRSI[recentRSI.length-1] < recentRSI[0];
  const priceLower = recentCloses[recentCloses.length-1] < recentCloses[0];
  const rsiHigher = recentRSI[recentRSI.length-1] > recentRSI[0];
  if (priceHigher && rsiLower) return 'هبوطي ⚠️';
  if (priceLower && rsiHigher) return 'صعودي ✅';
  return 'لا يوجد';
}

function calcIchimoku(klines) {
  const highs = klines.map(k => parseFloat(k[2]));
  const lows = klines.map(k => parseFloat(k[3]));
  const closes = klines.map(k => parseFloat(k[4]));
  const currentPrice = closes[closes.length - 1];
  const tenkanHigh = Math.max(...highs.slice(-9));
  const tenkanLow = Math.min(...lows.slice(-9));
  const tenkan = (tenkanHigh + tenkanLow) / 2;
  const kijunHigh = Math.max(...highs.slice(-26));
  const kijunLow = Math.min(...lows.slice(-26));
  const kijun = (kijunHigh + kijunLow) / 2;
  const senkouA = (tenkan + kijun) / 2;
  const senkou52High = Math.max(...highs.slice(-52));
  const senkou52Low = Math.min(...lows.slice(-52));
  const senkouB = (senkou52High + senkou52Low) / 2;
  const cloudTop = Math.max(senkouA, senkouB);
  const cloudBottom = Math.min(senkouA, senkouB);
  let signal = 'محايد';
  if (currentPrice > cloudTop && tenkan > kijun) signal = 'صاعد قوي ✅';
  else if (currentPrice > cloudTop) signal = 'صاعد ✅';
  else if (currentPrice < cloudBottom && tenkan < kijun) signal = 'هابط قوي ❌';
  else if (currentPrice < cloudBottom) signal = 'هابط ❌';
  else signal = 'داخل السحابة ⚠️';
  return { tenkan, kijun, senkouA, senkouB, cloudTop, cloudBottom, signal };
}

function calcSupportResistance(klines) {
  const slice = klines.slice(-50);
  const highs = slice.map(k => parseFloat(k[2]));
  const lows = slice.map(k => parseFloat(k[3]));
  const closes = slice.map(k => parseFloat(k[4]));
  const currentPrice = closes[closes.length - 1];
  const pivots = [];
  for (let i = 2; i < slice.length - 2; i++) {
    if (highs[i] > highs[i-1] && highs[i] > highs[i-2] && highs[i] > highs[i+1] && highs[i] > highs[i+2])
      pivots.push({ type: 'resistance', price: highs[i] });
    if (lows[i] < lows[i-1] && lows[i] < lows[i-2] && lows[i] < lows[i+1] && lows[i] < lows[i+2])
      pivots.push({ type: 'support', price: lows[i] });
  }
  const resistances = pivots.filter(p => p.type === 'resistance' && p.price > currentPrice)
    .map(p => p.price).sort((a, b) => a - b).slice(0, 2);
  const supports = pivots.filter(p => p.type === 'support' && p.price < currentPrice)
    .map(p => p.price).sort((a, b) => b - a).slice(0, 2);
  return {
    resistance1: resistances[0] || currentPrice * 1.02,
    resistance2: resistances[1] || currentPrice * 1.04,
    support1: supports[0] || currentPrice * 0.98,
    support2: supports[1] || currentPrice * 0.96,
  };
}

async function getTrendAlignment(symbol) {
  try {
    const [k15m, k1h, k4h] = await Promise.all([
      getKlines(symbol, '15m', 100),
      getKlines(symbol, '1h', 100),
      getKlines(symbol, '4h', 100),
    ]);
    const getDir = (klines) => {
      const closes = klines.map(k => parseFloat(k[4]));
      const macd = calcMACD(closes);
      const ema21 = calcEMA(closes, 21);
      const price = closes[closes.length - 1];
      return price > ema21 && macd.macd > 0 ? 'صاعد' : 'هابط';
    };
    const dir15m = getDir(k15m), dir1h = getDir(k1h), dir4h = getDir(k4h);
    return { dir15m, dir1h, dir4h, aligned: dir15m === dir1h && dir1h === dir4h, direction: dir4h };
  } catch (e) {
    return { dir15m: '؟', dir1h: '؟', dir4h: '؟', aligned: false, direction: 'محايد' };
  }
}

async function analyzeSymbol(symbol) {
  try {
    const klines = await getKlines(symbol, '1h', 200);
    if (!klines || klines.length < 60) { console.log(`${symbol} | بيانات غير كافية`); return null; }
    const closes = klines.map(k => parseFloat(k[4]));
    const currentPrice = closes[closes.length - 1];
    const rsi = calcRSI(closes), stochRsi = calcStochRSI(closes);
    const macdData = calcMACD(closes), bb = calcBollinger(closes);
    const atr = calcATR(klines), supertrend = calcSupertrend(klines);
    const volume = calcVolume(klines);
    const ema9 = calcEMA(closes, 9), ema21 = calcEMA(closes, 21);
    const ema50 = calcEMA(closes, 50);
    const ema200 = closes.length >= 200 ? calcEMA(closes, 200) : null;
    const vwap = calcVWAP(klines), obv = calcOBV(klines);
    const adx = calcADX(klines), divergence = calcDivergence(klines);
    const ichimoku = calcIchimoku(klines), sr = calcSupportResistance(klines);
    const trendAlign = await getTrendAlignment(symbol);
    const stopLoss = Math.max(sr.support1, currentPrice - (atr * 1.5));
    const target = Math.min(sr.resistance1, currentPrice + (atr * 3));
    const riskReward = ((target - currentPrice) / (currentPrice - stopLoss)).toFixed(1);
    let score = 0;
    if (rsi > 50 && rsi < 70) score++;
    if (stochRsi > 50) score++;
    if (macdData.macd > 0) score++;
    if (macdData.histogram > 0) score++;
    if (currentPrice > bb.middle) score++;
    if (supertrend === 'صاعد') score++;
    if (volume.ratio > 1.0) score++;
    if (currentPrice > ema9 && currentPrice > ema21) score++;
    if (ema200 && currentPrice > ema200) score++;
    if (currentPrice > vwap) score++;
    if (obv.trend === 'صاعد') score++;
    if (adx.adx > 25 && adx.plusDI > adx.minusDI) score++;
    if (divergence === 'صعودي ✅') score++;
    if (ichimoku.signal.includes('صاعد')) score++;
    if (trendAlign.aligned && trendAlign.direction === 'صاعد') score++;
    if (divergence === 'هبوطي ⚠️') score = Math.max(0, score - 1);
    if (parseFloat(riskReward) < 1.5) score = Math.max(0, score - 2);
    console.log(`${symbol} | Score=${score}/15 | RSI=${rsi.toFixed(1)} | ADX=${adx.adx} | Ichimoku=${ichimoku.signal} | Align=${trendAlign.aligned} | Div=${divergence}`);
    const signal = trendAlign.dir4h === 'هابط' ? 'Short 📉' : trendAlign.aligned ? 'Long قوي 🚀' : 'Long 📈';
    return { symbol, score, rsi, stochRsi, macdData, bb, supertrend, volume, atr, ema9, ema21, ema50, ema200, vwap, obv, adx, divergence, ichimoku, sr, trendAlign, stopLoss, target, riskReward, price: currentPrice, signal };
  } catch (e) { console.log(`${symbol} | خطأ: ${e.message}`); return null; }
}

function getOpportunityLabel(score) {
  if (score >= 12) return '🟢 فرصة قوية جداً';
  if (score >= 9) return '🟡 فرصة جيدة';
  if (score >= 6) return '🔵 فرصة مراقبة';
  return null;
}

const SYMBOLS = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','LINKUSDT','MATICUSDT','LTCUSDT','ATOMUSDT','NEARUSDT','OPUSDT','ARBUSDT','APTUSDT','INJUSDT','SUIUSDT','TIAUSDT'];

async function scanMarket() {
  console.log('=== بدء مسح السوق المتقدم ===');
  const results = [];
  for (const symbol of SYMBOLS) {
    const r = await analyzeSymbol(symbol);
    if (r && r.score >= 6) results.push(r);
  }
  console.log(`=== انتهى المسح: ${results.length} فرصة ===`);
  return results.sort((a, b) => b.score - a.score);
}

async function getTop5Summary() {
  const all = [];
  for (const symbol of SYMBOLS) { const r = await analyzeSymbol(symbol); if (r) all.push(r); }
  all.sort((a, b) => b.score - a.score);
  let msg = '📊 *لا توجد فرص كافية الآن — أفضل 5 عملات:*\n\n';
  for (const r of all.slice(0, 5)) msg += `${getOpportunityLabel(r.score) || '⚪'} ${r.symbol}  Score: ${r.score}/15\n`;
  return msg;
}

function formatAnalysis(r) {
  const label = getOpportunityLabel(r.score) || '🔵 فرصة مراقبة';
  const ema200Status = r.ema200 ? (r.price > r.ema200 ? '✅ فوق' : '❌ تحت') : '⚪ غير متاح';
  return (
    `📊 *${r.symbol}*\n\n💰 السعر: \`${r.price.toFixed(4)}\`\n🎯 ${label}\n🚦 الإشارة: *${r.signal}*\n\n` +
    `🕐 *اتجاه الفريمات:*\n• 15M: ${r.trendAlign.dir15m === 'صاعد' ? '✅' : '❌'} ${r.trendAlign.dir15m}\n• 1H: ${r.trendAlign.dir1h === 'صاعد' ? '✅' : '❌'} ${r.trendAlign.dir1h}\n• 4H: ${r.trendAlign.dir4h === 'صاعد' ? '✅' : '❌'} ${r.trendAlign.dir4h}\n• التوافق: ${r.trendAlign.aligned ? '✅ متوافق' : '❌ غير متوافق'}\n\n` +
    `📈 *المؤشرات الأساسية:*\n• RSI: ${r.rsi.toFixed(1)} ${r.rsi > 50 && r.rsi < 70 ? '✅' : '❌'}\n• StochRSI: ${r.stochRsi.toFixed(1)} ${r.stochRsi > 50 ? '✅' : '❌'}\n• MACD: ${r.macdData.macd > 0 ? '✅ صاعد' : '❌ هابط'}\n• Histogram: ${r.macdData.histogram > 0 ? '✅ موجب' : '❌ سالب'}\n• بولينجر: ${r.price > r.bb.middle ? '✅ فوق المتوسط' : '❌ تحت المتوسط'}\n• Supertrend: ${r.supertrend === 'صاعد' ? '✅ صاعد' : '❌ هابط'}\n• الحجم: ${r.volume.ratio > 1.0 ? '✅' : '❌'} x${r.volume.ratio}\n\n` +
    `📊 *المؤشرات المتقدمة:*\n• EMA9/21: ${r.price > r.ema9 && r.price > r.ema21 ? '✅ فوق' : '❌ تحت'}\n• EMA50: ${r.price > r.ema50 ? '✅ فوق' : '❌ تحت'}\n• EMA200: ${ema200Status}\n• VWAP: ${r.price > r.vwap ? '✅ فوق' : '❌ تحت'}\n• OBV: ${r.obv.trend === 'صاعد' ? '✅ صاعد' : '❌ هابط'}\n• ADX: ${r.adx.adx} ${r.adx.adx > 25 ? '✅ ترند قوي' : '⚠️ ترند ضعيف'}\n• Divergence: ${r.divergence}\n• Ichimoku: ${r.ichimoku.signal}\n\n` +
    `🏗️ *الدعم والمقاومة:*\n• مقاومة 2: \`${r.sr.resistance2.toFixed(4)}\`\n• مقاومة 1: \`${r.sr.resistance1.toFixed(4)}\`\n• السعر: \`${r.price.toFixed(4)}\`\n• دعم 1: \`${r.sr.support1.toFixed(4)}\`\n• دعم 2: \`${r.sr.support2.toFixed(4)}\`\n\n` +
    `*⭐ النتيجة: ${r.score}/15*\n\n🎯 الهدف: \`${r.target.toFixed(4)}\`\n🔴 وقف الخسارة: \`${r.stopLoss.toFixed(4)}\`\n📐 Risk/Reward: ${r.riskReward}:1\n\n⚠️ للأغراض التعليمية فقط`
  );
}

function getMainMenu() {
  return { reply_markup: { keyboard: [[{ text: '🔍 مسح السوق' }, { text: '📊 تحليل العملة' }],[{ text: '🚀 Futures فرص' }, { text: '💎 حدد الفرص' }],[{ text: 'ℹ️ المساعدة' }]], resize_keyboard: true } };
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (chatId.toString() !== ADMIN_CHAT_ID) { bot.sendMessage(chatId, '🚫 البوت خاص.'); return; }
  bot.sendMessage(chatId, '👋 أهلاً! النسخة المتقدمة v3\n\nاختار من القائمة 🎮', getMainMenu());
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (chatId.toString() !== ADMIN_CHAT_ID) return;
  if (!text) return;
  if (text === '🔍 مسح السوق' || text === '💎 حدد الفرص' || text === '🚀 Futures فرص') {
    await bot.sendMessage(chatId, '⏳ جاري المسح المتقدم... (قد يستغرق 2-3 دقائق)');
    const results = await scanMarket();
    if (results.length === 0) {
      const top5msg = await getTop5Summary();
      await bot.sendMessage(chatId, top5msg, { parse_mode: 'Markdown', ...getMainMenu() });
      return;
    }
    for (const r of results.slice(0, 3)) await bot.sendMessage(chatId, formatAnalysis(r), { parse_mode: 'Markdown' });
    await bot.sendMessage(chatId, '✅ انتهى المسح', getMainMenu());
    return;
  }
  if (text === '📊 تحليل العملة') { await bot.sendMessage(chatId, '📊 اكتب اسم العملة:\nمثال: BTC أو ETH أو SOL'); return; }
  if (text === 'ℹ️ المساعدة') {
    await bot.sendMessage(chatId, '📖 *النسخة المتقدمة v3*\n\n*15 مؤشر:*\nRSI • MACD • StochRSI • بولينجر\nSupertrend • ATR • Volume\nEMA9/21/50/200 • VWAP • OBV\nADX • Divergence • Ichimoku\nدعم/مقاومة • توافق الفريمات\n\n*تصنيف:*\n🟢 12-15 = قوية جداً\n🟡 9-11 = جيدة\n🔵 6-8 = مراقبة\n\n⚠️ للأغراض التعليمية فقط', { parse_mode: 'Markdown', ...getMainMenu() });
    return;
  }
  if (/^[a-zA-Z]{2,10}$/.test(text)) {
    const symbol = text.toUpperCase().replace('USDT', '') + 'USDT';
    await bot.sendMessage(chatId, `⏳ جاري التحليل المتقدم لـ ${symbol}...`);
    const result = await analyzeSymbol(symbol);
    if (!result) { await bot.sendMessage(chatId, '❌ مش لاقي العملة دي أو في خطأ', getMainMenu()); return; }
    await bot.sendMessage(chatId, formatAnalysis(result), { parse_mode: 'Markdown', ...getMainMenu() });
  }
});

bot.on('polling_error', (error) => console.error('خطأ:', error.message));
