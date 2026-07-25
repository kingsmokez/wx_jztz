// run_v47.js - V47策略回测: 围绕V46i(无止损+移动止盈)精细参数扫描
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

var { calcTechFromKlines, calcVolumePriceCoord, calcTrendAcceleration, detectConsolidationBreakout, calcCandlePatterns, calcMA, calcADX, calcOBV, calcEMA, calcATR, calcMASlope } = require('./indicators')
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

function calcEnhancedTechData(klines) {
  var techData = calcTechFromKlines(klines)
  if (!techData) return null
  techData.vpCoord = calcVolumePriceCoord(klines)
  var closes = klines.map(function(k) { return k.close })
  techData.trendAccel = calcTrendAcceleration(closes)
  techData.consolidationBreakout = detectConsolidationBreakout(klines)
  techData.candlePatterns = calcCandlePatterns(klines)
  // V49e: MA10斜率
  var ma10Slope = calcMASlope(closes, 10)
  techData.ma10Slope = ma10Slope
  return techData
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

function simulatePickV43b(dayQuotes, klineMap, dateIdxMap, topN, marketEnv, ma5Min, ma10Min, rsiMax, adxMin, v31W, v10W, minScoreOverride, filters) {
  var params = V43B_PARAMS
  var minScore = minScoreOverride !== undefined ? minScoreOverride : (params._minScore || 55)
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
    var klines = klineMap[stock.code]
    if (!klines) continue
    var dateIdx = dateIdxMap[stock.code]
    if (dateIdx === undefined || dateIdx < 30) continue
    var sliceKlines = klines.slice(Math.max(0, dateIdx - 60), dateIdx + 1)
    var techData = calcEnhancedTechData(sliceKlines)
    if (!techData) continue
    if (techData.momentum20 < -15) continue
    var volumeRatio = calcVolumeRatioFromKlines(klines, dateIdx)
    stock.volumeRatio = volumeRatio
    var v10Score = calcTechScoreV10(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)
    if (v10Score < minScore) continue
    var v31Score = calcTechScoreV31(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)
    if (techData.adx < adxThreshold || techData.plusDI <= techData.minusDI) continue
    if (techData.vpCoord && techData.vpCoord.trend === "bearish_divergence") continue
    if (techData.bollPosition > bollThreshold) continue
    // V50: 每个策略有独立的MA斜率阈值
    if (ma5Min !== undefined && techData.ma5Slope !== undefined && techData.ma5Slope < ma5Min) continue
    if (ma10Min !== undefined && techData.ma10Slope !== undefined && techData.ma10Slope < ma10Min) continue
    // V51: RSI/ADX交互过滤
    if (rsiMax !== undefined && techData.rsi !== undefined && techData.rsi > rsiMax) continue
    if (adxMin !== undefined && techData.adx !== undefined && techData.adx < adxMin) continue
    // V57: 形态/信号硬过滤
    if (filters && filters.requireBullAlign && techData.maSignal !== 'bull') continue
    if (filters && filters.requireVpBull && (!techData.vpCoord || techData.vpCoord.trend !== 'bullish')) continue
    if (filters && filters.requireGapUp && (!techData.candlePatterns || !techData.candlePatterns.patterns || techData.candlePatterns.patterns.indexOf('gap_up') === -1)) continue
    if (filters && filters.requireMacdCross && !techData.goldenCross) continue
    if (filters && filters.requireBigYang && (!techData.candlePatterns || !techData.candlePatterns.patterns || techData.candlePatterns.patterns.indexOf('big_yang') === -1)) continue
    if (filters && filters.requireThreeWhite && (!techData.candlePatterns || !techData.candlePatterns.patterns || techData.candlePatterns.patterns.indexOf('three_white') === -1)) continue
    if (filters && filters.requireLongShadow && (!techData.candlePatterns || !techData.candlePatterns.patterns || techData.candlePatterns.patterns.indexOf('long_lower_shadow') === -1)) continue
    if (params.filterConsecUp || params.dynamicConsec) { var consecUp = calcConsecutiveUpDays(klines, dateIdx); if (consecUp > maxConsecUp) continue }
    if (params.pricePosFilter) { var pp = calcPricePositionVsHigh(klines, dateIdx); if (pp < (params.pricePosThreshold || 0.75)) continue }
    if (params.volumeRatioFilter && volumeRatio < (params.volumeRatioMin || 1.5)) continue
    if (params.rsFilter) { var rs = calcRelativeStrength(klines, dateIdx); if (rs < (params.rsThreshold || 0)) continue }
    var morphBonus = 0
    if (params.morphBonus) {
      if (techData.consolidationBreakout && techData.consolidationBreakout.score >= 70) morphBonus += 5
      if (techData.trendAccel && techData.trendAccel.accelerating) morphBonus += 3
      if (techData.candlePatterns && techData.candlePatterns.score >= 15) morphBonus += 3
    }
    var finalScore = v31Score * (v31W !== undefined ? v31W : (params.v31Weight || 0.75)) + v10Score * (v10W !== undefined ? v10W : (params.v10Weight || 0.25)) + morphBonus
    if (params.softVolConfirm && volumeRatio < 1.2) finalScore *= (params.volPenalty || 0.9)
    scored.push({ code: stock.code, price: stock.price, changePct: stock.changePct, score: Math.round(finalScore), industry: stock.industry || '' })
  }
  scored.sort(function(a, b) { return b.score - a.score })
  return scored.slice(0, topN)
}

// ===== 动态止盈止损(核心创新) =====
function calcDynamicExit(pickPrice, klines, dateIdx, maxHoldDays, stopLossPct, trailingRules) {
  var peak = pickPrice
  var maxReturn = 0
  var maxDrawdown = 0

  for (var d = 1; d <= maxHoldDays; d++) {
    var idx = dateIdx + d
    if (idx >= klines.length) break
    var k = klines[idx]
    if (!k || !k.close || k.close <= 0) break

    var currentReturn = (k.close / pickPrice - 1) * 100
    if (currentReturn > maxReturn) maxReturn = currentReturn
    if (k.close > peak) peak = k.close
    var drawdown = (peak - k.close) / peak * 100
    if (drawdown > maxDrawdown) maxDrawdown = drawdown

    if (currentReturn <= stopLossPct) {
      return { exitDay: d, exitReturn: currentReturn, maxReturn: maxReturn, maxDrawdown: maxDrawdown, exitReason: 'stoploss' }
    }

    if (peak > pickPrice) {
      var profitFromCost = (peak / pickPrice - 1) * 100
      for (var r = 0; r < trailingRules.length; r++) {
        var rule = trailingRules[r]
        if (profitFromCost >= rule.profitPct && drawdown >= rule.trailingPct) {
          return { exitDay: d, exitReturn: currentReturn, maxReturn: maxReturn, maxDrawdown: maxDrawdown, exitReason: 'trailing_' + rule.profitPct + '%' }
        }
      }
    }
  }

  var finalIdx = dateIdx + maxHoldDays
  var finalReturn = null
  if (finalIdx < klines.length && klines[finalIdx] && klines[finalIdx].close > 0) {
    finalReturn = (klines[finalIdx].close / pickPrice - 1) * 100
  }
  return { exitDay: maxHoldDays, exitReturn: finalReturn, maxReturn: maxReturn, maxDrawdown: maxDrawdown, exitReason: 'max_hold' }
}

function calcHoldingReturn(pickPrice, klines, dateIdx, holdDays) {
  var results = {}
  for (var h = 0; h < holdDays.length; h++) {
    var days = holdDays[h]
    var targetIdx = dateIdx + days
    if (targetIdx >= klines.length) { results[days] = null; continue }
    var t = klines[targetIdx]
    if (!t || !t.close || t.close <= 0) { results[days] = null; continue }
    results[days] = Math.round((t.close / pickPrice - 1) * 10000) / 100
  }
  return results
}

function calcStats(allPicks, holdDays) {
  var stats = {}
  for (var h = 0; h < holdDays.length; h++) {
    var days = holdDays[h]
    var returns = []
    for (var i = 0; i < allPicks.length; i++) {
      var r = allPicks[i].returns[days]
      if (r !== null && r !== undefined) returns.push(r)
    }
    if (returns.length === 0) { stats['hold' + days] = { total: 0 }; continue }
    var wins = returns.filter(function(r) { return r > 0 }).length
    var sum = returns.reduce(function(a, b) { return a + b }, 0)
    stats['hold' + days] = { total: returns.length, winRate: Math.round(wins / returns.length * 10000) / 100, avgReturn: Math.round(sum / returns.length * 100) / 100 }
  }
  return stats
}

function calcDynamicStats(allDynamicPicks) {
  var returns = []
  var exitDays = []
  var exitReasons = {}
  var maxReturns = []
  var maxDrawdowns = []
  for (var i = 0; i < allDynamicPicks.length; i++) {
    var p = allDynamicPicks[i]
    if (p.exitReturn !== null && p.exitReturn !== undefined) {
      returns.push(p.exitReturn)
      exitDays.push(p.exitDay)
      maxReturns.push(p.maxReturn)
      maxDrawdowns.push(p.maxDrawdown)
      var reason = p.exitReason || 'unknown'
      exitReasons[reason] = (exitReasons[reason] || 0) + 1
    }
  }
  if (returns.length === 0) return { total: 0 }
  var wins = returns.filter(function(r) { return r > 0 }).length
  var sum = returns.reduce(function(a, b) { return a + b }, 0)
  var avgExitDay = exitDays.reduce(function(a, b) { return a + b }, 0) / exitDays.length
  var avgMaxReturn = maxReturns.reduce(function(a, b) { return a + b }, 0) / maxReturns.length
  var avgMaxDD = maxDrawdowns.reduce(function(a, b) { return a + b }, 0) / maxDrawdowns.length
  return {
    total: returns.length,
    winRate: Math.round(wins / returns.length * 10000) / 100,
    avgReturn: Math.round(sum / returns.length * 100) / 100,
    avgExitDay: Math.round(avgExitDay * 100) / 100,
    avgMaxReturn: Math.round(avgMaxReturn * 100) / 100,
    avgMaxDrawdown: Math.round(avgMaxDD * 100) / 100,
    exitReasons: exitReasons
  }
}

// ===== V47 策略变体: 围绕V46i(无止损+移动止盈)参数扫描 =====
var EXIT_STRATEGIES = {
  // === V58: gapUp深度探索 ===
  // 组1: gapUp+MA10>0(无MA10>0.02, 增加样本)
  "gap_ma10_0_p3": { stopLoss: -100, trailingRules: [
    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }
  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true },
  "gap_ma10_0_4t": { stopLoss: -100, trailingRules: [
    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }
  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true },
  // 组2: gapUp+MA5>0.08(更宽松MA5)
  "gap_m5_008_p3": { stopLoss: -100, trailingRules: [
    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }
  ], maxHoldDays: 18, ma5Min: 0.08, ma10Min: 0.02, requireGapUp: true },
  "gap_m5_008_4t": { stopLoss: -100, trailingRules: [
    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }
  ], maxHoldDays: 18, ma5Min: 0.08, ma10Min: 0.02, requireGapUp: true },
  // 组3: gapUp+MA5>0.12(更严格MA5)
  "gap_m5_012_p3": { stopLoss: -100, trailingRules: [
    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }
  ], maxHoldDays: 18, ma5Min: 0.12, ma10Min: 0.02, requireGapUp: true },
  // 组4: gapUp+MA10>0.05(更严格MA10)
  "gap_m10_005_p3": { stopLoss: -100, trailingRules: [
    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }
  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.05, requireGapUp: true },
  // 组5: gapUp+均线多头排列
  "gap_bull_p3": { stopLoss: -100, trailingRules: [
    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }
  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireGapUp: true, requireBullAlign: true },
  "gap_bull_4t": { stopLoss: -100, trailingRules: [
    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }
  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireGapUp: true, requireBullAlign: true },
  // 组6: 非gapUp但有大阳线(放量阳线)
  "bigYang_p3": { stopLoss: -100, trailingRules: [
    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }
  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireBigYang: true },
  // 组7: gapUp+红三兵
  "gap_threeW_p3": { stopLoss: -100, trailingRules: [
    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }
  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireGapUp: true, requireThreeWhite: true },
  // 组8: gapUp+长下影线
  "gap_shadow_p3": { stopLoss: -100, trailingRules: [
    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }
  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireGapUp: true, requireLongShadow: true },
  // V53基准(对比)
  "v53_baseline": { stopLoss: -100, trailingRules: [
    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }
  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02 },
  // V57 gapUp基准(对比)
  "gapUp_baseline": { stopLoss: -100, trailingRules: [
    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }
  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireGapUp: true }
}

async function runBacktest() {
  console.log('='.repeat(80))
  console.log('V49e Strategy Backtest: MA5>0.1+MA10>0+V48b退出(回测最优)')
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
      var dateIdx = -1
      for (var ki = 0; ki < klines.length; ki++) { if (klines[ki].date === dateStr) { dateIdx = ki; break } }
      if (dateIdx < 30) continue
      var k = klines[dateIdx]
      if (k.close <= 0 || (k.changePct || 0) <= 0) continue
      var prevClose = dateIdx > 0 ? klines[dateIdx - 1].close : k.open
      dayQuotes.push({
        code: code, price: k.close, open: k.open, high: k.high, low: k.low,
        prevClose: prevClose, changePct: k.changePct || 0,
        volume: k.volume, turnover: 0, volumeRatio: 0, pe: 0,
        amplitude: prevClose > 0 ? ((k.high - k.low) / prevClose * 100) : 0,
        circCap: 0, roe: 0, grossMargin: 0, debtRatio: 0, industry: '',
        _dateIdx: dateIdx,
      })
    }

    if (dayQuotes.length === 0) continue
    dayQuotes.sort(function(a, b) { return b.changePct - a.changePct })
    dayQuotes = dayQuotes.slice(0, 200)

    for (var i = 0; i < dayQuotes.length; i++) dateIdxMap[dayQuotes[i].code] = dayQuotes[i]._dateIdx
    allDayQuotes[dateStr] = dayQuotes
    allDateIdxMaps[dateStr] = dateIdxMap
  }
  console.log('Precomputed ' + Object.keys(allDayQuotes).length + ' sampling dates')

  var v43bFixedPicks = []
  var dynamicPicks = {}
  var strategyNames = Object.keys(EXIT_STRATEGIES)
  for (var s = 0; s < strategyNames.length; s++) dynamicPicks[strategyNames[s]] = []
  var v10Picks = []

  var sampleDates = Object.keys(allDayQuotes).sort()
  console.log('\nRunning backtest on ' + sampleDates.length + ' dates...')

  for (var si = 0; si < sampleDates.length; si++) {
    var dateStr = sampleDates[si]
    var dayQuotes = allDayQuotes[dateStr]
    var dateIdxMap = allDateIdxMaps[dateStr]
    var tradeDateIdx = tradeDates.indexOf(dateStr)
    var marketEnv = calcMarketEnv(allDayQuotes, tradeDates, tradeDateIdx)

    for (var i = 0; i < dayQuotes.length; i++) {
      var stock = dayQuotes[i]
      if (!preFilter(stock)) continue
      var klines = klineMap[stock.code]
      if (!klines) continue
      var dateIdx = dateIdxMap[stock.code]
      if (dateIdx === undefined || dateIdx < 30) continue
      var sliceKlines = klines.slice(Math.max(0, dateIdx - 60), dateIdx + 1)
      var techData = calcTechFromKlines(sliceKlines)
      if (!techData) continue
      if (techData.momentum20 < -15) continue
      var volumeRatio = calcVolumeRatioFromKlines(klines, dateIdx)
      stock.volumeRatio = volumeRatio
      var v10Score = calcTechScoreV10(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)
      if (v10Score < CONFIG.minScore) continue
      v10Picks.push({ code: stock.code, price: stock.price, dateIdx: dateIdx, returns: calcHoldingReturn(stock.price, klines, dateIdx, CONFIG.holdDays) })
    }

    // V50: V43b基准选股(无MA斜率过滤)用于fixed hold统计
    var basePicks = simulatePickV43b(dayQuotes, klineMap, dateIdxMap, CONFIG.topN, marketEnv)
    for (var p = 0; p < basePicks.length; p++) {
      var pick = basePicks[p]
      var pickIdx = dateIdxMap[pick.code]
      var klines = klineMap[pick.code]
      v43bFixedPicks.push({ code: pick.code, price: pick.price, dateIdx: pickIdx, returns: calcHoldingReturn(pick.price, klines, pickIdx, CONFIG.holdDays) })
    }
    // V50: 每个策略独立选股(各自的MA斜率阈值)
    for (var s = 0; s < strategyNames.length; s++) {
      var sName = strategyNames[s]
      var strategy = EXIT_STRATEGIES[sName]
      var sPicks = simulatePickV43b(dayQuotes, klineMap, dateIdxMap, CONFIG.topN, marketEnv, strategy.ma5Min, strategy.ma10Min, strategy.rsiMax, strategy.adxMin, strategy.v31W, strategy.v10W, strategy.minScore, strategy)
      for (var p = 0; p < sPicks.length; p++) {
        var pick = sPicks[p]
        var pickIdx = dateIdxMap[pick.code]
        var klines = klineMap[pick.code]
        var dynResult = calcDynamicExit(pick.price, klines, pickIdx, strategy.maxHoldDays, strategy.stopLoss, strategy.trailingRules)
        dynamicPicks[sName].push(dynResult)
      }
    }

    if ((si + 1) % 30 === 0) console.log('  processed ' + (si + 1) + '/' + sampleDates.length + ' dates')
  }

  var output = []
  output.push('================================================================================')
  output.push('V58 Strategy Backtest: gapUp深度探索+组合过滤')
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
  output.push('Strategy'.padEnd(24) + '  n   WR%   AR%  AvgD  MaxR%  MaxDD%  Reasons')
  output.push('-'.repeat(100))

  console.log('\n' + '='.repeat(80))
  console.log('V58 RESULTS')
  console.log('='.repeat(80))

  var summaryLines = []
  var v10Line = 'V10: '
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var d = CONFIG.holdDays[h]
    var s = v10Stats['hold' + d]
    v10Line += d + 'dWR=' + s.winRate + '% ' + d + 'dAR=' + s.avgReturn + '% '
  }
  summaryLines.push(v10Line)

  var v43b10d = v43bStats['hold10']
  summaryLines.push('V43b_fixed10d: n=' + v43bFixedPicks.length + ' WR=' + v43b10d.winRate + '% AR=' + v43b10d.avgReturn + '%')
  summaryLines.push('')
  summaryLines.push('Strategy'.padEnd(24) + '  n   WR%   AR%  AvgD  vsFixedWR  vsFixedAR')
  summaryLines.push('-'.repeat(85))

  for (var s = 0; s < strategyNames.length; s++) {
    var sName = strategyNames[s]
    var stats = calcDynamicStats(dynamicPicks[sName])
    if (stats.total === 0) continue

    var reasonsStr = ''
    var reasonKeys = Object.keys(stats.exitReasons)
    for (var r = 0; r < reasonKeys.length; r++) {
      reasonsStr += reasonKeys[r] + ':' + stats.exitReasons[reasonKeys[r]] + ' '
    }

    var line = sName.padEnd(24) + String(stats.total).padStart(4) +
      String(stats.winRate).padStart(6) + String(stats.avgReturn).padStart(6) +
      String(stats.avgExitDay).padStart(6) + String(stats.avgMaxReturn).padStart(7) +
      String(stats.avgMaxDrawdown).padStart(7) + '  ' + reasonsStr.trim()
    output.push(line)

    var wrDiff = (stats.winRate - v43b10d.winRate).toFixed(2)
    var arDiff = (stats.avgReturn - v43b10d.avgReturn).toFixed(2)
    var summaryLine = sName.padEnd(24) + String(stats.total).padStart(4) +
      String(stats.winRate).padStart(6) + String(stats.avgReturn).padStart(6) +
      String(stats.avgExitDay).padStart(6) +
      (wrDiff >= 0 ? '+' : '') + wrDiff.padStart(10) +
      (arDiff >= 0 ? '+' : '') + arDiff.padStart(10)
    summaryLines.push(summaryLine)

    if (stats.winRate > v43b10d.winRate && stats.avgReturn > v43b10d.avgReturn) {
      console.log('>>> ' + sName + ': WR=' + stats.winRate + '% AR=' + stats.avgReturn + '% avgDay=' + stats.avgExitDay + ' BEATS FIXED!')
    }
  }

  console.log('\n' + summaryLines.join('\n'))

  output.push('')
  output.push('================================================================================')
  output.push('SUMMARY')
  output.push('================================================================================')
  output.push(summaryLines.join('\n'))

  fs.writeFileSync(path.join(CONFIG.outputDir, 'backtest_v58.txt'), output.join('\n'), 'utf8')
  console.log('\nResults saved to backtest/results/backtest_v48.txt')
}

runBacktest().catch(function(e) { console.error('Error:', e); process.exit(1) })
