const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function calcMA(prices, period) {
  if (prices.length < period) return new Array(prices.length).fill(null)
  const result = new Array(period - 1).fill(null)
  for (let i = period - 1; i < prices.length; i++) {
    const window = prices.slice(i - period + 1, i + 1)
    result.push(Math.round(window.reduce((a, b) => a + b, 0) / period * 100) / 100)
  }
  return result
}

function calcEMA(prices, period) {
  if (prices.length < period) return new Array(prices.length).fill(null)
  const k = 2 / (period + 1)
  const result = new Array(period - 1).fill(null)
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period
  result.push(Math.round(ema * 100) / 100)
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k)
    result.push(Math.round(ema * 100) / 100)
  }
  return result
}

function calcMACD(prices, fast = 12, slow = 26, signal = 9) {
  const emaFast = calcEMA(prices, fast)
  const emaSlow = calcEMA(prices, slow)
  const dif = []
  for (let i = 0; i < emaFast.length; i++) {
    if (emaFast[i] !== null && emaSlow[i] !== null) dif.push(Math.round((emaFast[i] - emaSlow[i]) * 10000) / 10000)
    else dif.push(null)
  }
  const difValues = dif.filter(d => d !== null)
  const deaFull = difValues.length >= signal ? calcEMA(difValues, signal) : new Array(difValues.length).fill(null)
  const dea = new Array(dif.length - deaFull.length).fill(null).concat(deaFull)
  const macdHist = []
  for (let i = 0; i < dif.length; i++) {
    if (dif[i] !== null && dea[i] !== null) macdHist.push(Math.round(2 * (dif[i] - dea[i]) * 10000) / 10000)
    else macdHist.push(null)
  }
  return { dif, dea, macd: macdHist }
}

function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return new Array(prices.length).fill(null)
  const result = new Array(period).fill(null)
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1]
    if (change > 0) avgGain += change; else avgLoss += Math.abs(change)
  }
  avgGain /= period; avgLoss /= period
  const rsi0 = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  result.push(Math.round(rsi0 * 100) / 100)
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1]
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
    result.push(Math.round(rsi * 100) / 100)
  }
  return result
}

function calcKDJ(highs, lows, closes, n = 9, m1 = 3, m2 = 3) {
  const len = closes.length
  if (len < n) return { k: [], d: [], j: [] }
  const kArr = [], dArr = [], jArr = []
  let prevK = 50, prevD = 50
  for (let i = 0; i < len; i++) {
    if (i < n - 1) { kArr.push(null); dArr.push(null); jArr.push(null); continue }
    const highSlice = highs.slice(i - n + 1, i + 1)
    const lowSlice = lows.slice(i - n + 1, i + 1)
    const highest = Math.max(...highSlice), lowest = Math.min(...lowSlice)
    const rsv = highest === lowest ? 50 : (closes[i] - lowest) / (highest - lowest) * 100
    const k = (2 / m1) * prevK + (1 / m1) * rsv
    const d = (2 / m2) * prevD + (1 / m2) * k
    const j = 3 * k - 2 * d
    kArr.push(Math.round(k * 100) / 100); dArr.push(Math.round(d * 100) / 100); jArr.push(Math.round(j * 100) / 100)
    prevK = k; prevD = d
  }
  return { k: kArr, d: dArr, j: jArr }
}

function calcBOLL(prices, period = 20, multiplier = 2) {
  if (prices.length < period) return { upper: [], middle: [], lower: [] }
  const middle = calcMA(prices, period)
  const upper = [], lower = []
  for (let i = 0; i < prices.length; i++) {
    if (middle[i] === null) { upper.push(null); lower.push(null); continue }
    const window = prices.slice(i - period + 1, i + 1)
    const mean = middle[i]
    const variance = window.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / period
    const stdDev = Math.sqrt(variance)
    upper.push(Math.round((mean + multiplier * stdDev) * 100) / 100)
    lower.push(Math.round((mean - multiplier * stdDev) * 100) / 100)
  }
  return { upper, middle, lower }
}

function calculateTechnicalIndicators(klineData) {
  if (!klineData || klineData.length < 20) return null
  const closes = klineData.map(k => k.close)
  const highs = klineData.map(k => k.high)
  const lows = klineData.map(k => k.low)
  const volumes = klineData.map(k => k.volume || 0)
  const last = closes.length - 1

  const ma5 = calcMA(closes, 5), ma10 = calcMA(closes, 10), ma20 = calcMA(closes, 20), ma60 = calcMA(closes, 60)
  const macdData = calcMACD(closes)
  const rsi6 = calcRSI(closes, 6), rsi14 = calcRSI(closes, 14)
  const kdjData = calcKDJ(highs, lows, closes)
  const bollData = calcBOLL(closes)

  const lastRSI = rsi14[last] || 50
  const lastDIF = macdData.dif[last], lastDEA = macdData.dea[last], lastMACD = macdData.macd[last]
  const lastK = kdjData.k[last], lastD = kdjData.d[last], lastJ = kdjData.j[last]

  let goldenCross = false
  if (macdData.dif.length >= 2) {
    const prevDIF = macdData.dif[last - 1], prevDEA = macdData.dea[last - 1]
    if (prevDIF != null && prevDEA != null && lastDIF != null && lastDEA != null) {
      if (prevDIF <= prevDEA && lastDIF > lastDEA) goldenCross = true
    }
  }

  const bullAlign = ma5[last] && ma10[last] && ma20[last] && ma5[last] > ma10[last] && ma10[last] > ma20[last]
  const bearAlign = ma5[last] && ma10[last] && ma20[last] && ma5[last] < ma10[last] && ma10[last] < ma20[last]

  let bollPosition = 0.5
  if (bollData.upper[last] && bollData.lower[last]) {
    const range = bollData.upper[last] - bollData.lower[last]
    if (range > 0) bollPosition = (closes[last] - bollData.lower[last]) / range
  }

  const momentum20 = closes.length >= 21 && closes[last - 20] > 0
    ? Math.round((closes[last] - closes[last - 20]) / closes[last - 20] * 10000) / 100 : 0
  const change5d = closes.length >= 6 && closes[last - 5] > 0
    ? Math.round((closes[last] - closes[last - 5]) / closes[last - 5] * 10000) / 100 : 0

  return {
    rsi: lastRSI, rsi6: rsi6[last], macd: lastMACD, dif: lastDIF, dea: lastDEA,
    k: lastK, d: lastD, j: lastJ,
    ma5: ma5[last], ma10: ma10[last], ma20: ma20[last], ma60: ma60[last],
    bollUpper: bollData.upper[last], bollMiddle: bollData.middle[last], bollLower: bollData.lower[last],
    bollPosition: Math.round(bollPosition * 100) / 100,
    goldenCross, momentum20, change5d,
    ma: { bullAlign: !!bullAlign, bearAlign: !!bearAlign, ma5: ma5[last], ma10: ma10[last], ma20: ma20[last] },
    macdObj: { goldenCross, dif: lastDIF, dea: lastDEA, macd: lastMACD },
  }
}

exports.main = async (event, context) => {
  const { action, data } = event
  try {
    switch (action) {
      case 'calculate': {
        const result = calculateTechnicalIndicators(data.klineData)
        return { success: true, data: result }
      }
      default: return { success: false, error: '未知操作' }
    }
  } catch (err) {
    console.error('techIndicator error:', err)
    return { success: false, error: err.message }
  }
}
