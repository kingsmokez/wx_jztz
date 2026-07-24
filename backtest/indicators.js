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
  return {
    rsi: rsi, goldenCross: macdObj.golden, bollPosition: bollPosition,
    maSignal: maSignal, ma5: ma5, ma10: ma10, ma20: ma20, ma60: ma60,
    change5d: change5d, momentum20: momentum20, macdObj: macdObj,
  }
}

module.exports = {
  calcMA, calcEMA, calcRSI, calcMACD, calcBollPosition, calcTechFromKlines
}
