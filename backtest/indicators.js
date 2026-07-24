/**
 * 技术指标计算 - 从http.js提取的纯计算函数，用于回测
 */

function calcMA(closes, period) {
  if (!closes || closes.length < period) return 0
  var sum = 0
  for (var i = closes.length - period; i < closes.length; i++) sum += closes[i]
  return sum / period
}

function calcEMA(values, period) {
  if (!values || values.length < period) return 0
  var k = 2 / (period + 1)
  var ema = values[0]
  for (var i = 1; i < values.length; i++) ema = values[i] * k + ema * (1 - k)
  return ema
}

function calcRSI(closes, period) {
  if (!closes || closes.length < period + 1) return 50
  var gains = 0, losses = 0
  for (var i = closes.length - period; i < closes.length; i++) {
    var diff = closes[i] - closes[i - 1]
    if (diff > 0) gains += diff; else losses -= diff
  }
  if (losses === 0) return 100
  var rs = (gains / period) / (losses / period)
  return 100 - 100 / (1 + rs)
}

function calcMACD(closes) {
  if (!closes || closes.length < 35) return { dif: 0, dea: 0, macd: 0, golden: false }
  var ema12 = [], ema26 = []
  for (var i = 0; i < closes.length; i++) {
    var slice12 = closes.slice(Math.max(0, i - 11), i + 1)
    var slice26 = closes.slice(Math.max(0, i - 25), i + 1)
    ema12.push(calcEMA(slice12, Math.min(12, slice12.length)))
    ema26.push(calcEMA(slice26, Math.min(26, slice26.length)))
  }
  var difArr = []
  for (var i = 0; i < closes.length; i++) difArr.push(ema12[i] - ema26[i])
  var dea = calcEMA(difArr.slice(-9), 9)
  var dif = difArr[difArr.length - 1]
  var macd = (dif - dea) * 2
  var prevDea = calcEMA(difArr.slice(-10, -1), 9)
  var prevDif = difArr[difArr.length - 2]
  var golden = prevDif <= prevDea && dif > dea
  return { dif: dif, dea: dea, macd: macd, golden: golden }
}

function calcBollPosition(closes) {
  if (!closes || closes.length < 20) return 0.5
  var ma20 = calcMA(closes, 20)
  var slice = closes.slice(-20)
  var variance = 0
  for (var i = 0; i < slice.length; i++) variance += Math.pow(slice[i] - ma20, 2)
  var std = Math.sqrt(variance / 20)
  var upper = ma20 + 2 * std
  var lower = ma20 - 2 * std
  var price = closes[closes.length - 1]
  if (upper === lower) return 0.5
  return Math.max(0, Math.min(1, (price - lower) / (upper - lower)))
}

// ===== 新增：ATR (平均真实波幅) =====
function calcATR(klines, period) {
  if (!klines || klines.length < period + 1) return 0
  var trs = []
  for (var i = klines.length - period; i < klines.length; i++) {
    var k = klines[i], prev = klines[i - 1]
    var tr = Math.max(
      k.high - k.low,
      Math.abs(k.high - prev.close),
      Math.abs(k.low - prev.close)
    )
    trs.push(tr)
  }
  var sum = 0
  for (var i = 0; i < trs.length; i++) sum += trs[i]
  return sum / period
}

// ===== 新增：ADX (平均趋向指数) =====
function calcADX(klines, period) {
  if (!klines || klines.length < period * 2 + 1) return 0
  var plusDM = [], minusDM = [], trs = []
  for (var i = 1; i < klines.length; i++) {
    var cur = klines[i], prev = klines[i - 1]
    var upMove = cur.high - prev.high
    var downMove = prev.low - cur.low
    var pdm = (upMove > downMove && upMove > 0) ? upMove : 0
    var mdm = (downMove > upMove && downMove > 0) ? downMove : 0
    var tr = Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close))
    plusDM.push(pdm); minusDM.push(mdm); trs.push(tr)
  }
  // 平滑
  var smoothTR = trs.slice(-period).reduce(function(a, b) { return a + b }, 0)
  var smoothPlusDM = plusDM.slice(-period).reduce(function(a, b) { return a + b }, 0)
  var smoothMinusDM = minusDM.slice(-period).reduce(function(a, b) { return a + b }, 0)
  if (smoothTR === 0) return 0
  var plusDI = (smoothPlusDM / smoothTR) * 100
  var minusDI = (smoothMinusDM / smoothTR) * 100
  var dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI || 1) * 100
  // 简化ADX为DX的近似
  return { adx: dx, plusDI: plusDI, minusDI: minusDI }
}

// ===== 新增：OBV (能量潮) =====
function calcOBV(klines) {
  if (!klines || klines.length === 0) return { obv: 0, obvSlope5: 0, obvTrend: 0 }
  var obv = 0
  var obvArr = [0]
  for (var i = 1; i < klines.length; i++) {
    if (klines[i].close > klines[i - 1].close) obv += klines[i].volume
    else if (klines[i].close < klines[i - 1].close) obv -= klines[i].volume
    obvArr.push(obv)
  }
  // 5日OBV斜率
  var obvSlope5 = 0
  if (obvArr.length >= 6) {
    var recent5 = obvArr.slice(-5)
    obvSlope5 = (recent5[4] - recent5[0]) / (recent5[0] || 1)
  }
  // 20日OBV趋势
  var obvTrend = 0
  if (obvArr.length >= 21) {
    var recent20 = obvArr.slice(-20)
    var avgFirst5 = (recent20[0] + recent20[1] + recent20[2] + recent20[3] + recent20[4]) / 5
    var avgLast5 = (recent20[15] + recent20[16] + recent20[17] + recent20[18] + recent20[19]) / 5
    obvTrend = avgLast5 > avgFirst5 ? 1 : (avgLast5 < avgFirst5 ? -1 : 0)
  }
  return { obv: obv, obvSlope5: obvSlope5, obvTrend: obvTrend }
}

// ===== 新增：均线斜率 =====
function calcMASlope(closes, period) {
  if (!closes || closes.length < period + 2) return 0
  var ma1 = calcMA(closes.slice(0, -1), period)
  var ma2 = calcMA(closes.slice(0, -2), period)
  if (ma2 === 0) return 0
  return (ma1 - ma2) / ma2 * 100
}

// ===== 新增：形态识别函数 =====

// 1. 杯柄形态：前20日有高点，回调5-15%，缩量，再突破
function detectCupHandle(klines) {
  if (!klines || klines.length < 25) return 0
  var recent = klines.slice(-25)
  var highs = recent.map(function(k) { return k.high })
  var maxHighIdx = 0
  for (var i = 1; i < highs.length - 3; i++) { if (highs[i] > highs[maxHighIdx]) maxHighIdx = i }
  var maxHigh = highs[maxHighIdx]
  var price = recent[recent.length - 1].close
  // 高点必须在5-20天前
  if (maxHighIdx < 3 || maxHighIdx > 22) return 0
  // 回调幅度5-20%
  var afterHigh = recent.slice(maxHighIdx)
  var minLow = Infinity
  for (var i = 0; i < afterHigh.length; i++) { if (afterHigh[i].low < minLow) minLow = afterHigh[i].low }
  var pullback = (maxHigh - minLow) / maxHigh * 100
  if (pullback < 5 || pullback > 20) return 0
  // 回调期间缩量
  var pullbackVols = afterHigh.slice(0, -1).map(function(k) { return k.volume })
  var avgPullbackVol = pullbackVols.reduce(function(a, b) { return a + b }, 0) / pullbackVols.length
  var beforeHighVols = recent.slice(0, maxHighIdx).map(function(k) { return k.volume })
  var avgBeforeVol = beforeHighVols.reduce(function(a, b) { return a + b }, 0) / beforeHighVols.length
  if (avgBeforeVol === 0) return 0
  var volRatio = avgPullbackVol / avgBeforeVol
  // 当天突破
  if (price >= maxHigh * 0.98 && volRatio < 1.0) return 5
  if (price >= maxHigh * 0.98 && volRatio < 1.2) return 3
  return 0
}

// 2. 平台突破：前5-10日横盘，当天放量突破
function detectBreakout(klines) {
  if (!klines || klines.length < 15) return 0
  var recent = klines.slice(-15)
  // 检查前5-10天横盘
  var platform = recent.slice(-11, -1) // 前10天
  var maxHigh = -Infinity, minLow = Infinity
  for (var i = 0; i < platform.length; i++) {
    if (platform[i].high > maxHigh) maxHigh = platform[i].high
    if (platform[i].low < minLow) minLow = platform[i].low
  }
  var platformRange = (maxHigh - minLow) / maxHigh * 100
  if (platformRange > 4) return 0 // 振幅大于4%不算横盘
  var today = recent[recent.length - 1]
  var avgVol = platform.reduce(function(a, b) { return a + b.volume }, 0) / platform.length
  if (avgVol === 0) return 0
  var todayVolRatio = today.volume / avgVol
  // 当天突破平台高点
  if (today.close > maxHigh && todayVolRatio >= 1.5) return 5
  if (today.close > maxHigh * 0.99 && todayVolRatio >= 1.3) return 3
  return 0
}

// 3. 缩量回踩再起涨
function detectPullbackRestart(klines) {
  if (!klines || klines.length < 10) return 0
  var recent = klines.slice(-10)
  // 找5天前放量上涨日
  var surgeIdx = -1
  for (var i = 0; i < recent.length - 3; i++) {
    var chg = (recent[i].close - recent[i].open) / recent[i].open * 100
    if (chg >= 3 && i > 0 && recent[i].volume > recent[i - 1].volume * 1.5) { surgeIdx = i; break }
  }
  if (surgeIdx === -1) return 0
  // 之后缩量回调
  var pullback = recent.slice(surgeIdx + 1, -1)
  if (pullback.length < 1 || pullback.length > 4) return 0
  var allShrink = true
  var avgPullbackVol = 0
  for (var i = 0; i < pullback.length; i++) {
    avgPullbackVol += pullback[i].volume
    if (pullback[i].close > pullback[i].open) allShrink = false
  }
  avgPullbackVol = avgPullbackVol / pullback.length
  var surgeVol = recent[surgeIdx].volume
  if (surgeVol === 0) return 0
  if (avgPullbackVol / surgeVol > 0.8) return 0 // 没有缩量
  // 当天放量上涨
  var today = recent[recent.length - 1]
  var todayChg = (today.close - today.open) / today.open * 100
  if (todayChg >= 1 && today.volume > avgPullbackVol * 1.3) return 5
  if (todayChg >= 0.5 && today.volume > avgPullbackVol * 1.2) return 3
  return 0
}

// 4. 连续小阳吸筹
function detectConsecutiveUp(klines) {
  if (!klines || klines.length < 6) return 0
  var recent = klines.slice(-5)
  var upCount = 0
  var totalChg = 0
  var vols = []
  for (var i = 0; i < recent.length; i++) {
    var chg = (recent[i].close - recent[i].open) / recent[i].open * 100
    if (chg > 0) { upCount++; totalChg += chg }
    vols.push(recent[i].volume)
  }
  // 3-5天连续上涨，每天涨幅0.5-3%
  if (upCount >= 3 && totalChg <= 12) {
    var volIncreasing = vols[vols.length - 1] > vols[0] * 0.9
    if (volIncreasing && upCount >= 4) return 5
    if (volIncreasing) return 3
  }
  return 0
}

// 5. 底部放量长阳
function detectBottomReversal(klines) {
  if (!klines || klines.length < 25) return 0
  var recent = klines.slice(-25)
  var today = recent[recent.length - 1]
  var minClose = Infinity, minIdx = 0
  for (var i = 0; i < recent.length - 1; i++) {
    if (recent[i].close < minClose) { minClose = recent[i].close; minIdx = i }
  }
  // 最低点在5-20天前
  if (minIdx < recent.length - 20 || minIdx > recent.length - 5) return 0
  // 从最低点跌幅
  var firstClose = recent[0].close
  var dropFrom20 = (firstClose - minClose) / firstClose * 100
  if (dropFrom20 < 8) return 0
  // 当天长阳
  var todayChg = (today.close - today.open) / today.open * 100
  if (todayChg < 3) return 0
  // 放量
  var avgVol = recent.slice(0, -1).reduce(function(a, b) { return a + b.volume }, 0) / (recent.length - 1)
  if (avgVol === 0) return 0
  var volRatio = today.volume / avgVol
  if (volRatio >= 2) return 5
  if (volRatio >= 1.5) return 3
  return 0
}

// 6. 均线多头排列+回踩MA10
function detectMASupport(klines) {
  if (!klines || klines.length < 60) return 0
  var closes = klines.map(function(k) { return k.close })
  var ma5 = calcMA(closes, 5), ma10 = calcMA(closes, 10), ma20 = calcMA(closes, 20)
  var price = closes[closes.length - 1]
  // 多头排列
  if (!(ma5 > ma10 && ma10 > ma20)) return 0
  // 回踩MA10
  var ratio = price / ma10
  if (ratio >= 0.97 && ratio <= 1.03) {
    var today = klines[klines.length - 1]
    if (today.close > today.open) return 5
    return 3
  }
  // 回踩MA20
  ratio = price / ma20
  if (ratio >= 0.97 && ratio <= 1.03) {
    var today = klines[klines.length - 1]
    if (today.close > today.open) return 3
  }
  return 0
}

// 综合形态识别
function detectPatterns(klines) {
  return {
    cupHandle: detectCupHandle(klines),
    breakout: detectBreakout(klines),
    pullbackRestart: detectPullbackRestart(klines),
    consecutiveUp: detectConsecutiveUp(klines),
    bottomReversal: detectBottomReversal(klines),
    maSupport: detectMASupport(klines),
  }
}

function calcTechFromKlines(klines) {
  if (!klines || klines.length < 30) {
    return { rsi: 50, goldenCross: false, bollPosition: 0.5, maSignal: "neutral", ma5: 0, ma20: 0, ma60: 0 }
  }
  var closes = klines.map(function(k) { return k.close })
  var rsi = calcRSI(closes, 14)
  var macdObj = calcMACD(closes)
  var bollPosition = calcBollPosition(closes)
  var ma5 = calcMA(closes, 5)
  var ma10 = calcMA(closes, 10)
  var ma20 = calcMA(closes, 20)
  var ma60 = calcMA(closes, 60)
  var maSignal = "neutral"
  if (ma5 > ma10 && ma10 > ma20) maSignal = "bull"
  else if (ma5 < ma10 && ma10 < ma20) maSignal = "bear"
  var change5d = closes.length >= 6 ? (closes[closes.length - 1] / closes[closes.length - 6] - 1) * 100 : 0
  var momentum20 = closes.length >= 21 ? (closes[closes.length - 1] / closes[closes.length - 21] - 1) * 100 : 0

  // 新增指标
  var adxObj = calcADX(klines, 14)
  var obvObj = calcOBV(klines)
  var ma5Slope = calcMASlope(closes, 5)
  var ma10Slope = calcMASlope(closes, 10)
  var atr = calcATR(klines, 14)
  var patterns = detectPatterns(klines)

  return {
    rsi: rsi, goldenCross: macdObj.golden, bollPosition: bollPosition,
    maSignal: maSignal, ma5: ma5, ma10: ma10, ma20: ma20, ma60: ma60,
    change5d: change5d, momentum20: momentum20, macdObj: macdObj,
    adx: adxObj.adx, plusDI: adxObj.plusDI, minusDI: adxObj.minusDI,
    obvTrend: obvObj.obvTrend, obvSlope5: obvObj.obvSlope5,
    ma5Slope: ma5Slope, ma10Slope: ma10Slope, atr: atr,
    patterns: patterns,
  }
}

module.exports = {
  calcMA, calcEMA, calcRSI, calcMACD, calcBollPosition, calcTechFromKlines,
  calcATR, calcADX, calcOBV, calcMASlope, detectPatterns,
  detectCupHandle, detectBreakout, detectPullbackRestart,
  detectConsecutiveUp, detectBottomReversal, detectMASupport,
}
