const https = require('https');
const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const BINANCE_API_KEY = process.env.BINANCE_API_KEY || '';
const ALLOWED_USERS = (process.env.ALLOWED_USERS || '').split(',').map(s => s.trim()).filter(Boolean);

const SETTINGS = {
  interval: '1h',
  klineLimit: 320,
  scanDelayMs: 120,
  minScore: 72,
  emaFast: 21,
  emaMid: 50,
  emaSlow: 200,
  adxLength: 14,
  adxThreshold: 18,
  atrLength: 14,
  liquidityLookback: 30,
  liquiditySweepLookback: 12,
  liquidityToleranceAtr: 0.18,
  minLiquidityTouches: 2,
  breakoutLookback: 20,
  breakoutBodyAtrMin: 0.40,
  pullbackWindow: 6,
  reclaimToleranceAtr: 0.35,
  stopAtrMult: 1.60,
  volumeMaLength: 20,
  volumeMultiplier: 1.05,
  minTrendSlopeBars: 3,
  rr1: 1.0,
  rr2: 2.0,
  rr3: 3.0,
  maxSignalAgeBars: 1,
  topScanCount: 5,
};

const SYMBOLS = (process.env.SYMBOLS || [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','LINKUSDT',
  'LTCUSDT','BCHUSDT','UNIUSDT','ATOMUSDT','NEARUSDT','APTUSDT','ARBUSDT','OPUSDT','INJUSDT','SUIUSDT',
  'TIAUSDT','SEIUSDT','RUNEUSDT','AAVEUSDT','MKRUSDT','LDOUSDT','CRVUSDT','DYDXUSDT','ENSUSDT','IMXUSDT',
  'TRXUSDT','TONUSDT','ICPUSDT','HBARUSDT','ETCUSDT','FILUSDT','XLMUSDT','RNDRUSDT','PEPEUSDT','WIFUSDT'
].join(','))
  .split(',')
  .map(s => s.trim().toUpperCase())
  .filter(Boolean);

const mainKeyboard = {
  reply_markup: {
    keyboard: [
      ['🔍 مسح السوق', '🚀 أفضل فرصة'],
      ['💧 السيولة الآن', 'ℹ️ المساعدة']
    ],
    resize_keyboard: true
  }
};

function isAllowed(userId) {
  if (!ALLOWED_USERS.length) return true;
  return ALLOWED_USERS.includes(String(userId));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function requestJson(hostname, path, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname,
      path,
      method: 'GET',
      timeout,
      headers: {
        'X-MBX-APIKEY': BINANCE_API_KEY,
        'User-Agent': 'Mozilla/5.0'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(parsed.msg || ('HTTP ' + res.statusCode)));
            return;
          }
          resolve(parsed);
        } catch (err) {
          reject(err);
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
}

async function getKlines(symbol, interval = SETTINGS.interval, limit = SETTINGS.klineLimit) {
  const path = `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const data = await requestJson('api.binance.com', path);
  if (!Array.isArray(data) || data.length < 50) {
    throw new Error('Invalid kline data for ' + symbol);
  }
  return data;
}

function toCandles(klines) {
  return klines.slice(0, -1).map(k => ({
    openTime: +k[0],
    open: +k[1],
    high: +k[2],
    low: +k[3],
    close: +k[4],
    volume: +k[5],
    closeTime: +k[6],
  }));
}

function emaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (!values.length) return out;
  const k = 2 / (period + 1);
  let ema = values[0];
  out[0] = ema;
  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

function smaAt(values, endIndex, period) {
  if (endIndex - period + 1 < 0) return null;
  let sum = 0;
  for (let i = endIndex - period + 1; i <= endIndex; i++) sum += values[i];
  return sum / period;
}

function atrSeries(candles, period = 14) {
  const tr = new Array(candles.length).fill(null);
  const atr = new Array(candles.length).fill(null);
  for (let i = 1; i < candles.length; i++) {
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
  }
  let seed = 0;
  for (let i = 1; i <= period && i < tr.length; i++) seed += tr[i] || 0;
  if (tr.length > period) atr[period] = seed / period;
  for (let i = period + 1; i < tr.length; i++) {
    atr[i] = ((atr[i - 1] * (period - 1)) + (tr[i] || 0)) / period;
  }
  return atr;
}

function adxSeries(candles, period = 14) {
  const plusDM = new Array(candles.length).fill(0);
  const minusDM = new Array(candles.length).fill(0);
  const tr = new Array(candles.length).fill(0);
  const plusDI = new Array(candles.length).fill(null);
  const minusDI = new Array(candles.length).fill(null);
  const dx = new Array(candles.length).fill(null);
  const adx = new Array(candles.length).fill(null);

  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
  }

  let trSum = 0, plusSum = 0, minusSum = 0;
  for (let i = 1; i <= period && i < candles.length; i++) {
    trSum += tr[i];
    plusSum += plusDM[i];
    minusSum += minusDM[i];
  }

  for (let i = period + 1; i < candles.length; i++) {
    trSum = trSum - (trSum / period) + tr[i];
    plusSum = plusSum - (plusSum / period) + plusDM[i];
    minusSum = minusSum - (minusSum / period) + minusDM[i];
    plusDI[i] = trSum === 0 ? 0 : (plusSum / trSum) * 100;
    minusDI[i] = trSum === 0 ? 0 : (minusSum / trSum) * 100;
    dx[i] = (plusDI[i] + minusDI[i]) === 0 ? 0 : (Math.abs(plusDI[i] - minusDI[i]) / (plusDI[i] + minusDI[i])) * 100;
  }

  const firstAdxIndex = period * 2;
  if (candles.length > firstAdxIndex) {
    let dxSeed = 0, count = 0;
    for (let i = period + 1; i <= firstAdxIndex && i < dx.length; i++) {
      if (dx[i] !== null) { dxSeed += dx[i]; count++; }
    }
    if (count > 0) adx[firstAdxIndex] = dxSeed / count;
    for (let i = firstAdxIndex + 1; i < dx.length; i++) {
      adx[i] = ((adx[i - 1] * (period - 1)) + (dx[i] || 0)) / period;
    }
  }
  return { adx, plusDI, minusDI };
}

function highest(values, start, end) {
  let max = -Infinity;
  for (let i = start; i <= end; i++) if (values[i] > max) max = values[i];
  return max;
}

function lowest(values, start, end) {
  let min = Infinity;
  for (let i = start; i <= end; i++) if (values[i] < min) min = values[i];
  return min;
}

function countTouches(level, values, start, end, tolerance) {
  let touches = 0;
  for (let i = start; i <= end; i++) {
    if (Math.abs(values[i] - level) <= tolerance) touches++;
  }
  return touches;
}

function getLiquidityState(candles, atr, index, cfg = SETTINGS) {
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const closes = candles.map(c => c.close);
  const lbStart = Math.max(0, index - cfg.liquidityLookback);
  const sweepStart = Math.max(0, index - cfg.liquiditySweepLookback);
  const atrNow = atr[index] || 0;
  const tol = Math.max(atrNow * cfg.liquidityToleranceAtr, closes[index] * 0.0015);
  const liquidityHigh = highest(highs, lbStart, index - 1);
  const liquidityLow = lowest(lows, lbStart, index - 1);
  const highTouches = countTouches(liquidityHigh, highs, lbStart, index - 1, tol);
  const lowTouches = countTouches(liquidityLow, lows, lbStart, index - 1, tol);
  const prevSweepHigh = highest(highs, sweepStart, index - 1);
  const prevSweepLow = lowest(lows, sweepStart, index - 1);
  const candle = candles[index];
  const prevClose = index > 0 ? candles[index - 1].close : candle.close;
  const candleRange = Math.max(0.0000001, candle.high - candle.low);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const sweepHigh = candle.high > prevSweepHigh + tol;
  const sweepLow = candle.low < prevSweepLow - tol;
  const rejectFromHigh = sweepHigh && candle.close < prevSweepHigh && upperWick / candleRange >= 0.25;
  const rejectFromLow = sweepLow && candle.close > prevSweepLow && lowerWick / candleRange >= 0.25;
  let bias = 'Neutral';
  let note = 'No clear liquidity event';
  if (rejectFromLow && lowTouches >= cfg.minLiquidityTouches) {
    bias = 'Liquidity Below Swept → Up';
    note = 'Swept sell-side liquidity below prior lows then reclaimed back up';
  } else if (rejectFromHigh && highTouches >= cfg.minLiquidityTouches) {
    bias = 'Liquidity Above Swept → Down';
    note = 'Swept buy-side liquidity above prior highs then rejected back down';
  } else if (candle.close > liquidityHigh && candle.close > prevClose) {
    bias = 'Liquidity Grab Upstream';
    note = 'Accepted above liquidity high; momentum may continue upward';
  } else if (candle.close < liquidityLow && candle.close < prevClose) {
    bias = 'Liquidity Grab Downstream';
    note = 'Accepted below liquidity low; momentum may continue downward';
  }
  return { liquidityHigh, liquidityLow, highTouches, lowTouches, sweepHigh, sweepLow, rejectFromHigh, rejectFromLow, bias, note };
}

function recentSwingLow(candles, endIndex, lookback = 10) {
  let min = Infinity;
  const start = Math.max(0, endIndex - lookback + 1);
  for (let i = start; i <= endIndex; i++) if (candles[i].low < min) min = candles[i].low;
  return min;
}

function recentSwingHigh(candles, endIndex, lookback = 10) {
  let max = -Infinity;
  const start = Math.max(0, endIndex - lookback + 1);
  for (let i = start; i <= endIndex; i++) if (candles[i].high > max) max = candles[i].high;
  return max;
}

function getTargets(side, entry, stopLoss) {
  const risk = Math.abs(entry - stopLoss);
  if (risk <= 0) return null;
  if (side === 'Long') {
    return { tp1: entry + risk * SETTINGS.rr1, tp2: entry + risk * SETTINGS.rr2, tp3: entry + risk * SETTINGS.rr3, risk };
  }
  return { tp1: entry - risk * SETTINGS.rr1, tp2: entry - risk * SETTINGS.rr2, tp3: entry - risk * SETTINGS.rr3, risk };
}

function getGrade(score) {
  if (score >= 90) return '🟢 ممتازة جداً';
  if (score >= 82) return '🔵 قوية';
  if (score >= 72) return '🟡 جيدة';
  return '⚪ ضعيفة';
  
}function buildSignals(candles) {
  if (candles.length < 260) throw new Error('Need at least 260 closed candles');
  const closes = candles.map(c => c.close);
  const opens = candles.map(c => c.open);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);
  const emaFast = emaSeries(closes, SETTINGS.emaFast);
  const emaMid = emaSeries(closes, SETTINGS.emaMid);
  const emaSlow = emaSeries(closes, SETTINGS.emaSlow);
  const atr = atrSeries(candles, SETTINGS.atrLength);
  const { adx } = adxSeries(candles, SETTINGS.adxLength);
  const signals = [];
  let pendingLong = null;
  let pendingShort = null;

  for (let i = 0; i < candles.length; i++) {
    const body = Math.abs(closes[i] - opens[i]);
    const volumeMa = smaAt(volumes, i, SETTINGS.volumeMaLength);
    const volumeOk = volumeMa === null ? true : volumes[i] >= volumeMa * SETTINGS.volumeMultiplier;
    const trendLong = (
      emaFast[i] !== null && emaMid[i] !== null && emaSlow[i] !== null && adx[i] !== null &&
      emaFast[i] > emaMid[i] && emaMid[i] > emaSlow[i] &&
      emaFast[i] > (emaFast[Math.max(0, i - SETTINGS.minTrendSlopeBars)] || -Infinity) &&
      adx[i] >= SETTINGS.adxThreshold
    );
    const trendShort = (
      emaFast[i] !== null && emaMid[i] !== null && emaSlow[i] !== null && adx[i] !== null &&
      emaFast[i] < emaMid[i] && emaMid[i] < emaSlow[i] &&
      emaFast[i] < (emaFast[Math.max(0, i - SETTINGS.minTrendSlopeBars)] || Infinity) &&
      adx[i] >= SETTINGS.adxThreshold
    );
    const dcStart = Math.max(0, i - SETTINGS.breakoutLookback);
    const dcHigh = i > 0 ? highest(highs, dcStart, i - 1) : null;
    const dcLow = i > 0 ? lowest(lows, dcStart, i - 1) : null;
    const breakoutLong = trendLong && dcHigh !== null && atr[i] !== null && closes[i] > dcHigh && body >= atr[i] * SETTINGS.breakoutBodyAtrMin && volumeOk;
    const breakoutShort = trendShort && dcLow !== null && atr[i] !== null && closes[i] < dcLow && body >= atr[i] * SETTINGS.breakoutBodyAtrMin && volumeOk;
    const liq = i > SETTINGS.liquidityLookback ? getLiquidityState(candles, atr, i) : null;

    let signal = {
      side: 'flat', score: 0, grade: '⚪ ضعيفة',
      entry: null, stopLoss: null, tp1: null, tp2: null, tp3: null,
      breakoutLevel: null, signalIndex: i,
      liquidityBias: liq ? liq.bias : 'Neutral',
      liquidityNote: liq ? liq.note : 'No liquidity context yet',
      liquidityHigh: liq ? liq.liquidityHigh : null,
      liquidityLow: liq ? liq.liquidityLow : null,
      adx: adx[i], reason: 'No signal',
    };

    if (pendingLong) {
      const age = i - pendingLong.index;
      const tolerance = (atr[i] || 0) * SETTINGS.reclaimToleranceAtr;
      const retest = candles[i].low <= (pendingLong.level + tolerance);
      const reclaim = candles[i].close > candles[i].open && candles[i].close > pendingLong.level && candles[i].close > (emaFast[i] || 0);
      const liqOk = liq && (liq.rejectFromLow || liq.bias === 'Liquidity Below Swept → Up' || liq.bias === 'Liquidity Grab Upstream');
      if (age >= 1 && age <= SETTINGS.pullbackWindow && retest && reclaim && trendLong && liqOk) {
        const breakoutStop = pendingLong.level - ((atr[i] || 0) * SETTINGS.stopAtrMult);
        const structureStop = recentSwingLow(candles, i, 10);
        const stopLoss = Math.min(breakoutStop, structureStop);
        const targets = getTargets('Long', candles[i].close, stopLoss);
        if (targets) {
          let score = 58;
          if (liq.rejectFromLow) score += 18;
          else if (liq.bias === 'Liquidity Grab Upstream') score += 10;
          if ((adx[i] || 0) >= SETTINGS.adxThreshold + 5) score += 8;
          if (volumeOk) score += 6;
          if (pendingLong.breakoutBody >= (pendingLong.atr * 0.60)) score += 5;
          if (candles[i].close > pendingLong.level) score += 5;
          signal = {
            side: 'Long', score: Math.min(100, score), grade: getGrade(Math.min(100, score)),
            entry: candles[i].close, stopLoss,
            tp1: targets.tp1, tp2: targets.tp2, tp3: targets.tp3,
            breakoutLevel: pendingLong.level, signalIndex: i,
            liquidityBias: liq.bias, liquidityNote: liq.note,
            liquidityHigh: liq.liquidityHigh, liquidityLow: liq.liquidityLow,
            adx: adx[i], reason: 'Trend up + breakout + pullback reclaim + sell-side liquidity sweep',
          };
        }
        pendingLong = null;
      } else if (age > SETTINGS.pullbackWindow || !trendLong) {
        pendingLong = null;
      }
    }

    if (pendingShort) {
      const age = i - pendingShort.index;
      const tolerance = (atr[i] || 0) * SETTINGS.reclaimToleranceAtr;
      const retest = candles[i].high >= (pendingShort.level - tolerance);
      const reclaim = candles[i].close < candles[i].open && candles[i].close < pendingShort.level && candles[i].close < (emaFast[i] || Infinity);
      const liqOk = liq && (liq.rejectFromHigh || liq.bias === 'Liquidity Above Swept → Down' || liq.bias === 'Liquidity Grab Downstream');
      if (age >= 1 && age <= SETTINGS.pullbackWindow && retest && reclaim && trendShort && liqOk) {
        const breakoutStop = pendingShort.level + ((atr[i] || 0) * SETTINGS.stopAtrMult);
        const structureStop = recentSwingHigh(candles, i, 10);
        const stopLoss = Math.max(breakoutStop, structureStop);
        const targets = getTargets('Short', candles[i].close, stopLoss);
        if (targets) {
          let score = 58;
          if (liq.rejectFromHigh) score += 18;
          else if (liq.bias === 'Liquidity Grab Downstream') score += 10;
          if ((adx[i] || 0) >= SETTINGS.adxThreshold + 5) score += 8;
          if (volumeOk) score += 6;
          if (pendingShort.breakoutBody >= (pendingShort.atr * 0.60)) score += 5;
          if (candles[i].close < pendingShort.level) score += 5;
          signal = {
            side: 'Short', score: Math.min(100, score), grade: getGrade(Math.min(100, score)),
            entry: candles[i].close, stopLoss,
            tp1: targets.tp1, tp2: targets.tp2, tp3: targets.tp3,
            breakoutLevel: pendingShort.level, signalIndex: i,
            liquidityBias: liq.bias, liquidityNote: liq.note,
            liquidityHigh: liq.liquidityHigh, liquidityLow: liq.liquidityLow,
            adx: adx[i], reason: 'Trend down + breakout + pullback reclaim + buy-side liquidity sweep',
          };
        }
        pendingShort = null;
      } else if (age > SETTINGS.pullbackWindow || !trendShort) {
        pendingShort = null;
      }
    }

    if (breakoutLong) {
      pendingLong = { index: i, level: dcHigh, atr: atr[i] || 0, breakoutBody: body };
      pendingShort = null;
    }
    if (breakoutShort) {
      pendingShort = { index: i, level: dcLow, atr: atr[i] || 0, breakoutBody: body };
      pendingLong = null;
    }
    signals.push(signal);
  }
  return { signals, emaFast, emaMid, emaSlow, atr, adx };
}

function getRegime(candles) {
  const closes = candles.map(c => c.close);
  const ema50 = emaSeries(closes, 50);
  const ema200 = emaSeries(closes, 200);
  const { adx } = adxSeries(candles, SETTINGS.adxLength);
  const i = candles.length - 1;
  if (closes[i] > ema50[i] && ema50[i] > ema200[i] && (adx[i] || 0) >= 16) return 'Bullish';
  if (closes[i] < ema50[i] && ema50[i] < ema200[i] && (adx[i] || 0) >= 16) return 'Bearish';
  return 'Neutral';
}

async function getBTCRegime() {
  const raw = await getKlines('BTCUSDT');
  const candles = toCandles(raw);
  return { regime: getRegime(candles), price: candles.at(-1).close };
}

async function getHigherTimeframeRegime(symbol) {
  const raw = await getKlines(symbol, '4h', 280);
  const candles = toCandles(raw);
  return getRegime(candles);
}

async function analyzeSymbol(symbol, btc) {
  const raw = await getKlines(symbol);
  const candles = toCandles(raw);
  const built = buildSignals(candles);
  const latest = built.signals.at(-1);
  const prev = built.signals.at(-2);
  const signal = latest && latest.side !== 'flat' ? latest : prev;
  const atrNow = built.atr.at(-1) || 0;
  const liqNow = getLiquidityState(candles, built.atr, candles.length - 1);

  if (!signal || signal.side === 'flat') {
    return { symbol, side: 'flat', score: 0, liquidityBias: liqNow.bias, liquidityNote: liqNow.note, liquidityHigh: liqNow.liquidityHigh, liquidityLow: liqNow.liquidityLow, atr: atrNow, reason: 'No valid signal' };
  }

  const age = (built.signals.length - 1) - signal.signalIndex;
  if (age > SETTINGS.maxSignalAgeBars) {
    return { symbol, side: 'flat', score: 0, liquidityBias: liqNow.bias, liquidityNote: liqNow.note, liquidityHigh: liqNow.liquidityHigh, liquidityLow: liqNow.liquidityLow, atr: atrNow, reason: 'Signal too old' };
  }

  const htfRegime = await getHigherTimeframeRegime(symbol);
  let finalScore = signal.score;
  const wantsBull = signal.side === 'Long';

  if (symbol !== 'BTCUSDT') {
    if ((wantsBull && btc.regime === 'Bullish') || (!wantsBull && btc.regime === 'Bearish')) finalScore += 8;
    else if (btc.regime !== 'Neutral') finalScore -= 10;
  }
  if ((wantsBull && htfRegime === 'Bullish') || (!wantsBull && htfRegime === 'Bearish')) finalScore += 10;
  else if (htfRegime !== 'Neutral') finalScore -= 12;

  finalScore = Math.max(0, Math.min(100, finalScore));

  if (finalScore < SETTINGS.minScore) {
    return { symbol, side: 'flat', score: finalScore, liquidityBias: liqNow.bias, liquidityNote: liqNow.note, liquidityHigh: liqNow.liquidityHigh, liquidityLow: liqNow.liquidityLow, atr: atrNow, reason: 'Below threshold' };
  }

  return {
    symbol, side: signal.side, score: finalScore, grade: getGrade(finalScore),
    price: candles.at(-1).close, entry: signal.entry, stopLoss: signal.stopLoss,
    tp1: signal.tp1, tp2: signal.tp2, tp3: signal.tp3,
    breakoutLevel: signal.breakoutLevel, signalAgeBars: age, adx: signal.adx || 0,
    btcRegime: btc.regime, htfRegime,
    liquidityBias: signal.liquidityBias, liquidityNote: signal.liquidityNote,
    liquidityHigh: signal.liquidityHigh, liquidityLow: signal.liquidityLow,
    atr: atrNow, reason: signal.reason,
  };
}

function formatSignal(r) {
  return [
    '🔥 ' + r.symbol + ' ' + r.side,
    r.grade, '',
    '💰 السعر: ' + r.price.toFixed(6),
    '⭐ السكور: ' + r.score + '/100',
    '📈 ADX: ' + (r.adx || 0).toFixed(1),
    '₿ اتجاه BTC: ' + r.btcRegime,
    '🕓 اتجاه 4H: ' + r.htfRegime,
    '💧 اتجاه السيولة: ' + r.liquidityBias,
    '📍 Liquidity High: ' + (r.liquidityHigh ? r.liquidityHigh.toFixed(6) : '-'),
    '📍 Liquidity Low: ' + (r.liquidityLow ? r.liquidityLow.toFixed(6) : '-'),
    '',
    '🎯 Entry: ' + r.entry.toFixed(6),
    '🥇 TP1: ' + r.tp1.toFixed(6),
    '🥈 TP2: ' + r.tp2.toFixed(6),
    '🥉 TP3: ' + r.tp3.toFixed(6),
    '🔴 SL: ' + r.stopLoss.toFixed(6),
    '',
    '🧠 السبب: ' + r.reason,
    '💬 ملاحظة السيولة: ' + r.liquidityNote,
  ].join('\n');
}

function formatLiquidityOnly(symbol, analysis) {
  return [
    '💧 ' + symbol,
    'اتجاه السيولة: ' + analysis.liquidityBias,
    'Liquidity High: ' + (analysis.liquidityHigh ? analysis.liquidityHigh.toFixed(6) : '-'),
    'Liquidity Low: ' + (analysis.liquidityLow ? analysis.liquidityLow.toFixed(6) : '-'),
    'ATR: ' + (analysis.atr ? analysis.atr.toFixed(6) : '-'),
    'ملاحظة: ' + analysis.liquidityNote,
  ].join('\n');
}

async function scanMarket() {
  const btc = await getBTCRegime();
  const results = [];
  for (const symbol of SYMBOLS) {
    try {
      const analysis = await analyzeSymbol(symbol, btc);
      if (analysis.side !== 'flat') results.push(analysis);
    } catch (err) {
      console.log('Skip', symbol, err.message);
    }
    await sleep(SETTINGS.scanDelayMs);
  }
  return results.sort((a, b) => b.score - a.score);
}

async function liquidityNow(symbol) {
  const btc = await getBTCRegime();
  return analyzeSymbol(symbol, btc);
}

async function backtestSymbol(symbol, candles = 700, forwardWindow = 24, step = 1, interval = '1h') {
  const raw = await getKlines(symbol, interval, candles);
  const series = toCandles(raw);
  const built = buildSignals(series);
  const results = [];
  for (let i = 260; i < series.length - forwardWindow; i += step) {
    const sig = built.signals[i];
    if (!sig || sig.side === 'flat') continue;
    if (sig.score < SETTINGS.minScore) continue;
    let outcome = 'none';
    for (let j = i + 1; j <= i + forwardWindow && j < series.length; j++) {
      const high = series[j].high;
      const low = series[j].low;
      if (sig.side === 'Long') {
        if (low <= sig.stopLoss) { outcome = 'SL'; break; }
        if (high >= sig.tp1) { outcome = 'TP1+'; break; }
      } else {
        if (high >= sig.stopLoss) { outcome = 'SL'; break; }
        if (low <= sig.tp1) { outcome = 'TP1+'; break; }
      }
    }
    results.push({ score: sig.score, outcome });
  }
  return results;
}

function gradeBucket(score) {
  if (score >= 90) return '🟢 90+';
  if (score >= 82) return '🔵 82-89';
  if (score >= 72) return '🟡 72-81';
  return '⚪ <72';
}

function buildReport(allResults, label) {
  const buckets = {};
  for (const r of allResults) {
    const key = gradeBucket(r.score);
    if (!buckets[key]) buckets[key] = { win: 0, loss: 0, none: 0 };
    if (r.outcome === 'TP1+') buckets[key].win++;
    else if (r.outcome === 'SL') buckets[key].loss++;
    else buckets[key].none++;
  }
  let report = '📊 باك تست - ' + label + '\n\n';
  report += 'إجمالي الإشارات: ' + allResults.length + '\n\n';
  for (const key of ['🟢 90+', '🔵 82-89', '🟡 72-81', '⚪ <72']) {
    const b = buckets[key];
    if (!b) { report += key + ': لا توجد بيانات\n\n'; continue; }
    const decided = b.win + b.loss;
    const winRate = decided > 0 ? ((b.win / decided) * 100).toFixed(1) : '0.0';
    report += key + '\n✅ TP1+: ' + b.win + '\n❌ SL: ' + b.loss + '\n⏳ غير محسوم: ' + b.none + '\n📌 Win rate: ' + winRate + '%\n\n';
  }
  report += '⚠️ الاختبار مبسط وعلى شموع مغلقة فقط.';
  return report;
}function createBot() {
  if (!BOT_TOKEN) throw new Error('BOT_TOKEN is missing');
  const bot = new TelegramBot(BOT_TOKEN, { polling: true });

  console.log('LIQUIDITY TBP PRO BOT RUNNING');

  bot.on('polling_error', (err) => {
    console.log('POLLING ERROR:', err.code, err.message);
  });

  bot.onText(/\/start/, (msg) => {
    if (!isAllowed(msg.from.id)) return;
    bot.sendMessage(msg.chat.id, 'Liquidity TBP Pro Ready 🚀', mainKeyboard);
  });

  bot.onText(/\/liquidity(?:\s+(.+))?/, async (msg, match) => {
    if (!isAllowed(msg.from.id)) return;
    const symbol = match && match[1] ? match[1].trim().toUpperCase() : 'BTCUSDT';
    try {
      const analysis = await liquidityNow(symbol);
      await bot.sendMessage(msg.chat.id, formatLiquidityOnly(symbol, analysis));
    } catch (err) {
      await bot.sendMessage(msg.chat.id, '❌ حصل خطأ: ' + err.message);
    }
  });

  bot.onText(/\/backtest(?:\s+(.+))?/, async (msg, match) => {
    if (!isAllowed(msg.from.id)) return;
    const symbol = match && match[1] ? match[1].trim().toUpperCase() : 'BTCUSDT';
    try {
      bot.sendMessage(msg.chat.id, '📊 جاري اختبار ' + symbol + '...');
      const results = await backtestSymbol(symbol, 700, 24, 1, '1h');
      if (!results.length) {
        await bot.sendMessage(msg.chat.id, 'لا توجد إشارات كافية للاختبار.');
        return;
      }
      await bot.sendMessage(msg.chat.id, buildReport(results, symbol + ' 1H'));
    } catch (err) {
      await bot.sendMessage(msg.chat.id, '❌ حصل خطأ في الباك تست: ' + err.message);
    }
  });

  bot.on('message', async (msg) => {
    if (!isAllowed(msg.from.id)) return;
    const text = msg.text;
    if (!text) return;

    if (text === '🔍 مسح السوق') {
      try {
        await bot.sendMessage(msg.chat.id, '⏳ جاري مسح السوق مع فلتر السيولة...');
        const results = await scanMarket();
        if (!results.length) {
          await bot.sendMessage(msg.chat.id, 'مفيش فرص قوية حالياً.');
          return;
        }
        for (const r of results.slice(0, SETTINGS.topScanCount)) {
          await bot.sendMessage(msg.chat.id, formatSignal(r));
        }
      } catch (err) {
        await bot.sendMessage(msg.chat.id, '❌ حصل خطأ: ' + err.message);
      }
    }

    if (text === '🚀 أفضل فرصة') {
      try {
        await bot.sendMessage(msg.chat.id, '⏳ جاري تحديد أفضل فرصة...');
        const results = await scanMarket();
        if (!results.length) {
          await bot.sendMessage(msg.chat.id, 'مفيش فرص قوية حالياً.');
          return;
        }
        await bot.sendMessage(msg.chat.id, formatSignal(results[0]));
      } catch (err) {
        await bot.sendMessage(msg.chat.id, '❌ حصل خطأ: ' + err.message);
      }
    }

    if (text === '💧 السيولة الآن') {
      try {
        const analysis = await liquidityNow('BTCUSDT');
        await bot.sendMessage(msg.chat.id, formatLiquidityOnly('BTCUSDT', analysis));
      } catch (err) {
        await bot.sendMessage(msg.chat.id, '❌ حصل خطأ: ' + err.message);
      }
    }

    if (text === 'ℹ️ المساعدة') {
      await bot.sendMessage(msg.chat.id,
        'الأوامر المتاحة:\n' +
        '🔍 مسح السوق - يفحص العملات مع فلتر السيولة\n' +
        '🚀 أفضل فرصة - أقوى إشارة واحدة\n' +
        '💧 السيولة الآن - حالة سيولة BTC\n' +
        '/liquidity BTCUSDT - سيولة عملة معينة\n' +
        '/backtest BTCUSDT - باك تست عملة معينة\n\n' +
        'النظام يعتمد على:\n' +
        '1) اتجاه الترند (3 EMA + ADX)\n' +
        '2) مناطق السيولة أعلى/أسفل\n' +
        '3) Sweep + Rejection أو Acceptance\n' +
        '4) Breakout ثم Pullback ثم Reclaim'
      );
    }
  });

  return bot;
}

if (require.main === module) {
  createBot();
}

module.exports = {
  SETTINGS,
  getLiquidityState,
  buildSignals,
  analyzeSymbol,
  backtestSymbol,
  createBot,
};
