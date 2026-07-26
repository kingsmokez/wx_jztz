// run_v79.js - V79策略回测: MACD金叉+多条件组合深度优化
// V78发现: MACD金叉确认WR=86.84%, 但需要更多组合确认来提高WR
// V79目标: MACD金叉+双重/三重确认组合, 目标WR>88% AR>4%
// 方法: MACD金叉+OBV/MA20/MA支撑/柱状图/放量确认+多种止盈组合
var fs = require('fs')
var path = require('path')

var CONFIG = {
  holdDays: [3, 5, 7, 10],
  topN: 20,
  minScore: 55,
  cacheDir: path.join(__dirname, 'cache'),
  outputDir: path.join(__dirname, 'results'),
}

if (!fs.existsSync(CONFIG.outputDir)) fs.mkdirSync(CONFIG.outputDir, { recursive: true })

var { calcTechFromKlines, calcVolumePriceCoord, calcTrendAcceleration, detectConsolidationBreakout, calcCandlePatterns, calcMA, calcADX, calcOBV, calcEMA, calcATR, calcMASlope, calcBollPosition, calcRSI } = require('./indicators')
var { getLimitPct, calcTechScoreV10, calcTechScoreV31 } = require('./scoring')

function preFilter(stock) {
  if (stock.price <= 3 || stock.price > 200) return false
  var limitPct = getLimitPct(stock.code)
  if (stock.changePct < -2 || stock.changePct > limitPct) return false
  return true
}

function calcVolumeRatioFromKlines(klines, dateIdx) {
  if (dateIdx < 5 || dateIdx >= klines.length) return 0
  var todayVol = klines[dateIdx].volume
  if (todayVol <= 0) return 0
  var sumVol = 0, count = 0
  for (var i = dateIdx - 5; i < dateIdx; i++) {
    if (klines[i].volume > 0) { sumVol += klines[i].volume; count++ }
  }
  if (count === 0 || sumVol === 0) return 0
  return Math.round(todayVol / (sumVol / count) * 10000) / 100
}

function calcBollWidth(closes) {
  if (!closes || closes.length < 20) return 0.1
  var ma20 = 0
  for (var i = closes.length - 20; i < closes.length; i++) ma20 += closes[i]
  ma20 /= 20
  if (ma20 <= 0) return 0.1
  var variance = 0
  for (var i = closes.length - 20; i < closes.length; i++) variance += Math.pow(closes[i] - ma20, 2)
  var std = Math.sqrt(variance / 20)
  return (2 * std) / ma20
}

function detectNarrowRange(klines, dateIdx, days, maxAmplitude) {
  if (dateIdx < days || dateIdx >= klines.length) return false
  var high = -Infinity, low = Infinity
  for (var i = dateIdx - days; i < dateIdx; i++) {
    if (klines[i].high > high) high = klines[i].high
    if (klines[i].low < low) low = klines[i].low
  }
  if (low <= 0) return false
  return ((high - low) / low * 100) <= maxAmplitude
}

function detectShrinkPullback(klines, dateIdx, lookback) {
  if (!lookback) lookback = 5
  if (dateIdx < lookback + 2 || dateIdx >= klines.length) return { detected: false, shrinkRatio: 0 }
  var surgeIdx = -1, surgeVol = 0
  for (var i = dateIdx - lookback; i < dateIdx - 1; i++) {
    var chg = (klines[i].close - klines[i - 1].close) / klines[i - 1].close * 100
    if (chg >= 2 && klines[i].volume > surgeVol) { surgeIdx = i; surgeVol = klines[i].volume }
  }
  if (surgeIdx === -1 || surgeVol <= 0) return { detected: false, shrinkRatio: 0 }
  var pullbackVols = [], pullbackDown = 0
  for (var i = surgeIdx + 1; i < dateIdx; i++) {
    pullbackVols.push(klines[i].volume)
    if (klines[i].close < klines[i - 1].close) pullbackDown++
  }
  if (pullbackVols.length === 0) return { detected: false, shrinkRatio: 0 }
  var avgPullbackVol = 0
  for (var i = 0; i < pullbackVols.length; i++) avgPullbackVol += pullbackVols[i]
  avgPullbackVol /= pullbackVols.length
  var shrinkRatio = avgPullbackVol / surgeVol
  return { detected: shrinkRatio < 0.7 && pullbackDown >= pullbackVols.length * 0.5, shrinkRatio: shrinkRatio, surgeIdx: surgeIdx }
}

// V73原始calcPatternScore + 支持可调boll宽度
function calcPatternScoreV79(stock, klines, dateIdx, tech, volumeRatio, bollWidthMax) {
  if (!klines || dateIdx < 20 || !tech) return { pattern: 'none', score: 0 }
  var closes = []
  for (var i = 0; i <= dateIdx; i++) closes.push(klines[i].close)
  var chg = stock.changePct || 0
  var bestScore = 0, bestPattern = 'none'
  var ma5 = tech.ma5 || 0, ma10 = tech.ma10 || 0, ma20 = tech.ma20 || 0
  var ma5Slope = tech.ma5Slope || 0, ma10Slope = tech.ma10Slope || 0
  var rsi = tech.rsi || 50, bollPos = tech.bollPosition || 0.5
  var price = stock.price || klines[dateIdx].close
  var bwMax = bollWidthMax || 0.08

  var prevHigh = dateIdx > 0 ? klines[dateIdx - 1].high : 0
  var todayOpen = klines[dateIdx].open
  var isGapUp = prevHigh > 0 && todayOpen > prevHigh
  if (isGapUp && chg >= 1 && ma5Slope > 0.1 && ma10Slope > 0) {
    var s = 20
    if (chg >= 2 && chg <= 5) s = 25
    if (volumeRatio >= 1.5 && volumeRatio <= 4) s += 5
    if (rsi >= 50 && rsi <= 70) s += 3
    if (s > bestScore) { bestScore = s; bestPattern = 'gapUp' }
  }

  var narrow5 = detectNarrowRange(klines, dateIdx, 5, 5)
  var narrow8 = detectNarrowRange(klines, dateIdx, 8, 6)
  if ((narrow5 || narrow8) && chg >= 1 && volumeRatio >= 1.3) {
    var s = 15
    if (narrow5) s += 5
    if (chg >= 2) s += 3
    if (volumeRatio >= 1.8) s += 3
    if (price > ma20) s += 2
    if (s > bestScore) { bestScore = s; bestPattern = 'platform_break' }
  }

  if (tech.maSignal === 'bull' && ma5Slope > 0.15 && chg >= 1 && chg <= 5) {
    var s = 15
    if (volumeRatio >= 1.2 && volumeRatio <= 4) s += 5
    if (rsi >= 45 && rsi <= 70) s += 5
    if (ma5Slope > 0.25) s += 3
    if (tech.adx >= 25) s += 3
    if (bollPos >= 0.6 && bollPos <= 0.85) s += 2
    if (s > bestScore) { bestScore = s; bestPattern = 'trend_accel' }
  }

  var pullback = detectShrinkPullback(klines, dateIdx, 6)
  if (pullback.detected && chg >= 1 && volumeRatio >= 1.5) {
    var s = 16
    if (price > ma10 && price < ma10 * 1.05) s += 5
    if (rsi >= 40 && rsi <= 65) s += 4
    if (chg >= 2) s += 3
    if (volumeRatio >= 2) s += 2
    if (s > bestScore) { bestScore = s; bestPattern = 'pullback_restart' }
  }

  var bollWidth = calcBollWidth(closes)
  if (bollWidth < bwMax && chg >= 1.5 && volumeRatio >= 1.5 && ma5Slope > 0) {
    var s = 15
    if (bollPos > 0.8) s += 5
    if (bollWidth < 0.05) s += 4
    if (volumeRatio >= 2) s += 3
    if (rsi >= 50 && rsi <= 70) s += 3
    if (s > bestScore) { bestScore = s; bestPattern = 'boll_squeeze' }
  }

  return { pattern: bestPattern, score: bestScore, isGapUp: isGapUp }
}

// V75二次确认检测 (复用)
function confirmADX(tech, threshold) { return tech.adx >= (threshold || 25) }
function confirmMACDGolden(tech) { return tech.goldenCross === true }
function confirmOBVUp(tech) { return tech.obvTrend === 'up' }
function confirmHighVolume(volumeRatio, threshold) { return volumeRatio >= (threshold || 2.0) }

function confirmMASupport(klines, dateIdx, tech) {
  if (dateIdx < 3 || !tech.ma5 || !tech.ma10) return false
  var price = klines[dateIdx].close
  var nearMA5 = price >= tech.ma5 * 0.98 && price <= tech.ma5 * 1.02
  var nearMA10 = price >= tech.ma10 * 0.97 && price <= tech.ma10 * 1.03
  var todayUp = klines[dateIdx].close > klines[dateIdx].open
  return (nearMA5 || nearMA10) && todayUp
}

function confirmShrinkRestart(klines, dateIdx) {
  if (dateIdx < 8) return false
  var surgeIdx = -1, surgeVol = 0
  for (var i = dateIdx - 7; i < dateIdx - 1; i++) {
    var chg = (klines[i].close - klines[i - 1].close) / klines[i - 1].close * 100
    if (chg >= 3 && klines[i].volume > surgeVol) { surgeIdx = i; surgeVol = klines[i].volume }
  }
  if (surgeIdx === -1 || surgeVol <= 0) return false
  var pullbackVols = []
  for (var i = surgeIdx + 1; i < dateIdx; i++) pullbackVols.push(klines[i].volume)
  if (pullbackVols.length === 0) return false
  var avgPB = 0
  for (var i = 0; i < pullbackVols.length; i++) avgPB += pullbackVols[i]
  avgPB /= pullbackVols.length
  var todayVol = klines[dateIdx].volume
  var todayChg = (klines[dateIdx].close - klines[dateIdx - 1].close) / klines[dateIdx - 1].close * 100
  return avgPB < surgeVol * 0.5 && todayVol > avgPB * 1.3 && todayChg > 0.5
}

// 新增: MACD柱状图由负转正或持续为正(DIF>DEA)
function confirmMACDPositive(tech) {
  if (!tech.macdObj) return false
  return tech.macdObj.histogram > 0
}

// 新增: 价格在MA20之上
function confirmAboveMA20(klines, dateIdx, tech) {
  if (!tech.ma20 || dateIdx < 1) return false
  return klines[dateIdx].close > tech.ma20
}

function calcConsecutiveUpDays(klines, dateIdx) {
  if (dateIdx < 1) return 0
  var count = 0
  for (var i = dateIdx; i >= 1; i--) {
    if (klines[i].close > klines[i - 1].close) count++
    else break
  }
  return count
}

function calcMarketEnv(allDayQuotes, tradeDates, currentIdx) {
  var recent20Dates = tradeDates.slice(Math.max(0, currentIdx - 20), currentIdx)
  if (recent20Dates.length < 5) return { trend: 'neutral', volatility: 0 }
  var avgChanges = []
  for (var i = 0; i < recent20Dates.length; i++) {
    var dq = allDayQuotes[recent20Dates[i]]
    if (!dq || dq.length === 0) continue
    var avgChg = 0
    for (var j = 0; j < dq.length; j++) avgChg += (dq[j].changePct || 0)
    avgChg = avgChg / dq.length
    avgChanges.push(avgChg)
  }
  if (avgChanges.length === 0) return { trend: 'neutral', volatility: 0 }
  var sum = 0
  for (var i = 0; i < avgChanges.length; i++) sum += avgChanges[i]
  var mean = sum / avgChanges.length
  var variance = 0
  for (var i = 0; i < avgChanges.length; i++) variance += (avgChanges[i] - mean) * (avgChanges[i] - mean)
  var volatility = Math.sqrt(variance / avgChanges.length)
  var trend = 'neutral'
  if (mean > 0.5) trend = 'bull'
  else if (mean < -0.3) trend = 'bear'
  return { trend: trend, volatility: volatility, avgChange: mean }
}

function calcRelativeStrength(klines, dateIdx) {
  if (dateIdx < 20) return 0
  return (klines[dateIdx].close - klines[dateIdx - 20].close) / klines[dateIdx - 20].close * 100
}

function calcPricePositionVsHigh(klines, dateIdx) {
  if (dateIdx < 20) return 0
  var high60 = -Infinity
  var startIdx = Math.max(0, dateIdx - 60)
  for (var i = startIdx; i <= dateIdx; i++) { if (klines[i].high > high60) high60 = klines[i].high }
  if (high60 <= 0) return 0
  return klines[dateIdx].close / high60
}

var V43B_PARAMS = {
  v31Weight: 0.75, v10Weight: 0.25, adaptiveMarket: true, morphBonus: true,
  softVolConfirm: true, volPenalty: 0.9, dynamicConsec: true,
  consecBear: 3, consecNeutral: 5, consecBull: 6,
  pricePosFilter: true, pricePosThreshold: 0.95,
  rsFilter: true, rsThreshold: 6,
  volumeRatioFilter: true, volumeRatioMin: 1.5,
  _minScore: 55
}

function simulatePickV79(dayQuotes, klineMap, dateIdxMap, topN, marketEnv, strategy) {
  var params = V43B_PARAMS
  var minScore = strategy.minScore || 55
  var scored = []
  var adxThreshold = 20, bollThreshold = 0.85, maxConsecUp = 5
  if (params.adaptiveMarket && marketEnv) {
    if (marketEnv.trend === "bear") {
      adxThreshold = Math.max(20, adxThreshold + 8)
      bollThreshold = Math.max(0.70, bollThreshold - 0.15)
      if (params.dynamicConsec) maxConsecUp = params.consecBear || 3
    } else if (marketEnv.trend === "bull") {
      bollThreshold = Math.min(0.92, bollThreshold + 0.05)
      if (params.dynamicConsec) maxConsecUp = params.consecBull || 6
    } else { if (params.dynamicConsec) maxConsecUp = params.consecNeutral || 5 }
  }

  for (var i = 0; i < dayQuotes.length; i++) {
    var stock = dayQuotes[i]
    if (!preFilter(stock)) continue
    var code = stock.code
    var klines = klineMap[code]
    var dateIdx = dateIdxMap[code]
    if (!klines || dateIdx === undefined || dateIdx < 20) continue

    var volumeRatio = stock.volumeRatio || 0
    if (volumeRatio <= 0) volumeRatio = calcVolumeRatioFromKlines(klines, dateIdx)
    if (volumeRatio <= 0) continue

    var techSlice = klines.slice(0, dateIdx + 1)
    var tech = calcTechFromKlines(techSlice)
    if (!tech) continue

    if (strategy.ma5Min !== undefined && tech.ma5Slope < strategy.ma5Min) continue
    if (strategy.ma10Min !== undefined && tech.ma10Slope < strategy.ma10Min) continue
    var rs = calcRelativeStrength(klines, dateIdx)
    if (strategy.rsMin && rs < strategy.rsMin) continue
    if (strategy.vrMin && volumeRatio < strategy.vrMin) continue
    if (strategy.rsiMax && tech.rsi > strategy.rsiMax) continue
    if (strategy.adxMin && tech.adx < strategy.adxMin) continue
    if (strategy.chgMax && stock.changePct > strategy.chgMax) continue
    if (strategy.chgMin && stock.changePct < strategy.chgMin) continue

    var pricePos = calcPricePositionVsHigh(klines, dateIdx)
    var ppThreshold = strategy.pricePosThreshold || 0.95
    if (pricePos > ppThreshold) continue
    if (volumeRatio < (strategy.vrMin || 1.5)) continue

    var v31Score = calcTechScoreV31(stock, tech.rsi, tech.goldenCross, volumeRatio, tech.bollPosition, code, tech.maSignal, tech.change5d || 0)
    var v10Score = calcTechScoreV10(stock, tech.rsi, tech.goldenCross, volumeRatio, tech.bollPosition, code, tech.maSignal, tech.change5d || 0)
    var techScore = v31Score * (strategy.v31W || 0.75) + v10Score * (strategy.v10W || 0.25)

    var patternResult = calcPatternScoreV79(stock, klines, dateIdx, tech, volumeRatio, strategy.bollWidthMax)
    var patternScore = patternResult.score
    var patternName = patternResult.pattern

    if (strategy.requirePattern && patternName !== strategy.requirePattern) continue

    // 二次确认
    if (strategy.confirmADX && !confirmADX(tech, strategy.confirmADX)) continue
    if (strategy.confirmMACD && !confirmMACDGolden(tech)) continue
    if (strategy.confirmMACDPos && !confirmMACDPositive(tech)) continue
    if (strategy.confirmMASupport && !confirmMASupport(klines, dateIdx, tech)) continue
    if (strategy.confirmOBV && !confirmOBVUp(tech)) continue
    if (strategy.confirmHighVolume && !confirmHighVolume(volumeRatio, strategy.confirmHighVolume)) continue
    if (strategy.confirmAboveMA20 && !confirmAboveMA20(klines, dateIdx, tech)) continue

    var consecUp = calcConsecutiveUpDays(klines, dateIdx)
    if (consecUp > maxConsecUp) continue

    var totalScore = techScore + patternScore * (strategy.patternWeight || 1.0)
    var mildBonus = 0
    var chg = stock.changePct || 0
    if (chg >= 1 && chg < 3 && volumeRatio >= 1 && volumeRatio < 2) mildBonus = 8
    else if (chg >= 0.5 && chg < 1 && volumeRatio >= 1 && volumeRatio < 1.5) mildBonus = 4
    totalScore += mildBonus
    if (tech.bollPosition > bollThreshold) totalScore *= params.volPenalty || 0.9
    if (tech.obvTrend === 'up') totalScore += 3
    if (tech.adx >= adxThreshold) totalScore += 2
    if (totalScore < minScore) continue

    scored.push({
      code: code, name: stock.name, price: stock.price || klines[dateIdx].close,
      changePct: stock.changePct || 0, totalScore: totalScore,
      techScore: techScore, patternScore: patternScore, patternName: patternName,
      volumeRatio: volumeRatio, rsi: tech.rsi, isGapUp: patternResult.isGapUp,
      ma5Slope: tech.ma5Slope, ma10Slope: tech.ma10Slope,
      bollPosition: tech.bollPosition, adx: tech.adx
    })
  }

  scored.sort(function(a, b) { return b.totalScore - a.totalScore })
  var industryCount = {}
  var result = []
  for (var i = 0; i < scored.length && result.length < topN; i++) {
    var ind = scored[i].patternName || 'other'
    industryCount[ind] = (industryCount[ind] || 0) + 1
    if (industryCount[ind] <= 3) result.push(scored[i])
  }
  return result
}

function calcDynamicExit(buyPrice, klines, buyIdx, maxHoldDays, stopLoss, trailingRules) {
  var maxReturn = 0, exitPrice = buyPrice, exitDay = 1
  var exitReason = 'max_hold', highestPrice = buyPrice
  for (var d = 1; d <= maxHoldDays; d++) {
    var idx = buyIdx + d
    if (idx >= klines.length) break
    var price = klines[idx].close
    var high = klines[idx].high
    if (high > highestPrice) highestPrice = high
    var returnPct = (price - buyPrice) / buyPrice * 100
    var maxRet = (highestPrice - buyPrice) / buyPrice * 100
    if (maxRet > maxReturn) maxReturn = maxRet
    if (stopLoss && stopLoss < 0 && returnPct <= stopLoss) { exitPrice = price; exitDay = d; exitReason = 'stop_loss'; break }
    var trailingPct = 0
    for (var t = trailingRules.length - 1; t >= 0; t--) {
      if (maxRet >= trailingRules[t].profitPct) { trailingPct = trailingRules[t].trailingPct; break }
    }
    if (trailingPct > 0) {
      var drawdown = maxRet - returnPct
      if (drawdown >= trailingPct) { exitPrice = price; exitDay = d; exitReason = 'trailing'; break }
    }
    exitPrice = price; exitDay = d
  }
  var finalReturn = (exitPrice - buyPrice) / buyPrice * 100
  return { exitPrice: exitPrice, exitDay: exitDay, finalReturn: finalReturn, exitReason: exitReason, maxReturn: maxReturn }
}

function calcDynamicStats(picks) {
  if (picks.length === 0) return { total: 0, winRate: 0, avgReturn: 0, avgExitDay: 0, avgMaxReturn: 0 }
  var wins = 0, totalReturn = 0, totalDays = 0, totalMaxRet = 0
  for (var i = 0; i < picks.length; i++) {
    if (picks[i].finalReturn > 0) wins++
    totalReturn += picks[i].finalReturn
    totalDays += picks[i].exitDay
    totalMaxRet += picks[i].maxReturn || 0
  }
  return {
    total: picks.length,
    winRate: Math.round(wins / picks.length * 10000) / 100,
    avgReturn: Math.round(totalReturn / picks.length * 100) / 100,
    avgExitDay: Math.round(totalDays / picks.length * 100) / 100,
    avgMaxReturn: Math.round(totalMaxRet / picks.length * 100) / 100
  }
}

var BASE_EXIT = {
  stopLoss: -100,
  trailingRules: [{ profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }],
  maxHoldDays: 21
}

// V79策略: MACD金叉+多条件组合深度优化
// V78最佳: v78_vr12_macd WR=86.84% AR=4.24% n=38
// V79方向: MACD金叉+OBV/MA20/MA支撑/柱状图/放量双重确认
var V79_STRATEGIES = {
  // === V78最优复现 ===
  "v79_v78base": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: "boll_squeeze",
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true
  }),

  // === MACD金叉 + OBV上升(量价配合) ===
  "v79_macd_obv": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: "boll_squeeze",
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmOBV: true
  }),
  "v79_macd_obv_4710": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: "boll_squeeze",
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmOBV: true,
    trailingRules: [{ profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }]
  }),

  // === MACD金叉 + MA20支撑(中期趋势) ===
  "v79_macd_ma20": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: "boll_squeeze",
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmAboveMA20: true
  }),
  "v79_macd_ma20_4710": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: "boll_squeeze",
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmAboveMA20: true,
    trailingRules: [{ profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }]
  }),

  // === MACD金叉 + MA支撑(短期均线支撑) ===
  "v79_macd_masup": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: "boll_squeeze",
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmMASupport: true
  }),

  // === MACD金叉 + 柱状图正(DIF>DEA更强确认) ===
  "v79_macd_histpos": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: "boll_squeeze",
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmMACDPos: true
  }),
  "v79_macd_histpos_4710": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: "boll_squeeze",
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmMACDPos: true,
    trailingRules: [{ profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }]
  }),

  // === MACD金叉 + 放量(量比>=2.0) ===
  "v79_macd_vol": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: "boll_squeeze",
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.5, rsiMax: 60,
    confirmMACD: true, confirmHighVolume: 2.0
  }),

  // === MACD金叉 + OBV + MA20(三重确认) ===
  "v79_macd_obv_ma20": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: "boll_squeeze",
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmOBV: true, confirmAboveMA20: true
  }),
  "v79_macd_obv_ma20_4710": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: "boll_squeeze",
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmOBV: true, confirmAboveMA20: true,
    trailingRules: [{ profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }]
  }),

  // === MACD金叉 + 柱状图正 + OBV(最强确认) ===
  "v79_macd_histpos_obv": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: "boll_squeeze",
    minScore: 50, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmMACDPos: true, confirmOBV: true
  }),

  // === 放宽boll + MACD金叉 + MA20 ===
  "v79_bw10_macd_ma20": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: "boll_squeeze",
    minScore: 53, patternWeight: 2.0, bollWidthMax: 0.10,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmAboveMA20: true
  }),
  "v79_bw10_macd_ma20_4710": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: "boll_squeeze",
    minScore: 53, patternWeight: 2.0, bollWidthMax: 0.10,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmAboveMA20: true,
    trailingRules: [{ profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }]
  }),

  // === 放宽boll + MACD金叉 + OBV ===
  "v79_bw10_macd_obv": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: "boll_squeeze",
    minScore: 53, patternWeight: 2.0, bollWidthMax: 0.10,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmOBV: true
  }),

  // === 放宽涨幅 + MACD金叉 + MA20 ===
  "v79_chg1_3_macd_ma20": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: "boll_squeeze",
    minScore: 53, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 3, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmAboveMA20: true
  }),

  // === 放宽涨幅 + MACD金叉 + OBV ===
  "v79_chg1_3_macd_obv": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: "boll_squeeze",
    minScore: 53, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 3, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmOBV: true
  }),

  // === 放宽boll+涨幅 + MACD金叉 + MA20 ===
  "v79_bw10_chg1_3_macd_ma20": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: "boll_squeeze",
    minScore: 50, patternWeight: 2.0, bollWidthMax: 0.10,
    chgMin: 1, chgMax: 3, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmAboveMA20: true
  }),
  "v79_bw10_chg1_3_macd_ma20_4710": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: "boll_squeeze",
    minScore: 50, patternWeight: 2.0, bollWidthMax: 0.10,
    chgMin: 1, chgMax: 3, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmAboveMA20: true,
    trailingRules: [{ profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }]
  }),

  // === 宽止盈: MACD金叉 + MA20 + 5/8/11% ===
  "v79_macd_ma20_5811": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: "boll_squeeze",
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmAboveMA20: true,
    trailingRules: [{ profitPct: 5, trailingPct: 1.5 }, { profitPct: 8, trailingPct: 2.5 }, { profitPct: 11, trailingPct: 3.5 }]
  }),

  // === 宽止盈: MACD金叉 + OBV + 5/8/11% ===
  "v79_macd_obv_5811": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: "boll_squeeze",
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmOBV: true,
    trailingRules: [{ profitPct: 5, trailingPct: 1.5 }, { profitPct: 8, trailingPct: 2.5 }, { profitPct: 11, trailingPct: 3.5 }]
  }),
}
async function runBacktest() {
  console.log('='.repeat(80))
  console.log('V79 Strategy Backtest: MACD金叉+多条件组合深度优化')
  console.log('='.repeat(80))

  var cacheDir = CONFIG.cacheDir
  var cacheFiles = fs.readdirSync(cacheDir).filter(function(f) { return f.startsWith('tx_kline_') && f.endsWith('.json') })

  var klineMap = {}
  var codes = []
  for (var i = 0; i < cacheFiles.length; i++) {
    try {
      var data = JSON.parse(fs.readFileSync(path.join(cacheDir, cacheFiles[i]), 'utf8'))
      if (data.length >= 60) {
        var code = cacheFiles[i].replace('tx_kline_', '').replace('.json', '')
        klineMap[code] = data
        codes.push(code)
      }
    } catch(e) {}
  }
  console.log('Valid K-lines: ' + codes.length)

  var dateSet = {}
  for (var ci = 0; ci < codes.length; ci++) {
    var klines = klineMap[codes[ci]]
    for (var ki = 0; ki < klines.length; ki++) dateSet[klines[ki].date] = true
  }
  var tradeDates = Object.keys(dateSet).sort()

  var startIdx = 0
  for (var si = 0; si < tradeDates.length; si++) { if (tradeDates[si] >= '2024-07-01') { startIdx = si; break } }
  console.log('Backtest period: ' + tradeDates[startIdx] + ' ~ ' + tradeDates[tradeDates.length - 1])

  console.log('Precomputing day quotes...')
  var allDayQuotes = {}
  var allDateIdxMaps = {}
  var processed = 0

  for (var di = startIdx; di < tradeDates.length - 14; di += 3) {
    var dateStr = tradeDates[di]
    processed++
    if (processed % 50 === 0) console.log('  prep ' + dateStr + ' (' + processed + ')')

    var dayQuotes = []
    var dateIdxMap = {}
    for (var ci = 0; ci < codes.length; ci++) {
      var code = codes[ci]
      var klines = klineMap[code]
      var idx = -1
      for (var ki = 0; ki < klines.length; ki++) {
        if (klines[ki].date === dateStr) { idx = ki; break }
      }
      if (idx < 20) continue
      var k = klines[idx]
      if (k.volume <= 0 || k.close <= 3 || k.close > 200) continue
      dayQuotes.push({
        code: code, name: '', price: k.close,
        changePct: k.changePct || ((k.close - klines[idx - 1].close) / klines[idx - 1].close * 100),
        volume: k.volume, amount: k.amount || k.volume * k.close,
        turnover: 0, amplitude: ((k.high - k.low) / k.low * 100),
        high: k.high, low: k.low, open: k.open, prevClose: klines[idx - 1].close,
        circCap: 0, pe: 0, pb: 0, volumeRatio: 0
      })
      dateIdxMap[code] = idx
    }
    dayQuotes.sort(function(a, b) { return (b.changePct || 0) - (a.changePct || 0) })
    dayQuotes = dayQuotes.slice(0, 300)
    allDayQuotes[dateStr] = dayQuotes
    allDateIdxMaps[dateStr] = dateIdxMap
  }

  var sampleDates = Object.keys(allDayQuotes).sort()
  console.log('Sample dates: ' + sampleDates.length)

  var strategyNames = Object.keys(V79_STRATEGIES)
  var dynamicPicks = {}
  for (var s = 0; s < strategyNames.length; s++) dynamicPicks[strategyNames[s]] = []

  for (var si = 0; si < sampleDates.length; si++) {
    var dateStr = sampleDates[si]
    var dayQuotes = allDayQuotes[dateStr]
    var dateIdxMap = allDateIdxMaps[dateStr]
    var marketEnv = calcMarketEnv(allDayQuotes, tradeDates, si)

    for (var s = 0; s < strategyNames.length; s++) {
      var sName = strategyNames[s]
      var strategy = V79_STRATEGIES[sName]
      var picks = simulatePickV79(dayQuotes, klineMap, dateIdxMap, CONFIG.topN, marketEnv, strategy)
      for (var p = 0; p < picks.length; p++) {
        var pick = picks[p]
        var klines = klineMap[pick.code]
        var buyIdx = dateIdxMap[pick.code]
        var exit = calcDynamicExit(pick.price, klines, buyIdx, strategy.maxHoldDays || 21, strategy.stopLoss, strategy.trailingRules || [])
        dynamicPicks[sName].push({
          code: pick.code, date: dateStr, patternName: pick.patternName,
          buyPrice: pick.price, exitPrice: exit.exitPrice, exitDay: exit.exitDay,
          finalReturn: exit.finalReturn, exitReason: exit.exitReason, maxReturn: exit.maxReturn,
          totalScore: pick.totalScore, adx: pick.adx, volumeRatio: pick.volumeRatio
        })
      }
    }
  }

  var output = []
  output.push('V78 Backtest Results: MACD金叉确认深度优化')
  output.push('Period: 2024-07-01 ~ 2026-07-24, 3-day sampling')
  output.push('K-lines: ' + codes.length + ' stocks, ' + sampleDates.length + ' trading days')
  output.push('')

  var v73BaseStats = calcDynamicStats(dynamicPicks['v76_v73base'] || [])

  output.push('Strategy'.padEnd(28) + '  n   WR%   AR%  AvgD vsV73WR vsV73AR')
  output.push('-'.repeat(80))

  var allResults = []
  for (var s = 0; s < strategyNames.length; s++) {
    var sName = strategyNames[s]
    var stats = calcDynamicStats(dynamicPicks[sName])
    var wrDiff = (stats.winRate - v73BaseStats.winRate).toFixed(2)
    var arDiff = (stats.avgReturn - v73BaseStats.avgReturn).toFixed(2)
    var line = sName.padEnd(28) + String(stats.total).padStart(4) +
      String(stats.winRate).padStart(6) + String(stats.avgReturn).padStart(6) +
      String(stats.avgExitDay).padStart(6) +
      (wrDiff >= 0 ? '+' : '') + wrDiff.padStart(7) +
      (arDiff >= 0 ? '+' : '') + arDiff.padStart(7)
    output.push(line)
    allResults.push({ name: sName, wr: stats.winRate, ar: stats.avgReturn, n: stats.total, avgD: stats.avgExitDay })
  }

  // 按综合得分排序
  output.push('')
  output.push('=== Sorted by composite score (WR*0.4 + AR*5 + n*0.05) ===')
  for (var i = 0; i < allResults.length; i++) {
    var r = allResults[i]
    r.composite = r.wr * 0.4 + r.ar * 5 + r.n * 0.05
  }
  allResults.sort(function(a, b) { return b.composite - a.composite })
  for (var i = 0; i < allResults.length; i++) {
    var r = allResults[i]
    output.push((i + 1 + '. ').padStart(4) + r.name.padEnd(28) + ' WR=' + r.wr + '% AR=' + r.ar + '% n=' + r.n + ' AvgD=' + r.avgD + ' Score=' + r.composite.toFixed(2))
  }

  // WR>=80%的策略
  output.push('')
  output.push('=== Strategies with WR>=80% and n>=30 ===')
  var good = allResults.filter(function(r) { return r.wr >= 80 && r.n >= 30 })
  good.sort(function(a, b) { return b.ar - a.ar })
  for (var i = 0; i < good.length; i++) {
    output.push('  ' + good[i].name + ': WR=' + good[i].wr + '% AR=' + good[i].ar + '% n=' + good[i].n + ' AvgD=' + good[i].avgD)
  }
  if (good.length === 0) output.push('  None found')

  fs.writeFileSync(path.join(CONFIG.outputDir, 'backtest_v79.txt'), output.join('\n'), 'utf8')
  console.log('\nResults saved to backtest/results/backtest_v79.txt')

  // 打印关键结果
  for (var i = 0; i < Math.min(5, good.length); i++) {
    console.log('>>> GOOD: ' + good[i].name + ': WR=' + good[i].wr + '% AR=' + good[i].ar + '% n=' + good[i].n)
  }
}

runBacktest().catch(function(e) { console.error('Error:', e); process.exit(1) })
