// run_v64.js - V64策略回测: 多形态融合 + 动态止盈
// 核心思路: 不再仅依赖gapUp硬过滤，引入5种上涨启动形态
// 形态1: gapUp跳空高开(保留V64base最优)
// 形态2: 平台突破(窄幅整理后放量突破)
// 形态3: 趋势加速(MA多头排列+MA5斜率加速)
// 形态4: 缩量回踩再启动(前期强势+缩量回调+放量再起)
// 形态5: 布林收窄突破(波动率压缩后方向性突破)
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

// ===== 形态评分系统 =====
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

  // === 形态1: gapUp跳空高开 ===
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

  // === 形态2: 平台突破 ===
  var narrow5 = detectNarrowRange(klines, dateIdx, 5, 5)
  var narrow8 = detectNarrowRange(klines, dateIdx, 8, 6)
  var narrow10 = detectNarrowRange(klines, dateIdx, 10, 7)
  if ((narrow5 || narrow8 || narrow10) && chg >= 2 && volumeRatio >= 1.5) {
    var s = 18
    if (narrow5) s += 5
    if (chg >= 3) s += 3
    if (volumeRatio >= 2) s += 3
    if (ma5Slope > 0) s += 2
    if (price > ma20) s += 2
    if (s > bestScore) { bestScore = s; bestPattern = 'platform_break' }
  }

  // === 形态3: 趋势加速 ===
  if (tech.maSignal === 'bull' && ma5Slope > 0.15 && chg >= 1 && chg <= 5) {
    var s = 15
    if (volumeRatio >= 1.2 && volumeRatio <= 4) s += 5
    if (rsi >= 45 && rsi <= 70) s += 5
    if (ma5Slope > 0.25) s += 3
    if (tech.adx >= 25) s += 3
    if (bollPos >= 0.6 && bollPos <= 0.85) s += 2
    if (s > bestScore) { bestScore = s; bestPattern = 'trend_accel' }
  }

  // === 形态4: 缩量回踩再启动 ===
  var pullback = detectShrinkPullback(klines, dateIdx, 6)
  if (pullback.detected && chg >= 1 && volumeRatio >= 1.5) {
    var s = 16
    if (price > ma10 && price < ma10 * 1.05) s += 5 // 回踩MA10附近
    if (rsi >= 40 && rsi <= 65) s += 4
    if (chg >= 2) s += 3
    if (volumeRatio >= 2) s += 2
    if (s > bestScore) { bestScore = s; bestPattern = 'pullback_restart' }
  }

  // === 形态5: 布林收窄突破 ===
  var bollWidth = calcBollWidth(closes)
  if (bollWidth < 0.08 && chg >= 1.5 && volumeRatio >= 1.5 && ma5Slope > 0) {
    var s = 15
    if (bollPos > 0.8) s += 5 // 突破上轨
    if (bollWidth < 0.05) s += 4 // 极度收窄
    if (volumeRatio >= 2) s += 3
    if (rsi >= 50 && rsi <= 70) s += 3
    if (s > bestScore) { bestScore = s; bestPattern = 'boll_squeeze' }
  }

  return { pattern: bestPattern, score: bestScore, isGapUp: isGapUp }
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

function simulatePickV64(dayQuotes, klineMap, dateIdxMap, topN, marketEnv, strategy) {
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

    // V43b硬过滤
    if (strategy.requireGapUp) {
      var prevHigh = dateIdx > 0 ? klines[dateIdx - 1].high : 0
      var todayOpen = klines[dateIdx].open
      if (!(prevHigh > 0 && todayOpen > prevHigh && (stock.changePct || 0) >= 1)) continue
    }

    // MA斜率过滤
    if (strategy.ma5Min !== undefined && tech.ma5Slope < strategy.ma5Min) continue
    if (strategy.ma10Min !== undefined && tech.ma10Slope < strategy.ma10Min) continue

    // 相对强度过滤
    var rs = calcRelativeStrength(klines, dateIdx)
    if (strategy.rsMin && rs < strategy.rsMin) continue

    // 量比过滤
    if (strategy.vrMin && volumeRatio < strategy.vrMin) continue

    // RSI过滤
    if (strategy.rsiMax && tech.rsi > strategy.rsiMax) continue

    // ADX过滤
    if (strategy.adxMin && tech.adx < strategy.adxMin) continue
    if (strategy.turnoverMin && stock.turnoverRate < strategy.turnoverMin) continue
    if (strategy.turnoverMax && stock.turnoverRate > strategy.turnoverMax) continue
    if (strategy.chgMax && stock.changePct > strategy.chgMax) continue
    if (strategy.chgMin && stock.changePct < strategy.chgMin) continue

    // 价格位置过滤
    var pricePos = calcPricePositionVsHigh(klines, dateIdx)
    var ppThreshold = strategy.pricePosThreshold || 0.95
    if (pricePos > ppThreshold) continue

    // 量比硬过滤
    if (volumeRatio < (strategy.vrMin || 1.5)) continue

    // 评分
    var v31Score = calcTechScoreV31(stock, tech.rsi, tech.goldenCross, volumeRatio, tech.bollPosition, code, tech.maSignal, tech.change5d || 0)
    var v10Score = calcTechScoreV10(stock, tech.rsi, tech.goldenCross, volumeRatio, tech.bollPosition, code, tech.change5d || 0)
    var techScore = v31Score * (strategy.v31W || 0.75) + v10Score * (strategy.v10W || 0.25)

    // 形态评分
    var patternResult = calcPatternScore(stock, klines, dateIdx, tech, volumeRatio)
    var patternScore = patternResult.score
    var patternName = patternResult.pattern

    // 如果策略要求特定形态，过滤
    if (strategy.requirePattern === 'any') {
      if (patternName === 'none') continue
      if (strategy.allowedPatterns && strategy.allowedPatterns.indexOf(patternName) === -1) continue
    } else if (strategy.requirePattern && patternName !== strategy.requirePattern) {
      continue
    }

    // 连涨天数
    var consecUp = calcConsecutiveUpDays(klines, dateIdx)
    if (consecUp > maxConsecUp) continue

    // 综合评分: 技术面 + 形态分
    var totalScore = techScore + patternScore * (strategy.patternWeight || 1.0)

    // 温和因子加成
    var mildBonus = 0
    var chg = stock.changePct || 0
    if (chg >= 1 && chg < 3 && volumeRatio >= 1 && volumeRatio < 2) mildBonus = 8
    else if (chg >= 0.5 && chg < 1 && volumeRatio >= 1 && volumeRatio < 1.5) mildBonus = 4
    totalScore += mildBonus

    // 布林位置惩罚
    if (tech.bollPosition > bollThreshold) totalScore *= params.volPenalty || 0.9

    // OBV趋势加成
    if (tech.obvTrend === 'up') totalScore += 3

    // ADX趋势确认
    if (tech.adx >= adxThreshold) totalScore += 2

    if (totalScore < minScore) continue

    scored.push({
      code: code, name: stock.name, price: stock.price || klines[dateIdx].close,
      changePct: stock.changePct || 0, totalScore: totalScore,
      techScore: techScore, patternScore: patternScore, patternName: patternName,
      volumeRatio: volumeRatio, rsi: tech.rsi, isGapUp: patternResult.isGapUp,
      ma5Slope: tech.ma5Slope, ma10Slope: tech.ma10Slope,
      bollPosition: tech.bollPosition, adx: tech.adx,
    })
  }

  scored.sort(function(a, b) { return b.totalScore - a.totalScore })
  // 行业集中度限制(简化版)
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
  var maxReturn = 0, maxDrawdown = 0, exitPrice = buyPrice, exitDay = 1
  var exitReason = 'max_hold', highestPrice = buyPrice
  var profitTrailing = 0

  for (var d = 1; d <= maxHoldDays; d++) {
    var idx = buyIdx + d
    if (idx >= klines.length) break
    var price = klines[idx].close
    var high = klines[idx].high
    var low = klines[idx].low

    if (high > highestPrice) highestPrice = high
    var returnPct = (price - buyPrice) / buyPrice * 100
    var maxRet = (highestPrice - buyPrice) / buyPrice * 100
    if (maxRet > maxReturn) maxReturn = maxRet

    // 止损
    if (stopLoss && stopLoss < 0 && returnPct <= stopLoss) {
      exitPrice = price; exitDay = d; exitReason = 'stop_loss'; break
    }

    // 阶梯止盈
    var trailingPct = 0
    for (var t = trailingRules.length - 1; t >= 0; t--) {
      if (maxRet >= trailingRules[t].profitPct) { trailingPct = trailingRules[t].trailingPct; break }
    }
    if (trailingPct > 0) {
      var drawdown = (highestPrice - low) / highestPrice * 100
      if (drawdown > trailingPct) {
        exitPrice = price; exitDay = d; exitReason = 'trailing_' + trailingPct + '%'; break
      }
    }

    var drawdownFromHigh = (highestPrice - low) / highestPrice * 100
    if (drawdownFromHigh > maxDrawdown) maxDrawdown = drawdownFromHigh
    exitPrice = price; exitDay = d
  }

  var finalReturn = (exitPrice - buyPrice) / buyPrice * 100
  return { returnPct: finalReturn, exitDay: exitDay, exitReason: exitReason, maxReturn: maxReturn, maxDrawdown: maxDrawdown }
}

function calcStats(picks, holdDays) {
  var stats = {}
  for (var h = 0; h < holdDays.length; h++) {
    var d = holdDays[h]
    var returns = []
    for (var i = 0; i < picks.length; i++) {
      var p = picks[i]
      if (d <= p.exitDay) {
        returns.push((p.priceAtDay[d] - p.buyPrice) / p.buyPrice * 100)
      } else {
        returns.push(p.finalReturn)
      }
    }
    if (returns.length === 0) { stats['hold' + d] = { winRate: 0, avgReturn: 0 }; continue }
    var wins = 0, sum = 0
    for (var i = 0; i < returns.length; i++) { if (returns[i] > 0) wins++; sum += returns[i] }
    stats['hold' + d] = { winRate: Math.round(wins / returns.length * 10000) / 100, avgReturn: Math.round(sum / returns.length * 100) / 100 }
  }
  return stats
}

function calcDynamicStats(picks) {
  if (picks.length === 0) return { total: 0, winRate: 0, avgReturn: 0, avgExitDay: 0, avgMaxReturn: 0, avgMaxDrawdown: 0, exitReasons: {} }
  var wins = 0, sumReturn = 0, sumDay = 0, sumMaxR = 0, sumMaxDD = 0
  var exitReasons = {}
  for (var i = 0; i < picks.length; i++) {
    if (picks[i].returnPct > 0) wins++
    sumReturn += picks[i].returnPct
    sumDay += picks[i].exitDay
    sumMaxR += picks[i].maxReturn
    sumMaxDD += picks[i].maxDrawdown
    var reason = picks[i].exitReason || 'unknown'
    exitReasons[reason] = (exitReasons[reason] || 0) + 1
  }
  return {
    total: picks.length,
    winRate: Math.round(wins / picks.length * 10000) / 100,
    avgReturn: Math.round(sumReturn / picks.length * 100) / 100,
    avgExitDay: Math.round(sumDay / picks.length * 100) / 100,
    avgMaxReturn: Math.round(sumMaxR / picks.length * 100) / 100,
    avgMaxDrawdown: Math.round(sumMaxDD / picks.length * 100) / 100,
    exitReasons: exitReasons
  }
}

// ===== V70策略定义 =====
// V69最佳: v69_adx20_21d (WR=81.04% AR=1.88% n=211)
// V70目标: 在保持WR>=78%的前提下，提高AR到2%+
var V73_STRATEGIES = {
  "v73_v72base": {
    stopLoss: -100, trailingRules: [
      { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }
    ], maxHoldDays: 21, ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze', minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, adxMin: 20, rsiMax: 60
  },
  "v73_rsi50": {
    stopLoss: -100, trailingRules: [
      { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }
    ], maxHoldDays: 21, ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze', minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, adxMin: 20, rsiMax: 50
  },
  "v73_rsi58": {
    stopLoss: -100, trailingRules: [
      { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }
    ], maxHoldDays: 21, ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze', minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, adxMin: 20, rsiMax: 58
  },
  "v73_rsi62": {
    stopLoss: -100, trailingRules: [
      { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }
    ], maxHoldDays: 21, ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze', minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, adxMin: 20, rsiMax: 62
  },
  "v73_rsi60_sc70": {
    stopLoss: -100, trailingRules: [
      { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }
    ], maxHoldDays: 21, ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze', minScore: 70, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, adxMin: 20, rsiMax: 60
  },
  "v73_rsi60_4710": {
    stopLoss: -100, trailingRules: [
      { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }
    ], maxHoldDays: 21, ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze', minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, adxMin: 20, rsiMax: 60
  },
  "v73_rsi60_25d": {
    stopLoss: -100, trailingRules: [
      { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }, { profitPct: 12, trailingPct: 4 }
    ], maxHoldDays: 25, ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze', minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, adxMin: 20, rsiMax: 60
  },
  "v73_rsi60_vr20": {
    stopLoss: -100, trailingRules: [
      { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }
    ], maxHoldDays: 21, ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze', minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 2.0, adxMin: 20, rsiMax: 60
  },
  "v73_rsi60_adx25": {
    stopLoss: -100, trailingRules: [
      { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }
    ], maxHoldDays: 21, ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze', minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, adxMin: 25, rsiMax: 60
  },
  "v73_rsi60_ma5_015": {
    stopLoss: -100, trailingRules: [
      { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }
    ], maxHoldDays: 21, ma5Min: 0.15, ma10Min: 0.02, requirePattern: 'boll_squeeze', minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, adxMin: 20, rsiMax: 60
  },
  "v73_rsi60_chg08_2": {
    stopLoss: -100, trailingRules: [
      { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }
    ], maxHoldDays: 21, ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze', minScore: 65, patternWeight: 2.0,
    chgMin: 0.8, chgMax: 2, vrMin: 1.8, adxMin: 20, rsiMax: 60
  },
  "v73_rsi60_sl8": {
    stopLoss: -8, trailingRules: [
      { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }
    ], maxHoldDays: 21, ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze', minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, adxMin: 20, rsiMax: 60
  },
  "v73_rsi65_v70base": {
    stopLoss: -100, trailingRules: [
      { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }
    ], maxHoldDays: 21, ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze', minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, adxMin: 20
  },
}

async function runBacktest() {
  console.log('='.repeat(80))
  console.log('V73 Strategy Backtest: RSI阈值精细搜索')
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

  // 构建交易日历
  var dateSet = {}
  for (var ci = 0; ci < codes.length; ci++) {
    var klines = klineMap[codes[ci]]
    for (var ki = 0; ki < klines.length; ki++) dateSet[klines[ki].date] = true
  }
  var tradeDates = Object.keys(dateSet).sort()

  var startIdx = 0
  for (var si = 0; si < tradeDates.length; si++) { if (tradeDates[si] >= '2024-07-01') { startIdx = si; break } }
  console.log('Backtest period: ' + tradeDates[startIdx] + ' ~ ' + tradeDates[tradeDates.length - 1])

  // 预计算每日行情
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
      var name = ''
      dayQuotes.push({
        code: code, name: name, price: k.close,
        changePct: k.changePct || ((k.close - klines[idx - 1].close) / klines[idx - 1].close * 100),
        volume: k.volume, amount: k.amount || k.volume * k.close,
        turnover: 0, amplitude: ((k.high - k.low) / k.low * 100),
        high: k.high, low: k.low, open: k.open, prevClose: klines[idx - 1].close,
        circCap: 0, pe: 0, pb: 0, volumeRatio: 0
      })
      dateIdxMap[code] = idx
    }
    dayQuotes.sort(function(a, b) { return (b.changePct || 0) - (a.changePct || 0) })
    // 只取涨幅前300
    dayQuotes = dayQuotes.slice(0, 300)
    allDayQuotes[dateStr] = dayQuotes
    allDateIdxMaps[dateStr] = dateIdxMap
  }

  // 采样日期
  var sampleDates = Object.keys(allDayQuotes).sort()
  console.log('Sample dates: ' + sampleDates.length)

  // 运行各策略
  var strategyNames = Object.keys(V73_STRATEGIES)
  var dynamicPicks = {}
  var patternCounts = {}
  for (var s = 0; s < strategyNames.length; s++) {
    dynamicPicks[strategyNames[s]] = []
    patternCounts[strategyNames[s]] = {}
  }

  // V10基准
  var v10Picks = []
  // V43b固定持有
  var v43bFixedPicks = []

  for (var si = 0; si < sampleDates.length; si++) {
    var dateStr = sampleDates[si]
    var dayQuotes = allDayQuotes[dateStr]
    var dateIdxMap = allDateIdxMaps[dateStr]
    var marketEnv = calcMarketEnv(allDayQuotes, tradeDates, si)

    // V10基准: Top20涨幅，无过滤
    var v10Candidates = dayQuotes.filter(preFilter).slice(0, CONFIG.topN)
    for (var p = 0; p < v10Candidates.length; p++) {
      var pick = v10Candidates[p]
      var pickIdx = dateIdxMap[pick.code]
      var klines = klineMap[pick.code]
      if (!pickIdx || !klines) continue
      var priceAtDay = {}
      for (var h = 0; h < CONFIG.holdDays.length; h++) {
        var d = CONFIG.holdDays[h]
        if (pickIdx + d < klines.length) priceAtDay[d] = klines[pickIdx + d].close
      }
      v10Picks.push({ buyPrice: pick.price, priceAtDay: priceAtDay, exitDay: 10, finalReturn: pickIdx + 10 < klines.length ? (klines[pickIdx + 10].close - pick.price) / pick.price * 100 : 0 })
    }

    // V43b固定持有
    var v43bCandidates = []
    for (var i = 0; i < dayQuotes.length; i++) {
      var stock = dayQuotes[i]
      if (!preFilter(stock)) continue
      var code = stock.code
      var klines2 = klineMap[code]
      var dateIdx2 = dateIdxMap[code]
      if (!klines2 || dateIdx2 === undefined || dateIdx2 < 20) continue
      var volumeRatio = calcVolumeRatioFromKlines(klines2, dateIdx2)
      if (volumeRatio < 1.5) continue
      var techSlice = klines2.slice(0, dateIdx2 + 1)
      var tech = calcTechFromKlines(techSlice)
      if (!tech) continue
      var v31Score = calcTechScoreV31(stock, tech.rsi, tech.goldenCross, volumeRatio, tech.bollPosition, code, tech.maSignal, tech.change5d || 0)
      if (v31Score >= 55) v43bCandidates.push({ code: code, price: stock.price, changePct: stock.changePct })
    }
    v43bCandidates.sort(function(a, b) { return (b.changePct || 0) - (a.changePct || 0) })
    for (var p = 0; p < Math.min(20, v43bCandidates.length); p++) {
      var pick = v43bCandidates[p]
      var pickIdx = dateIdxMap[pick.code]
      var klines3 = klineMap[pick.code]
      if (!pickIdx || !klines3) continue
      var priceAtDay = {}
      for (var h = 0; h < CONFIG.holdDays.length; h++) {
        var d = CONFIG.holdDays[h]
        if (pickIdx + d < klines3.length) priceAtDay[d] = klines3[pickIdx + d].close
      }
      v43bFixedPicks.push({ buyPrice: pick.price, priceAtDay: priceAtDay, exitDay: 10, finalReturn: pickIdx + 10 < klines3.length ? (klines3[pickIdx + 10].close - pick.price) / pick.price * 100 : 0 })
    }

    // 各策略
    for (var s = 0; s < strategyNames.length; s++) {
      var sName = strategyNames[s]
      var strategy = V73_STRATEGIES[sName]
      var sPicks = simulatePickV64(dayQuotes, klineMap, dateIdxMap, CONFIG.topN, marketEnv, strategy)
      for (var p = 0; p < sPicks.length; p++) {
        var pick = sPicks[p]
        var pickIdx = dateIdxMap[pick.code]
        var klines4 = klineMap[pick.code]
        if (!pickIdx || !klines4) continue
        var dynResult = calcDynamicExit(pick.price, klines4, pickIdx, strategy.maxHoldDays, strategy.stopLoss, strategy.trailingRules)
        dynResult.isGapUp = pick.isGapUp || false
        dynResult.patternName = pick.patternName || 'none'
        dynamicPicks[sName].push(dynResult)
        var pn = pick.patternName || 'none'
        patternCounts[sName][pn] = (patternCounts[sName][pn] || 0) + 1
      }
    }

    if ((si + 1) % 30 === 0) console.log('  processed ' + (si + 1) + '/' + sampleDates.length + ' dates')
  }

  var output = []
  output.push('================================================================================')
  output.push('V73 Strategy Backtest: RSI阈值精细搜索')
  output.push('================================================================================')
  output.push('')

  var v10Stats = calcStats(v10Picks, CONFIG.holdDays)
  output.push('--- V10 BASELINE (n=' + v10Picks.length + ') ---')
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var d = CONFIG.holdDays[h]
    var s = v10Stats['hold' + d]
    output.push('  Hold ' + d + 'd: winRate=' + s.winRate + '% avgReturn=' + s.avgReturn + '%')
  }
  output.push('')

  var v43bStats = calcStats(v43bFixedPicks, CONFIG.holdDays)
  output.push('--- V43b FIXED HOLD (n=' + v43bFixedPicks.length + ') ---')
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var d = CONFIG.holdDays[h]
    var s = v43bStats['hold' + d]
    output.push('  Hold ' + d + 'd: winRate=' + s.winRate + '% avgReturn=' + s.avgReturn + '%')
  }
  output.push('')

  output.push('--- DYNAMIC EXIT STRATEGIES ---')
  output.push('')
  output.push('Strategy'.padEnd(24) + '  n   WR%   AR%  AvgD  Patterns')
  output.push('-'.repeat(100))

  console.log('\n' + '='.repeat(80))
  console.log('V73 RESULTS')
  console.log('='.repeat(80))

  var summaryLines = []
  var v10Line = 'V10: '
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var d = CONFIG.holdDays[h]
    var s = v10Stats['hold' + d]
    v10Line += d + 'dWR=' + s.winRate + '% ' + d + 'dAR=' + s.avgReturn + '% '
  }
  summaryLines.push(v10Line)

  var v43b10d = v43bStats['hold10'] || { winRate: 0, avgReturn: 0 }
  summaryLines.push('V43b_fixed10d: n=' + v43bFixedPicks.length + ' WR=' + v43b10d.winRate + '% AR=' + v43b10d.avgReturn + '%')
  summaryLines.push('')
  summaryLines.push('Strategy'.padEnd(24) + '  n   WR%   AR%  AvgD  vsV72baseWR  vsV72baseAR  PatternBreakdown')
  summaryLines.push('-'.repeat(110))

  // V72base基线
  var v72BaseStats = calcDynamicStats(dynamicPicks['v73_v72base'] || [])
  var v72BaseWR = v72BaseStats.winRate
  var v72BaseAR = v72BaseStats.avgReturn

  for (var s = 0; s < strategyNames.length; s++) {
    var sName = strategyNames[s]
    var stats = calcDynamicStats(dynamicPicks[sName])
    if (stats.total === 0) continue

    var patternStr = ''
    var pKeys = Object.keys(patternCounts[sName])
    for (var pk = 0; pk < pKeys.length; pk++) {
      patternStr += pKeys[pk] + ':' + patternCounts[sName][pKeys[pk]] + ' '
    }

    var line = sName.padEnd(24) + String(stats.total).padStart(4) +
      String(stats.winRate).padStart(6) + String(stats.avgReturn).padStart(6) +
      String(stats.avgExitDay).padStart(6) + '  ' + patternStr.trim()
    output.push(line)

    var wrDiff = (stats.winRate - v72BaseWR).toFixed(2)
    var arDiff = (stats.avgReturn - v72BaseAR).toFixed(2)
    var summaryLine = sName.padEnd(24) + String(stats.total).padStart(4) +
      String(stats.winRate).padStart(6) + String(stats.avgReturn).padStart(6) +
      String(stats.avgExitDay).padStart(6) +
      (wrDiff >= 0 ? '+' : '') + wrDiff.padStart(10) +
      (arDiff >= 0 ? '+' : '') + arDiff.padStart(10) + '  ' + patternStr.trim()
    summaryLines.push(summaryLine)

    if (stats.winRate > v72BaseWR && stats.avgReturn > v72BaseAR) {
      console.log('>>> ' + sName + ': WR=' + stats.winRate + '% AR=' + stats.avgReturn + '% avgDay=' + stats.avgExitDay + ' BEATS V72base!')
    }
  }

  console.log('\n' + summaryLines.join('\n'))

  // 形态分析
  output.push('')
  output.push('================================================================================')
  output.push('PATTERN ANALYSIS')
  output.push('================================================================================')
  
  // 分析每种形态的独立表现
  var patternNames = ['gapUp', 'platform_break', 'trend_accel', 'pullback_restart', 'boll_squeeze']
  output.push('')
  output.push('--- Per-Pattern Performance (from v64_any_pattern) ---')
  
  var anyPicks = dynamicPicks['v73_v72base'] || []
  var patternStats = {}
  for (var pn = 0; pn < patternNames.length; pn++) {
    var patternPicks = anyPicks.filter(function(p) { return p.patternName === patternNames[pn] })
    if (patternPicks.length === 0) { patternStats[patternNames[pn]] = { total: 0 }; continue }
    var pStats = calcDynamicStats(patternPicks)
    patternStats[patternNames[pn]] = pStats
    output.push('  ' + patternNames[pn].padEnd(20) + ' n=' + String(pStats.total).padStart(4) +
      ' WR=' + String(pStats.winRate).padStart(6) + '% AR=' + String(pStats.avgReturn).padStart(6) + '% AvgD=' + String(pStats.avgExitDay).padStart(6))
  }

  output.push('')
  output.push('================================================================================')
  output.push('SUMMARY')
  output.push('================================================================================')
  output.push(summaryLines.join('\n'))
  
  output.push('')
  output.push('Version Evolution:')
  output.push('| Version | Strategy | WR% | AR% | n | AvgDay |')
  output.push('|---|---|---|---|---|---|')
  output.push('| V43b | Fixed 10d | ' + v43b10d.winRate + ' | ' + v43b10d.avgReturn + ' | ' + v43bFixedPicks.length + ' | 10 |')
  output.push('| V72base | gapUp+3/5/8% | ' + v72BaseWR + ' | ' + v72BaseAR + ' | ' + v72BaseStats.total + ' | ' + v72BaseStats.avgExitDay + ' |')
  
  // 找最佳V64策略
  var bestV64 = null, bestV64WR = 0, bestV64AR = 0
  for (var s = 0; s < strategyNames.length; s++) {
    var sName = strategyNames[s]
    if (sName === 'v73_v72base') continue
    var stats = calcDynamicStats(dynamicPicks[sName])
    if (stats.total < 20) continue
    if (stats.winRate > bestV64WR || (stats.winRate === bestV64WR && stats.avgReturn > bestV64AR)) {
      bestV64 = sName; bestV64WR = stats.winRate; bestV64AR = stats.avgReturn
    }
  }
  if (bestV64) {
    var bestStats = calcDynamicStats(dynamicPicks[bestV64])
    output.push('| V64 | ' + bestV64 + ' | ' + bestStats.winRate + ' | ' + bestStats.avgReturn + ' | ' + bestStats.total + ' | ' + bestStats.avgExitDay + ' |')
  }

  fs.writeFileSync(path.join(CONFIG.outputDir, 'backtest_v70.txt'), output.join('\n'), 'utf8')
  console.log('\nResults saved to backtest/results/backtest_v70.txt')
}

runBacktest().catch(function(e) { console.error('Error:', e); process.exit(1) })

