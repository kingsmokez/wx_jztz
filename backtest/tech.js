/**
 * 技术指标计算 - 与云函数http.js中的calcTechFromKlines保持一致
 */
function calcSMA(values, period) {
  if (values.length < period) return 0
  var sum = 0
  for (var i = values.length - period; i < values.length; i++) sum += values[i]
  return sum / period
}

function calcEMA(values, period) {
  if (values.length < period) return 0
  var k = 2 / (period + 1)
  var ema = values[0]
  for (var i = 1; i < values.length; i++) ema = values[i] * k + ema * (1 - k)
  return ema
}

function calcRSI(closes, period) {
  if (closes.length < period + 1) return 50
  var gains = 0, losses = 0
  for (var i = closes.length - period; i < closes.length; i++) {
    var diff = closes[i] - closes[i - 1]
    if (diff > 0) gains += diff; else losses -= diff
  }
  var avgGain = gains / period, avgLoss = losses / period
  if (avgLoss === 0) return 100
  var rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

function calcMACD(closes) {
  if (closes.length < 26) return { dif: 0, dea: 0, macd: 0, goldenCross: false }
  var ema12 = [], ema26 = []
  for (var i = 0; i < closes.length; i++) {
    ema12.push(calcEMA(closes.slice(0, i + 1), 12))
    ema26.push(calcEMA(closes.slice(0, i + 1), 26))
  }
  var dif = ema12[closes.length - 1] - ema26[closes.length - 1]
  var deaValues = []
  for (var i = 25; i < closes.length; i++) deaValues.push(ema12[i] - ema26[i])
  var dea = calcEMA(deaValues, 9)
  var macd = 2 * (dif - dea)
  var goldenCross = dif > dea
  return { dif: dif, dea: dea, macd: macd, goldenCross: goldenCross }
}

function calcBOLL(closes, period) {
  if (closes.length < period) return { upper: 0, mid: 0, lower: 0, width: 0, position: 0.5 }
  var slice = closes.slice(-period)
  var mid = slice.reduce(function(a, b) { return a + b }, 0) / period
  var variance = slice.reduce(function(a, b) { return a + (b - mid) * (b - mid) }, 0) / period
  var std = Math.sqrt(variance)
  var upper = mid + 2 * std
  var lower = mid - 2 * std
  var width = upper > 0 && lower > 0 ? (upper - lower) / mid : 0
  var price = closes[closes.length - 1]
  var position = upper > lower ? (price - lower) / (upper - lower) : 0.5
  position = Math.max(0, Math.min(1, position))
  return { upper: upper, mid: mid, lower: lower, width: width, position: position }
}

function calcATR(klines, period) {
  if (klines.length < period + 1) return 0
  var trs = []
  for (var i = klines.length - period; i < klines.length; i++) {
    var k = klines[i], prev = klines[i - 1]
    var tr = Math.max(k.high - k.low, Math.abs(k.high - prev.close), Math.abs(k.low - prev.close))
    trs.push(tr)
  }
  return trs.reduce(function(a, b) { return a + b }, 0) / period
}

function calcADX(klines, period) {
  if (klines.length < period * 2 + 1) return { adx: 0, plusDI: 0, minusDI: 0 }
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
  var smoothTR = trs.slice(-period).reduce(function(a, b) { return a + b }, 0)
  var smoothPlusDM = plusDM.slice(-period).reduce(function(a, b) { return a + b }, 0)
  var smoothMinusDM = minusDM.slice(-period).reduce(function(a, b) { return a + b }, 0)
  if (smoothTR === 0) return { adx: 0, plusDI: 0, minusDI: 0 }
  var plusDI = (smoothPlusDM / smoothTR) * 100
  var minusDI = (smoothMinusDM / smoothTR) * 100
  var dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI || 1) * 100
  return { adx: dx, plusDI: plusDI, minusDI: minusDI }
}

function calcTech(klines) {
  if (!klines || klines.length < 30) return null
  var closes = klines.map(function(k) { return k.close })
  var ma5 = calcSMA(closes, 5)
  var ma10 = calcSMA(closes, 10)
  var ma20 = calcSMA(closes, 20)
  var ma60 = closes.length >= 60 ? calcSMA(closes, 60) : ma20
  var rsi = calcRSI(closes, 14)
  var macd = calcMACD(closes)
  var boll = calcBOLL(closes, 20)
  var adx = calcADX(klines, 14)
  var price = closes[closes.length - 1]
  var ma5Slope = ma5 > 0 ? (price - ma5) / ma5 * 100 : 0
  var ma10Slope = ma10 > 0 ? (price - ma10) / ma10 * 100 : 0
  var maSignal = (price > ma5 && ma5 > ma10 && ma10 > ma20) ? 'bull' : (price < ma5 && ma5 < ma10) ? 'bear' : 'neutral'
  var momentum5d = closes.length >= 6 ? (price - closes[closes.length - 6]) / closes[closes.length - 6] * 100 : 0
  return {
    ma5: ma5, ma10: ma10, ma20: ma20, ma60: ma60, rsi: rsi,
    macd: macd.macd, goldenCross: macd.goldenCross,
    bollWidth: boll.width, bollPosition: boll.position,
    adx: adx.adx, plusDI: adx.plusDI, minusDI: adx.minusDI,
    ma5Slope: ma5Slope, ma10Slope: ma10Slope, maSignal: maSignal,
    momentum5d: momentum5d,
  }
}

function calcConsecutiveUpDays(klines) {
  if (!klines || klines.length < 2) return 0
  var count = 0
  for (var i = klines.length - 1; i >= 1; i--) {
    if (klines[i].close > klines[i - 1].close) count++
    else break
  }
  return count
}

function calcPricePositionVsHigh(klines) {
  if (!klines || klines.length < 20) return 0
  var high60 = -Infinity
  var startIdx = Math.max(0, klines.length - 60)
  for (var i = startIdx; i < klines.length; i++) {
    if (klines[i].high > high60) high60 = klines[i].high
  }
  if (high60 <= 0) return 0
  return klines[klines.length - 1].close / high60
}

function calcRelativeStrength(klines) {
  if (!klines || klines.length < 21) return 0
  var today = klines[klines.length - 1].close
  var day20 = klines[klines.length - 21].close
  if (day20 <= 0) return 0
  return (today - day20) / day20 * 100
}

module.exports = {
  calcSMA: calcSMA, calcEMA: calcEMA, calcRSI: calcRSI, calcMACD: calcMACD,
  calcBOLL: calcBOLL, calcATR: calcATR, calcADX: calcADX, calcTech: calcTech,
  calcConsecutiveUpDays: calcConsecutiveUpDays,
  calcPricePositionVsHigh: calcPricePositionVsHigh,
  calcRelativeStrength: calcRelativeStrength,
}
