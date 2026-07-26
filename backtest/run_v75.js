// run_v75.js - V75策略回测: boll_squeeze核心 + 二次确认条件
// 核心思路: 保持V73原始calcPatternScore不变，在boll_squeeze选中的股票上增加二次确认
// 目标: WR>=85%且AR>=2.5%，同时n>=100
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

// ===== V73原始形态评分系统 (完全保留) =====
function calcPatternScore(stock, klines, dateIdx, tech, volumeRatio) {
  if (!klines || dateIdx < 20 || !tech) return { pattern: 'none', score: 0 }
  var closes = []
  for (var i = 0; i <= dateIdx; i++) closes.push(klines[i].close)
  var chg = stock.changePct || 0
  var bestScore = 0, bestPattern = 'none'
  var ma5 = tech.ma5 || 0, ma10 = tech.ma10 || 0, ma20 = tech.ma20 || 0
  var ma5Slope = tech.ma5Slope || 0, ma10Slope = tech.ma10Slope || 0
  var rsi = tech.rsi || 50, bollPos = tech.bollPosition || 0.5
  var price = stock.price || klines[dateIdx].close

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
  if (bollWidth < 0.08 && chg >= 1.5 && volumeRatio >= 1.5 && ma5Slope > 0) {
    var s = 15
    if (bollPos > 0.8) s += 5
    if (bollWidth < 0.05) s += 4
    if (volumeRatio >= 2) s += 3
    if (rsi >= 50 && rsi <= 70) s += 3
    if (s > bestScore) { bestScore = s; bestPattern = 'boll_squeeze' }
  }

  return { pattern: bestPattern, score: bestScore, isGapUp: isGapUp }
}

// ===== V75二次确认检测 =====
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

function simulatePickV75(dayQuotes, klineMap, dateIdxMap, topN, marketEnv, strategy) {
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

    var patternResult = calcPatternScore(stock, klines, dateIdx, tech, volumeRatio)
    var patternScore = patternResult.score
    var patternName = patternResult.pattern

    if (strategy.requirePattern && patternName !== strategy.requirePattern) continue

    // V75二次确认
    if (strategy.confirmADX && !confirmADX(tech, strategy.confirmADX)) continue
    if (strategy.confirmMACD && !confirmMACDGolden(tech)) continue
    if (strategy.confirmMASupport && !confirmMASupport(klines, dateIdx, tech)) continue
    if (strategy.confirmShrinkRestart && !confirmShrinkRestart(klines, dateIdx)) continue
    if (strategy.confirmOBV && !confirmOBVUp(tech)) continue
    if (strategy.confirmHighVolume && !confirmHighVolume(volumeRatio, strategy.confirmHighVolume)) continue

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

    if (stopLoss && stopLoss < 0 && returnPct <= stopLoss) {
      exitPrice = price; exitDay = d; exitReason = 'stop_loss'; break
    }

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

// V75策略定义
var BASE_EXIT = {
  stopLoss: -100,
  trailingRules: [{ profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }],
  maxHoldDays: 21
}

var V75_STRATEGIES = {
  "v75_v73base": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze',
    minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, adxMin: 25, rsiMax: 60
  }),
  "v75_boll_adx30": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze',
    minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, rsiMax: 60,
    confirmADX: 30
  }),
  "v75_boll_macd": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze',
    minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, adxMin: 25, rsiMax: 60,
    confirmMACD: true
  }),
  "v75_boll_ma_support": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze',
    minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, adxMin: 25, rsiMax: 60,
    confirmMASupport: true
  }),
  "v75_boll_shrink": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze',
    minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, adxMin: 25, rsiMax: 60,
    confirmShrinkRestart: true
  }),
  "v75_boll_obv": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze',
    minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, adxMin: 25, rsiMax: 60,
    confirmOBV: true
  }),
  "v75_boll_highvol": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze',
    minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, adxMin: 25, rsiMax: 60,
    confirmHighVolume: 2.0
  }),
  "v75_boll_adx_macd": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze',
    minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, adxMin: 25, rsiMax: 60,
    confirmMACD: true
  }),
  "v75_boll_adx_obv": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze',
    minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, adxMin: 25, rsiMax: 60,
    confirmOBV: true
  }),
  "v75_boll_macd_obv": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze',
    minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, adxMin: 25, rsiMax: 60,
    confirmMACD: true, confirmOBV: true
  }),
  "v75_boll09_adx30": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze',
    minScore: 60, patternWeight: 2.0,
    chgMin: 0.8, chgMax: 3, vrMin: 1.5, rsiMax: 65,
    confirmADX: 30
  }),
  "v75_boll09_adx_macd": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze',
    minScore: 60, patternWeight: 2.0,
    chgMin: 0.8, chgMax: 3, vrMin: 1.5, rsiMax: 65,
    confirmADX: 25, confirmMACD: true
  }),
  "v75_wide_adx25": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze',
    minScore: 60, patternWeight: 2.0,
    chgMin: 0.5, chgMax: 3, vrMin: 1.5, adxMin: 25, rsiMax: 65
  }),
  "v75_wide_adx25_obv": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze',
    minScore: 60, patternWeight: 2.0,
    chgMin: 0.5, chgMax: 3, vrMin: 1.5, adxMin: 25, rsiMax: 65,
    confirmOBV: true
  }),
  "v75_vr15_adx30": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze',
    minScore: 60, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.5, rsiMax: 60,
    confirmADX: 30
  }),
  "v75_vr15_adx25_macd": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze',
    minScore: 60, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.5, adxMin: 25, rsiMax: 60,
    confirmMACD: true
  }),
  "v75_noADX_confirm30": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze',
    minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, rsiMax: 60,
    confirmADX: 30
  }),
  "v75_triple_confirm": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze',
    minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, rsiMax: 60,
    confirmADX: 25, confirmMACD: true, confirmOBV: true
  }),
  "v75_adx25_4710": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze',
    minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, adxMin: 25, rsiMax: 60,
    stopLoss: -100,
    trailingRules: [{ profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }]
  }),
  "v75_rsi65_adx25_obv": Object.assign({}, BASE_EXIT, {
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze',
    minScore: 60, patternWeight: 2.0,
    chgMin: 1, chgMax: 3, vrMin: 1.5, adxMin: 25, rsiMax: 65,
    confirmOBV: true
  })
}

async function runBacktest() {
  console.log('='.repeat(80))
  console.log('V75 Strategy Backtest: boll_squeeze + 二次确认条件')
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

  var strategyNames = Object.keys(V75_STRATEGIES)
  var dynamicPicks = {}
  var patternCounts = {}
  for (var s = 0; s < strategyNames.length; s++) {
    dynamicPicks[strategyNames[s]] = []
    patternCounts[strategyNames[s]] = {}
  }

  for (var si = 0; si < sampleDates.length; si++) {
    var dateStr = sampleDates[si]
    var dayQuotes = allDayQuotes[dateStr]
    var dateIdxMap = allDateIdxMaps[dateStr]
    var marketEnv = calcMarketEnv(allDayQuotes, tradeDates, si)

    for (var s = 0; s < strategyNames.length; s++) {
      var sName = strategyNames[s]
      var strategy = V75_STRATEGIES[sName]
      var picks = simulatePickV75(dayQuotes, klineMap, dateIdxMap, CONFIG.topN, marketEnv, strategy)

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

        if (!patternCounts[sName][pick.patternName]) patternCounts[sName][pick.patternName] = 0
        patternCounts[sName][pick.patternName]++
      }
    }
  }

  var output = []
  var summaryLines = []
  output.push('V75 Backtest Results: boll_squeeze + 二次确认')
  output.push('Period: 2024-07-01 ~ 2026-07-24, 3-day sampling')
  output.push('K-lines: ' + codes.length + ' stocks, ' + sampleDates.length + ' trading days')
  output.push('')

  output.push('Strategy'.padEnd(28) + '  n   WR%   AR%  AvgD vsV73WR vsV73AR  Patterns')
  output.push('-'.repeat(110))

  var v73BaseStats = calcDynamicStats(dynamicPicks['v75_v73base'] || [])
  var v73BaseWR = v73BaseStats.winRate
  var v73BaseAR = v73BaseStats.avgReturn

  summaryLines.push('Strategy'.padEnd(28) + '  n   WR%   AR%  AvgD vsV73WR vsV73AR')
  summaryLines.push('-'.repeat(80))

  for (var s = 0; s < strategyNames.length; s++) {
    var sName = strategyNames[s]
    var stats = calcDynamicStats(dynamicPicks[sName])
    if (stats.total === 0) continue

    var patternStr = ''
    var pKeys = Object.keys(patternCounts[sName])
    for (var pk = 0; pk < pKeys.length; pk++) patternStr += pKeys[pk] + ':' + patternCounts[sName][pKeys[pk]] + ' '

    var wrDiff = (stats.winRate - v73BaseWR).toFixed(2)
    var arDiff = (stats.avgReturn - v73BaseAR).toFixed(2)

    var line = sName.padEnd(28) + String(stats.total).padStart(4) +
      String(stats.winRate).padStart(6) + String(stats.avgReturn).padStart(6) +
      String(stats.avgExitDay).padStart(6) +
      (wrDiff >= 0 ? '+' : '') + wrDiff.padStart(7) +
      (arDiff >= 0 ? '+' : '') + arDiff.padStart(7) + '  ' + patternStr.trim()
    output.push(line)

    var summaryLine = sName.padEnd(28) + String(stats.total).padStart(4) +
      String(stats.winRate).padStart(6) + String(stats.avgReturn).padStart(6) +
      String(stats.avgExitDay).padStart(6) +
      (wrDiff >= 0 ? '+' : '') + wrDiff.padStart(7) +
      (arDiff >= 0 ? '+' : '') + arDiff.padStart(7)
    summaryLines.push(summaryLine)

    if (stats.winRate >= v73BaseWR && stats.avgReturn >= v73BaseAR && stats.total > v73BaseStats.total) {
      console.log('>>> ' + sName + ': WR=' + stats.winRate + '% AR=' + stats.avgReturn + '% n=' + stats.total + ' BEATS V73base!')
    }
  }

  // 最佳策略
  output.push('')
  output.push('Best Strategies (WR>=85%):')
  var best = []
  for (var s = 0; s < strategyNames.length; s++) {
    var sName = strategyNames[s]
    var stats = calcDynamicStats(dynamicPicks[sName])
    if (stats.winRate >= 85) best.push({ name: sName, wr: stats.winRate, ar: stats.avgReturn, n: stats.total, avgD: stats.avgExitDay })
  }
  best.sort(function(a, b) { return b.ar - a.ar })
  for (var b = 0; b < best.length; b++) {
    output.push('  ' + best[b].name + ': WR=' + best[b].wr + '% AR=' + best[b].ar + '% n=' + best[b].n + ' AvgD=' + best[b].avgD)
  }
  if (best.length === 0) {
    output.push('  No strategy meets WR>=85%')
    output.push('')
    output.push('All strategies (sorted by AR):')
    var all = []
    for (var s = 0; s < strategyNames.length; s++) {
      var sName = strategyNames[s]
      var stats = calcDynamicStats(dynamicPicks[sName])
      all.push({ name: sName, wr: stats.winRate, ar: stats.avgReturn, n: stats.total, avgD: stats.avgExitDay })
    }
    all.sort(function(a, b) { return b.ar - a.ar })
    for (var b = 0; b < all.length; b++) {
      output.push('  ' + all[b].name + ': WR=' + all[b].wr + '% AR=' + all[b].ar + '% n=' + all[b].n + ' AvgD=' + all[b].avgD)
    }
  }

  fs.writeFileSync(path.join(CONFIG.outputDir, 'backtest_v75.txt'), output.join('\n'), 'utf8')
  console.log('\n' + summaryLines.join('\n'))
  console.log('\nResults saved to backtest/results/backtest_v75.txt')
}

runBacktest().catch(function(e) { console.error('Error:', e); process.exit(1) })
