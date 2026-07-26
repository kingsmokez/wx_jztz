// run_v84.js - V84新形态+动态ATR优化回测 (V2: 形态参与竞争+修复动态ATR)
// V83基线: v83b_atr_1.2x_consec4 WR=88.57% AR=5.76% n=35
// V84目标: WR>=89% AR>=6.0% n>=30
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

var { calcTechFromKlines, calcVolumePriceCoord, calcTrendAcceleration, detectConsolidationBreakout, calcCandlePatterns, calcMA, calcADX, calcOBV, calcEMA, calcATR, calcMASlope, calcBollPosition, calcRSI, calcMACD } = require('./indicators')
var { getLimitPct, calcTechScoreV10, calcTechScoreV31 } = require('./scoring')

var v82Code = fs.readFileSync(path.join(__dirname, '_v82_funcs.js'), 'utf8')
eval(v82Code)

// ===== V84新增: 4种上涨趋势形态检测 =====

function detectDoubleBottomV84(klines, dateIdx) {
  if (dateIdx < 30 || dateIdx >= klines.length) return { detected: false, score: 0 }
  var recent = klines.slice(dateIdx - 29, dateIdx + 1)
  if (recent.length < 20) return { detected: false, score: 0 }
  var firstLow = Infinity, firstLowIdx = -1
  for (var i = 0; i < recent.length - 10; i++) {
    if (recent[i].low < firstLow) { firstLow = recent[i].low; firstLowIdx = i }
  }
  if (firstLowIdx < 0 || firstLowIdx > recent.length - 15) return { detected: false, score: 0 }
  var secondLow = Infinity, secondLowIdx = -1
  var searchStart = Math.max(firstLowIdx + 5, 5)
  var searchEnd = Math.min(recent.length - 3, firstLowIdx + 20)
  for (var i = searchStart; i < searchEnd; i++) {
    if (recent[i].low < secondLow) { secondLow = recent[i].low; secondLowIdx = i }
  }
  if (secondLowIdx < 0) return { detected: false, score: 0 }
  if (secondLow < firstLow * 0.97) return { detected: false, score: 0 }
  var neckline = -Infinity
  for (var i = firstLowIdx + 1; i < secondLowIdx; i++) {
    if (recent[i].high > neckline) neckline = recent[i].high
  }
  if (neckline <= 0) return { detected: false, score: 0 }
  var today = recent[recent.length - 1]
  if (today.close <= neckline) return { detected: false, score: 0 }
  var score = 15 // 与boll_squeeze基础分15对齐
  var gap = secondLowIdx - firstLowIdx
  if (gap >= 7 && gap <= 12) score += 5
  else if (gap >= 5) score += 2
  if (secondLow > firstLow) score += 3
  var prevAvgVol = 0
  for (var i = Math.max(0, recent.length - 6); i < recent.length - 1; i++) prevAvgVol += recent[i].volume
  prevAvgVol /= Math.min(5, recent.length - 1)
  if (prevAvgVol > 0 && today.volume / prevAvgVol >= 1.5) score += 3
  if (today.close > neckline * 1.02) score += 2
  return { detected: true, score: score }
}

function detectFlagBreakoutV84(klines, dateIdx) {
  if (dateIdx < 12 || dateIdx >= klines.length) return { detected: false, score: 0 }
  var recent = klines.slice(dateIdx - 11, dateIdx + 1)
  if (recent.length < 10) return { detected: false, score: 0 }
  var surgeIdx = -1, surgeChg = 0, surgeHigh = 0
  for (var i = 1; i < recent.length - 2; i++) {
    var chg = (recent[i].close - recent[i - 1].close) / recent[i - 1].close * 100
    if (chg >= 5 && chg > surgeChg) { surgeIdx = i; surgeChg = chg; surgeHigh = recent[i].high }
  }
  if (surgeIdx < 0 || surgeIdx > recent.length - 4) return { detected: false, score: 0 }
  var flagDays = 0
  for (var i = surgeIdx + 1; i < recent.length - 1; i++) flagDays++
  if (flagDays < 2 || flagDays > 7) return { detected: false, score: 0 }
  var flagLow = Infinity
  for (var i = surgeIdx + 1; i < recent.length - 1; i++) {
    if (recent[i].low < flagLow) flagLow = recent[i].low
  }
  if (flagLow < surgeHigh * 0.97) return { detected: false, score: 0 }
  var today = recent[recent.length - 1]
  if (today.close <= surgeHigh) return { detected: false, score: 0 }
  var score = 15 // 与boll_squeeze基础分对齐
  if (surgeChg >= 5 && surgeChg <= 8) score += 3
  if (flagDays >= 3 && flagDays <= 5) score += 3
  var prevAvgVol = 0
  for (var i = Math.max(0, recent.length - 6); i < recent.length - 1; i++) prevAvgVol += recent[i].volume
  prevAvgVol /= Math.min(5, recent.length - 1)
  if (prevAvgVol > 0 && today.volume / prevAvgVol >= 1.3) score += 2
  return { detected: true, score: score }
}

function detectBigCandleConfirmV84(klines, dateIdx) {
  if (dateIdx < 5 || dateIdx >= klines.length) return { detected: false, score: 0 }
  var today = klines[dateIdx]
  var chg = (today.close - today.open) / today.open * 100
  if (chg < 3) return { detected: false, score: 0 }
  var bodySize = Math.abs(today.close - today.open)
  var totalRange = today.high - today.low
  if (totalRange <= 0 || bodySize / totalRange < 0.6) return { detected: false, score: 0 }
  var prevAvgVol = 0
  for (var i = dateIdx - 5; i < dateIdx; i++) prevAvgVol += klines[i].volume
  prevAvgVol /= 5
  if (prevAvgVol <= 0 || today.volume / prevAvgVol < 1.5) return { detected: false, score: 0 }
  var score = 15
  if (chg >= 5) score += 5
  else if (chg >= 4) score += 3
  if (today.volume / prevAvgVol >= 2.0) score += 3
  else if (today.volume / prevAvgVol >= 1.8) score += 2
  if (bodySize / totalRange >= 0.8) score += 2
  return { detected: true, score: score }
}

function detectMA20BounceV84(klines, dateIdx) {
  if (dateIdx < 25 || dateIdx >= klines.length) return { detected: false, score: 0 }
  var closes = []
  for (var i = dateIdx - 20; i <= dateIdx; i++) closes.push(klines[i].close)
  var ma20 = closes.reduce(function(a, b) { return a + b }, 0) / closes.length
  var today = klines[dateIdx]
  var yesterday = klines[dateIdx - 1]
  if (yesterday.low >= ma20 * 0.98) return { detected: false, score: 0 }
  if (today.close <= ma20) return { detected: false, score: 0 }
  var score = 15
  if (today.close > ma20 * 1.02) score += 3
  var prev5AvgVol = 0
  for (var i = dateIdx - 5; i < dateIdx; i++) prev5AvgVol += klines[i].volume
  prev5AvgVol /= 5
  if (prev5AvgVol > 0 && today.volume / prev5AvgVol >= 1.3) score += 3
  var ma5 = 0
  for (var i = dateIdx - 4; i <= dateIdx; i++) ma5 += klines[i].close
  ma5 /= 5
  if (ma5 > ma20) score += 2
  return { detected: true, score: score }
}

// V84形态评分: V81形态 + V84新形态直接竞争bestPattern
function calcPatternScoreV84(stock, klines, dateIdx, tech, volumeRatio, bollWidthMax) {
  var base = calcPatternScoreV81(stock, klines, dateIdx, tech, volumeRatio, bollWidthMax)
  var bestPattern = base.pattern, bestScore = base.score

  var db = detectDoubleBottomV84(klines, dateIdx)
  if (db.detected && db.score > bestScore) { bestPattern = 'double_bottom'; bestScore = db.score }
  var fb = detectFlagBreakoutV84(klines, dateIdx)
  if (fb.detected && fb.score > bestScore) { bestPattern = 'flag_breakout'; bestScore = fb.score }
  var bc = detectBigCandleConfirmV84(klines, dateIdx)
  if (bc.detected && bc.score > bestScore) { bestPattern = 'big_candle'; bestScore = bc.score }
  var mb = detectMA20BounceV84(klines, dateIdx)
  if (mb.detected && mb.score > bestScore) { bestPattern = 'ma20_bounce'; bestScore = mb.score }

  return { pattern: bestPattern, score: bestScore, isGapUp: base.isGapUp }
}

// 修复版动态ATR止盈: 只在盈利>=2%后激活追踪止损
function calcDynamicATRExitV2(buyPrice, klines, buyIdx, maxDays, atrVal, atrMult, atrTrailMult) {
  var holdDays = 0, exitPrice = buyPrice, exitReason = 'max_hold'
  var maxReturn = 0, highestPrice = buyPrice
  var stopPrice = buyPrice * 0.92 // 初始8%止损
  var atrProfit = atrVal * atrMult // ATR止盈目标
  var atrTrailing = atrVal * atrTrailMult // 追踪止损距离
  var trailingActive = false // 追踪止损是否激活

  for (var d = 1; d <= maxDays && buyIdx + d < klines.length; d++) {
    var day = klines[buyIdx + d]

    // 更新最高价
    if (day.high > highestPrice) {
      highestPrice = day.high
      // 盈利>=2%后激活追踪止损
      if (!trailingActive && (highestPrice - buyPrice) / buyPrice >= 0.02) {
        trailingActive = true
      }
      // 更新追踪止损
      if (trailingActive) {
        var newStop = highestPrice - atrTrailing
        if (newStop > stopPrice) stopPrice = newStop
      }
    }

    // 止损
    if (day.low <= stopPrice) {
      exitPrice = stopPrice; exitReason = trailingActive ? 'atr_trailing_stop' : 'stop_loss'; holdDays = d; break
    }

    // ATR止盈
    if (day.high >= buyPrice + atrProfit) {
      exitPrice = Math.min(day.high, buyPrice + atrProfit); exitReason = 'atr_profit'; holdDays = d; break
    }

    exitPrice = day.close; holdDays = d
  }

  var finalReturn = (exitPrice - buyPrice) / buyPrice * 100
  var hReturn = (highestPrice - buyPrice) / buyPrice * 100
  if (hReturn > maxReturn) maxReturn = hReturn
  return { exitPrice: exitPrice, exitDay: holdDays, finalReturn: Math.round(finalReturn * 100) / 100, exitReason: exitReason, maxReturn: Math.round(maxReturn * 100) / 100 }
}

// 放宽版MACD柱状图递增: 只需最近2个histogram递增且>0
function checkMACDHistogramIncreasingV2(klines, dateIdx) {
  if (dateIdx < 5) return false
  var closes = []
  for (var i = 0; i <= dateIdx; i++) closes.push(klines[i].close)
  var macdObj = calcMACD(closes)
  if (!macdObj || !macdObj.histogram || macdObj.histogram.length < 2) return false
  var hist = macdObj.histogram
  var last2 = hist.slice(-2)
  return last2[1] > last2[0] && last2[1] > 0
}

// 量价配合评分
function calcVolPriceScoreV84(klines, dateIdx) {
  if (dateIdx < 10) return 0
  var score = 0
  var recent5 = klines.slice(dateIdx - 4, dateIdx + 1)
  var upDays = 0, upVol = 0, downVol = 0
  for (var i = 0; i < recent5.length; i++) {
    if (recent5[i].close > recent5[i].open) { upDays++; upVol += recent5[i].volume }
    else { downVol += recent5[i].volume }
  }
  if (upDays >= 3 && upVol > downVol * 1.2) score += 5
  else if (upDays >= 3 && upVol > downVol) score += 3
  var vol5 = 0
  for (var i = dateIdx - 4; i <= dateIdx; i++) vol5 += klines[i].volume
  vol5 /= 5
  var vol10 = 0
  for (var i = dateIdx - 9; i <= dateIdx; i++) vol10 += klines[i].volume
  vol10 /= 10
  if (vol5 > vol10 * 1.3) score += 3
  else if (vol5 > vol10 * 1.1) score += 1
  return score
}

// ===== 选股函数 =====
function simulatePickV84(dayQuotes, klineMap, dateIdxMap, topN, marketEnv, strategy) {
  var params = V43B_PARAMS
  var minScore = strategy.minScore || 55
  var scored = []
  var adxThreshold = 20, bollThreshold = 0.85, maxConsecUp = strategy.maxConsecUp || 5
  if (params.adaptiveMarket && marketEnv) {
    if (marketEnv.trend === "bear") {
      adxThreshold = Math.max(20, adxThreshold + 8)
      bollThreshold = Math.max(0.70, bollThreshold - 0.15)
      if (params.dynamicConsec && !strategy.maxConsecUp) maxConsecUp = params.consecBear || 3
    } else if (marketEnv.trend === "bull") {
      bollThreshold = Math.min(0.92, bollThreshold + 0.05)
      if (params.dynamicConsec && !strategy.maxConsecUp) maxConsecUp = params.consecBull || 6
    } else { if (params.dynamicConsec && !strategy.maxConsecUp) maxConsecUp = params.consecNeutral || 5 }
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
    if (strategy.vrMin && volumeRatio < strategy.vrMin) continue
    if (strategy.rsiMax && tech.rsi > strategy.rsiMax) continue
    if (strategy.chgMax && stock.changePct > strategy.chgMax) continue
    if (strategy.chgMin && stock.changePct < strategy.chgMin) continue

    var pricePos = calcPricePositionVsHigh(klines, dateIdx)
    if (pricePos > (strategy.pricePosThreshold || 0.95)) continue

    var v31Score = calcTechScoreV31(stock, tech.rsi, tech.goldenCross, volumeRatio, tech.bollPosition, code, tech.maSignal, tech.change5d || 0)
    var v10Score = calcTechScoreV10(stock, tech.rsi, tech.goldenCross, volumeRatio, tech.bollPosition, code, tech.maSignal, tech.change5d || 0)
    var techScore = v31Score * 0.75 + v10Score * 0.25

    var patternResult
    var patternMode = strategy.patternMode || 'v81'
    if (patternMode === 'v84_all') {
      patternResult = calcPatternScoreV84(stock, klines, dateIdx, tech, volumeRatio, strategy.bollWidthMax)
    } else {
      patternResult = calcPatternScoreV81(stock, klines, dateIdx, tech, volumeRatio, strategy.bollWidthMax)
    }

    // requirePattern支持数组匹配
    if (strategy.requirePattern) {
      if (Array.isArray(strategy.requirePattern)) {
        if (strategy.requirePattern.indexOf(patternResult.pattern) < 0) continue
      } else {
        if (patternResult.pattern !== strategy.requirePattern) continue
      }
    }

    if (strategy.confirmMACD && !confirmMACDGolden(tech)) continue
    if (strategy.confirmAboveMA20 && !confirmAboveMA20(klines, dateIdx, tech)) continue

    var consecUp = calcConsecutiveUpDays(klines, dateIdx)
    if (consecUp > maxConsecUp) continue

    var totalScore = techScore + patternResult.score * (strategy.patternWeight || 1.0)
    var volPriceScore = 0
    if (strategy.useVolPriceScore) volPriceScore = calcVolPriceScoreV84(klines, dateIdx)
    totalScore += volPriceScore
    // MACD递增加分(非过滤)
    if (strategy.macdIncrBonus && checkMACDHistogramIncreasingV2(klines, dateIdx)) totalScore += strategy.macdIncrBonus

    var mildBonus = 0
    var chg = stock.changePct || 0
    if (chg >= 1 && chg < 3 && volumeRatio >= 1 && volumeRatio < 2) mildBonus = 8
    else if (chg >= 0.5 && chg < 1 && volumeRatio >= 1 && volumeRatio < 1.5) mildBonus = 4
    totalScore += mildBonus
    if (tech.bollPosition > bollThreshold) totalScore *= params.volPenalty || 0.9
    if (tech.obvTrend > 0) totalScore += 3
    if (tech.adx >= adxThreshold) totalScore += 2
    if (totalScore < minScore) continue

    scored.push({
      code: code, name: stock.name, price: stock.price || klines[dateIdx].close,
      changePct: stock.changePct || 0, totalScore: totalScore,
      techScore: techScore, patternScore: patternResult.score, patternName: patternResult.pattern,
      volumeRatio: volumeRatio, rsi: tech.rsi, isGapUp: patternResult.isGapUp,
      ma5Slope: tech.ma5Slope, ma10Slope: tech.ma10Slope,
      bollPosition: tech.bollPosition, adx: tech.adx
    })
  }

  scored.sort(function(a, b) { return b.totalScore - a.totalScore })
  var maxIndCount = strategy.maxIndustryCount || 3
  var industryCount = {}
  var result = []
  for (var i = 0; i < scored.length && result.length < topN; i++) {
    var ind = scored[i].patternName || 'other'
    industryCount[ind] = (industryCount[ind] || 0) + 1
    if (industryCount[ind] <= maxIndCount) result.push(scored[i])
  }
  return result
}

// ===== V84策略 (V2: 形态竞争+修复动态ATR+放宽MACD) =====
var V84_STRATEGIES = {
  // ===== V83基线 =====
  "v84_base": Object.assign({}, BASE_EXIT, {
    patternMode: 'v81', atrExit: true, atrMultiplier: 1.2, maxConsecUp: 4,
    ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze',
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmAboveMA20: true
  }),

  // ===== V4最佳: boll_or_flag + ATR1.3 (V4冠军) =====
  "v84_boll_or_flag_atr13": Object.assign({}, BASE_EXIT, {
    patternMode: 'v84_all', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
    ma5Min: 0.1, ma10Min: 0.02,
    requirePattern: ['boll_squeeze', 'flag_breakout'],
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmAboveMA20: true
  }),

  // ===== V5: 在V4最佳基础上微调 =====
  "v84_bof_atr13_pw25": Object.assign({}, BASE_EXIT, {
    patternMode: 'v84_all', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
    ma5Min: 0.1, ma10Min: 0.02,
    requirePattern: ['boll_squeeze', 'flag_breakout'],
    minScore: 55, patternWeight: 2.5, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmAboveMA20: true
  }),
  "v84_bof_atr13_bw01": Object.assign({}, BASE_EXIT, {
    patternMode: 'v84_all', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
    ma5Min: 0.1, ma10Min: 0.02,
    requirePattern: ['boll_squeeze', 'flag_breakout'],
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.10,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmAboveMA20: true
  }),
  "v84_bof_atr13_vr08": Object.assign({}, BASE_EXIT, {
    patternMode: 'v84_all', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
    ma5Min: 0.1, ma10Min: 0.02,
    requirePattern: ['boll_squeeze', 'flag_breakout'],
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 0.8, rsiMax: 60,
    confirmMACD: true, confirmAboveMA20: true
  }),
  "v84_bof_atr13_chg08": Object.assign({}, BASE_EXIT, {
    patternMode: 'v84_all', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
    ma5Min: 0.1, ma10Min: 0.02,
    requirePattern: ['boll_squeeze', 'flag_breakout'],
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 0.8, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmAboveMA20: true
  }),
  "v84_bof_atr13_chg08_3": Object.assign({}, BASE_EXIT, {
    patternMode: 'v84_all', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
    ma5Min: 0.1, ma10Min: 0.02,
    requirePattern: ['boll_squeeze', 'flag_breakout'],
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 0.8, chgMax: 3, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmAboveMA20: true
  }),
  "v84_bof_atr13_macd_bonus": Object.assign({}, BASE_EXIT, {
    patternMode: 'v84_all', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
    ma5Min: 0.1, ma10Min: 0.02,
    requirePattern: ['boll_squeeze', 'flag_breakout'],
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmAboveMA20: true, macdIncrBonus: 3
  }),
  "v84_bof_atr13_vp": Object.assign({}, BASE_EXIT, {
    patternMode: 'v84_all', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
    ma5Min: 0.1, ma10Min: 0.02,
    requirePattern: ['boll_squeeze', 'flag_breakout'],
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmAboveMA20: true, useVolPriceScore: true
  }),
  "v84_bof_atr13_vp_macd": Object.assign({}, BASE_EXIT, {
    patternMode: 'v84_all', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
    ma5Min: 0.1, ma10Min: 0.02,
    requirePattern: ['boll_squeeze', 'flag_breakout'],
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmAboveMA20: true, useVolPriceScore: true, macdIncrBonus: 3
  }),
  "v84_bof_atr13_pw25_vp": Object.assign({}, BASE_EXIT, {
    patternMode: 'v84_all', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
    ma5Min: 0.1, ma10Min: 0.02,
    requirePattern: ['boll_squeeze', 'flag_breakout'],
    minScore: 55, patternWeight: 2.5, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmAboveMA20: true, useVolPriceScore: true
  }),
  "v84_bof_atr13_no_ma10": Object.assign({}, BASE_EXIT, {
    patternMode: 'v84_all', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
    ma5Min: 0.1,
    requirePattern: ['boll_squeeze', 'flag_breakout'],
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmAboveMA20: true
  }),
  "v84_bof_atr13_no_ma5": Object.assign({}, BASE_EXIT, {
    patternMode: 'v84_all', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
    ma10Min: 0.02,
    requirePattern: ['boll_squeeze', 'flag_breakout'],
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmAboveMA20: true
  }),
  "v84_bof_atr13_consec3": Object.assign({}, BASE_EXIT, {
    patternMode: 'v84_all', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 3,
    ma5Min: 0.1, ma10Min: 0.02,
    requirePattern: ['boll_squeeze', 'flag_breakout'],
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmAboveMA20: true
  }),
  "v84_bof_atr13_consec5": Object.assign({}, BASE_EXIT, {
    patternMode: 'v84_all', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 5,
    ma5Min: 0.1, ma10Min: 0.02,
    requirePattern: ['boll_squeeze', 'flag_breakout'],
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmAboveMA20: true
  }),
  "v84_bof_atr13_top15": Object.assign({}, BASE_EXIT, {
    patternMode: 'v84_all', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
    ma5Min: 0.1, ma10Min: 0.02,
    requirePattern: ['boll_squeeze', 'flag_breakout'],
    minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
    chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
    confirmMACD: true, confirmAboveMA20: true, topN: 15
  })
}
// ===== 主函数 =====
console.log('V84 Backtest V5: boll_or_flag微调')
console.log('Loading cache data...')

var cacheDir = CONFIG.cacheDir
var cacheFiles = fs.readdirSync(cacheDir).filter(function(f) { return f.startsWith('tx_kline_') && f.endsWith('.json') })
console.log('K-line files: ' + cacheFiles.length)

var klineMap = {}
var codes = []
for (var i = 0; i < cacheFiles.length; i++) {
  try {
    var data = JSON.parse(fs.readFileSync(path.join(cacheDir, cacheFiles[i]), 'utf8'))
    var code = cacheFiles[i].replace('tx_kline_', '').replace('.json', '')
    if (data.length >= 60) { klineMap[code] = data; codes.push(code) }
  } catch(e) {}
}
console.log('Valid K-lines: ' + codes.length)

var dateSet = {}
for (var ci = 0; ci < codes.length; ci++) {
  var klines = klineMap[codes[ci]]
  for (var ki = 0; ki < klines.length; ki++) dateSet[klines[ki].date] = true
}
var tradeDates = Object.keys(dateSet).sort()
console.log('Trade dates: ' + tradeDates.length)

var startIdx = 0
for (var si = 0; si < tradeDates.length; si++) {
  if (tradeDates[si] >= '2024-07-01') { startIdx = si; break }
}
console.log('Start from: ' + tradeDates[startIdx])

console.log('Building day quotes...')
var allDayQuotes = {}
var allDateIdxMaps = {}
for (var di = startIdx; di < tradeDates.length - 14; di += 3) {
  var dateStr = tradeDates[di]
  var dayQuotes = [], dateIdxMap = {}
  for (var ci = 0; ci < codes.length; ci++) {
    var code = codes[ci], klines = klineMap[code], idx = -1
    for (var ki = 0; ki < klines.length; ki++) { if (klines[ki].date === dateStr) { idx = ki; break } }
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

console.log('Running backtest...')
var strategyNames = Object.keys(V84_STRATEGIES)
var dynamicPicks = {}
for (var s = 0; s < strategyNames.length; s++) dynamicPicks[strategyNames[s]] = []

for (var si = 0; si < sampleDates.length; si++) {
  var dateStr = sampleDates[si]
  var dayQuotes = allDayQuotes[dateStr]
  var dateIdxMap = allDateIdxMaps[dateStr]
  var marketEnv = calcMarketEnv(allDayQuotes, tradeDates, si)
  for (var s = 0; s < strategyNames.length; s++) {
    var sName = strategyNames[s]
    var strategy = V84_STRATEGIES[sName]
    var picks = simulatePickV84(dayQuotes, klineMap, dateIdxMap, strategy.topN || CONFIG.topN, marketEnv, strategy)
    for (var p = 0; p < picks.length; p++) {
      var pick = picks[p]
      var klines = klineMap[pick.code]
      var buyIdx = dateIdxMap[pick.code]
      var atrVal = calcATR(klines.slice(0, buyIdx + 1), 14)
      var atrMult = strategy.atrMultiplier || 1.0
      var atrTrailMult = strategy.atrTrailingMultiplier || 0.5

      var exit
      if (strategy.dynamicATR) {
        exit = calcDynamicATRExitV2(pick.price, klines, buyIdx, strategy.maxHoldDays || 21, atrVal, atrMult, atrTrailMult)
      } else {
        var atrProfit = atrVal * atrMult
        var atrTrailing = atrVal * atrTrailMult
        exit = calcDynamicExit(pick.price, klines, buyIdx, strategy.maxHoldDays || 21, strategy.stopLoss,
          [{ profitPct: atrProfit / pick.price * 100, trailingPct: atrTrailing / pick.price * 100 }])
      }

      dynamicPicks[sName].push({
        code: pick.code, date: dateStr, patternName: pick.patternName,
        buyPrice: pick.price, exitPrice: exit.exitPrice, exitDay: exit.exitDay,
        finalReturn: exit.finalReturn, exitReason: exit.exitReason, maxReturn: exit.maxReturn,
        totalScore: pick.totalScore
      })
    }
  }
}

var output = []
output.push('V84 Backtest V5: boll_or_flag微调')
output.push('Period: 2024-07-01 ~ 2026-07-24, 3-day sampling, ' + codes.length + ' stocks, ' + sampleDates.length + ' days')
output.push('V83基线: v83b_atr_1.2x_consec4 WR=88.57% AR=5.76% n=35')
output.push('')
output.push('Strategy'.padEnd(32) + '  n   WR%   AR%  AvgD vsV83WR vsV83AR')
output.push('-'.repeat(85))

var v83WR = 88.57, v83AR = 5.76
var results = []

for (var s = 0; s < strategyNames.length; s++) {
  var sName = strategyNames[s]
  var stats = calcDynamicStats(dynamicPicks[sName])
  var vsWR = Math.round((stats.winRate - v83WR) * 100) / 100
  var vsAR = Math.round((stats.avgReturn - v83AR) * 100) / 100
  var line = sName.padEnd(32) +
    String(stats.total).padStart(4) + ' ' +
    String(stats.winRate).padStart(5) + ' ' +
    String(stats.avgReturn).padStart(5) + ' ' +
    String(stats.avgExitDay).padStart(5) + ' ' +
    (vsWR >= 0 ? '+' : '') + String(vsWR).padStart(6) + ' ' +
    (vsAR >= 0 ? '+' : '') + String(vsAR).padStart(5)
  output.push(line)
  results.push({ name: sName, stats: stats, score: stats.winRate * 0.35 + stats.avgReturn * 6 + stats.total * 0.05 })
}

output.push('')
output.push('=== Sorted by composite (WR*0.35 + AR*6 + n*0.05) ===')
results.sort(function(a, b) { return b.score - a.score })
for (var i = 0; i < results.length; i++) {
  output.push(String(i + 1).padStart(2) + '. ' + results[i].name.padEnd(32) +
    ' WR=' + results[i].stats.winRate + '% AR=' + results[i].stats.avgReturn + '% n=' + results[i].stats.total +
    ' Score=' + Math.round(results[i].score * 100) / 100)
}

output.push('')
output.push('=== WR>=89% and AR>=6.0% and n>=30 ===')
for (var i = 0; i < results.length; i++) {
  if (results[i].stats.winRate >= 89 && results[i].stats.avgReturn >= 6.0 && results[i].stats.total >= 30) {
    output.push('  ' + results[i].name + ': WR=' + results[i].stats.winRate + '% AR=' + results[i].stats.avgReturn + '% n=' + results[i].stats.total)
  }
}

output.push('')
output.push('=== WR>=85% and AR>=5.5% and n>=25 ===')
for (var i = 0; i < results.length; i++) {
  if (results[i].stats.winRate >= 85 && results[i].stats.avgReturn >= 5.5 && results[i].stats.total >= 25) {
    output.push('  ' + results[i].name + ': WR=' + results[i].stats.winRate + '% AR=' + results[i].stats.avgReturn + '% n=' + results[i].stats.total)
  }
}

var resultText = output.join('\n')
fs.writeFileSync(path.join(CONFIG.outputDir, 'backtest_V84.txt'), resultText, 'utf8')
console.log('\n' + resultText)
console.log('\nResult saved to results/backtest_V84.txt')