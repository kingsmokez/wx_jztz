// run_v45.js - V45策略回测: V43b+形态加分+评分优化: 基于p95价格位置硬过滤深挖最优参数
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

var { calcTechFromKlines, calcVolumePriceCoord, calcTrendAcceleration, detectConsolidationBreakout, calcCandlePatterns, calcMA, calcADX, calcOBV, calcEMA, detectPatterns } = require('./indicators')
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
  return Math.round(todayVol / (sumVol / count) * 100) / 100
}

function calcEnhancedTechData(klines) {
  var techData = calcTechFromKlines(klines)
  if (!techData) return null
  techData.vpCoord = calcVolumePriceCoord(klines)
  var closes = klines.map(function(k) { return k.close })
  techData.trendAccel = calcTrendAcceleration(closes)
  techData.consolidationBreakout = detectConsolidationBreakout(klines)
  techData.candlePatterns = calcCandlePatterns(klines)
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

// ===== V37新增硬过滤因子 =====

// 1. 相对强度(Relative Strength): 股票20日涨幅
function calcRelativeStrength(klines, dateIdx) {
  if (dateIdx < 20) return 0
  return (klines[dateIdx].close - klines[dateIdx - 20].close) / klines[dateIdx - 20].close * 100
}

// 2. 价格位置: 当前价相对60日最高价的位置 (0-1, 1=在新高)
function calcPricePositionVsHigh(klines, dateIdx) {
  if (dateIdx < 20) return 0
  var high60 = -Infinity
  var startIdx = Math.max(0, dateIdx - 60)
  for (var i = startIdx; i <= dateIdx; i++) { if (klines[i].high > high60) high60 = klines[i].high }
  if (high60 <= 0) return 0
  return klines[dateIdx].close / high60
}

// 3. 波动收缩(Volatility Contraction): BOLL宽度变化比
function calcVolatilityContraction(klines, dateIdx) {
  if (dateIdx < 35) return { contracting: false, ratio: 1 }
  var closes = []
  for (var i = dateIdx - 19; i <= dateIdx; i++) closes.push(klines[i].close)
  var ma20 = calcMA(closes, 20)
  var v1 = 0
  for (var i = 0; i < closes.length; i++) v1 += Math.pow(closes[i] - ma20, 2)
  var std = Math.sqrt(v1 / 20)
  var currentWidth = ma20 > 0 ? (2 * std) / ma20 : 0
  var closes5 = []
  for (var i = dateIdx - 24; i <= dateIdx - 5; i++) closes5.push(klines[i].close)
  var ma20_5 = calcMA(closes5, 20)
  var v2 = 0
  for (var i = 0; i < closes5.length; i++) v2 += Math.pow(closes5[i] - ma20_5, 2)
  var std5 = Math.sqrt(v2 / 20)
  var prevWidth = ma20_5 > 0 ? (2 * std5) / ma20_5 : 0
  if (prevWidth <= 0) return { contracting: false, ratio: 1 }
  var ratio = currentWidth / prevWidth
  return { contracting: ratio < 0.9, ratio: ratio }
}

// 4. 量能枯竭后放量: 近5日中有3+天成交量低于均量70%，今天量比>1.5
function calcVolumeDryUpThenSurge(klines, dateIdx) {
  if (dateIdx < 15) return { detected: false, dryDays: 0 }
  var avgVol14 = 0
  for (var i = dateIdx - 14; i < dateIdx; i++) avgVol14 += klines[i].volume
  avgVol14 /= 14
  if (avgVol14 <= 0) return { detected: false, dryDays: 0 }
  var dryDays = 0
  for (var i = dateIdx - 5; i < dateIdx; i++) { if (klines[i].volume < avgVol14 * 0.7) dryDays++ }
  var todayVolRatio = klines[dateIdx].volume / avgVol14
  return { detected: dryDays >= 3 && todayVolRatio > 1.5, dryDays: dryDays, volRatio: todayVolRatio }
}

// 5. 动量同向: 5日和20日动量都向上
function calcMomentumAlignment(klines, dateIdx) {
  if (dateIdx < 20) return false
  var mom5 = (klines[dateIdx].close - klines[dateIdx - 5].close) / klines[dateIdx - 5].close * 100
  var mom20 = (klines[dateIdx].close - klines[dateIdx - 20].close) / klines[dateIdx - 20].close * 100
  return mom5 > 0 && mom20 > 0
}

// V37策略: V34e硬过滤 + 新增硬过滤条件
function simulatePickV37(dayQuotes, klineMap, dateIdxMap, topN, params, marketEnv, minScore) {
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
  var effectiveMinScore = minScore
  if (params.dynamicMinScore && marketEnv) {
    if (marketEnv.trend === "bear") effectiveMinScore = Math.max(minScore, params.bearMinScore || 65)
    else if (marketEnv.trend === "bull") effectiveMinScore = Math.min(minScore, params.bullMinScore || 55)
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
    if (v10Score < effectiveMinScore) continue
    var v31Score = calcTechScoreV31(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)
    if (techData.adx < adxThreshold || techData.plusDI <= techData.minusDI) continue
    if (techData.vpCoord && techData.vpCoord.trend === "bearish_divergence") continue
    if (techData.bollPosition > bollThreshold) continue
    if (params.filterConsecUp || params.dynamicConsec) { var consecUp = calcConsecutiveUpDays(klines, dateIdx); if (consecUp > maxConsecUp) continue }
    if (params.rsFilter && !params.dynamicRS) { var rs = calcRelativeStrength(klines, dateIdx); if (rs < (params.rsThreshold || 0)) continue }
    if (params.pricePosFilter) { var pp = calcPricePositionVsHigh(klines, dateIdx); if (pp < (params.pricePosThreshold || 0.75)) continue }
    if (params.vcFilter) { var vc = calcVolatilityContraction(klines, dateIdx); if (vc.ratio > (params.vcRatioThreshold || 1.1)) continue }
    if (params.volDryFilter) { var vd = calcVolumeDryUpThenSurge(klines, dateIdx); if (!vd.detected) continue }
    if (params.momAlignFilter) { if (!calcMomentumAlignment(klines, dateIdx)) continue }
    // V40: 量比硬过滤
    if (params.volumeRatioFilter && volumeRatio < (params.volumeRatioMin || 1.5)) continue
    // V44: 动态RS阈值(根据市场环境调整)
    if (params.dynamicRS && marketEnv) {
      var effectiveRS = params.rsThreshold || 0
      if (marketEnv.trend === "bear") effectiveRS = Math.min(effectiveRS, params.rsBear || 3)
      else if (marketEnv.trend === "bull") effectiveRS = Math.max(effectiveRS, params.rsBull || 7)
      if (calcRelativeStrength(klines, dateIdx) < effectiveRS) continue
    }
    var morphBonus = 0
    // V45: 形态加分(杯柄+平台突破+回踩再起+连阳+底部反转+均线支撑)
    if (params.patternBonus) {
      var patterns = detectPatterns(sliceKlines)
      if (patterns) {
        morphBonus += patterns.cupHandle || 0
        morphBonus += patterns.breakout || 0
        morphBonus += patterns.pullbackRestart || 0
        morphBonus += patterns.consecutiveUp || 0
        morphBonus += patterns.bottomReversal || 0
        morphBonus += patterns.maSupport || 0
      }
    }
    // V45: ADX加分(ADX>30额外加分)
    if (params.adxBonus && techData.adx > 30) morphBonus += 3
    // V45: RS加分(RS越高加分越多)
    if (params.rsBonus) {
      var rs = calcRelativeStrength(klines, dateIdx)
      if (rs >= 10) morphBonus += 5
      else if (rs >= 8) morphBonus += 3
    }
    // V45: 价格位置加分(越接近新高加分越多)
    if (params.pricePosBonus) {
      var pp = calcPricePositionVsHigh(klines, dateIdx)
      if (pp >= 0.98) morphBonus += 4
      else if (pp >= 0.96) morphBonus += 2
    }
    // V45: 量比权重提升
    if (params.volumeRatioWeight && volumeRatio >= 2.0) morphBonus += 2
    if (params.morphBonus) {
      if (techData.consolidationBreakout && techData.consolidationBreakout.score >= 70) morphBonus += 5
      if (techData.trendAccel && techData.trendAccel.accelerating) morphBonus += 3
      if (techData.candlePatterns && techData.candlePatterns.score >= 15) morphBonus += 3
    }
    var finalScore = v31Score * (params.v31Weight || 0.75) + v10Score * (params.v10Weight || 0.25) + morphBonus
    if (params.softVolConfirm && volumeRatio < 1.2) finalScore *= (params.volPenalty || 0.9)
    if (params.patternMinScore && morphBonus < params.patternMinScore) continue
    scored.push({ code: stock.code, price: stock.price, changePct: stock.changePct, score: Math.round(finalScore) })
  }
  scored.sort(function(a, b) { return b.score - a.score })
  if (params.industryLimit) scored = limitIndustryConcentration(scored, klineMap, 3)
  return scored.slice(0, params._topN || topN)
}
function limitIndustryConcentration(scored, klineMap, maxPerIndustry) {
  var industryCount = {}
  var result = []
  for (var i = 0; i < scored.length; i++) {
    var s = scored[i]
    var ind = s.industry || 'unknown'
    var count = industryCount[ind] || 0
    if (count < maxPerIndustry) {
      result.push(s)
      industryCount[ind] = count + 1
    }
  }
  return result
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
    stats['hold' + days] = {
      total: returns.length,
      winRate: Math.round(wins / returns.length * 10000) / 100,
      avgReturn: Math.round(sum / returns.length * 100) / 100
    }
  }
  return stats
}

// V39变体 - 基于V38k_p95继续深挖
var VARIANTS = {
  // V43b基准 (10dWR=57.49%, 10dAR=2.97%, n=167)
  "V43b_ref": { v31Weight: 0.75, v10Weight: 0.25, adaptiveMarket: true, morphBonus: true, softVolConfirm: true, volPenalty: 0.9, dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6, pricePosFilter: true, pricePosThreshold: 0.95, rsFilter: true, rsThreshold: 6, volumeRatioFilter: true, volumeRatioMin: 1.5, _minScore: 55 },
  // V45a: V43b+形态加分(杯柄+平台突破+回踩再起)
  "V45a_pattern_bonus": { v31Weight: 0.75, v10Weight: 0.25, adaptiveMarket: true, morphBonus: true, softVolConfirm: true, volPenalty: 0.9, dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6, pricePosFilter: true, pricePosThreshold: 0.95, rsFilter: true, rsThreshold: 6, volumeRatioFilter: true, volumeRatioMin: 1.5, patternBonus: true, _minScore: 55 },
  // V45b: V43b+形态加分+形态硬过滤(至少1个形态)
  "V45b_pattern_hybrid": { v31Weight: 0.75, v10Weight: 0.25, adaptiveMarket: true, morphBonus: true, softVolConfirm: true, volPenalty: 0.9, dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6, pricePosFilter: true, pricePosThreshold: 0.95, rsFilter: true, rsThreshold: 6, volumeRatioFilter: true, volumeRatioMin: 1.5, patternBonus: true, patternMinScore: 3, _minScore: 55 },
  // V45c: V43b+形态加分+min50(更宽松)
  "V45c_pattern_m50": { v31Weight: 0.75, v10Weight: 0.25, adaptiveMarket: true, morphBonus: true, softVolConfirm: true, volPenalty: 0.9, dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6, pricePosFilter: true, pricePosThreshold: 0.95, rsFilter: true, rsThreshold: 6, volumeRatioFilter: true, volumeRatioMin: 1.5, patternBonus: true, _minScore: 50 },
  // V45d: V43b+形态加分+量比权重提升
  "V45d_pattern_vrw": { v31Weight: 0.75, v10Weight: 0.25, adaptiveMarket: true, morphBonus: true, softVolConfirm: true, volPenalty: 0.9, dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6, pricePosFilter: true, pricePosThreshold: 0.95, rsFilter: true, rsThreshold: 6, volumeRatioFilter: true, volumeRatioMin: 1.5, patternBonus: true, volumeRatioWeight: true, _minScore: 55 },
  // V45e: V43b+ADX加分(ADX>30额外加分)
  "V45e_adx_bonus": { v31Weight: 0.75, v10Weight: 0.25, adaptiveMarket: true, morphBonus: true, softVolConfirm: true, volPenalty: 0.9, dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6, pricePosFilter: true, pricePosThreshold: 0.95, rsFilter: true, rsThreshold: 6, volumeRatioFilter: true, volumeRatioMin: 1.5, adxBonus: true, _minScore: 55 },
  // V45f: V43b+RS加分(RS越高加分越多)
  "V45f_rs_bonus": { v31Weight: 0.75, v10Weight: 0.25, adaptiveMarket: true, morphBonus: true, softVolConfirm: true, volPenalty: 0.9, dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6, pricePosFilter: true, pricePosThreshold: 0.95, rsFilter: true, rsThreshold: 6, volumeRatioFilter: true, volumeRatioMin: 1.5, rsBonus: true, _minScore: 55 },
  // V45g: V43b+价格位置加分(越接近新高加分越多)
  "V45g_pp_bonus": { v31Weight: 0.75, v10Weight: 0.25, adaptiveMarket: true, morphBonus: true, softVolConfirm: true, volPenalty: 0.9, dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6, pricePosFilter: true, pricePosThreshold: 0.95, rsFilter: true, rsThreshold: 6, volumeRatioFilter: true, volumeRatioMin: 1.5, pricePosBonus: true, _minScore: 55 },
  // V45h: V43b+所有加分组合
  "V45h_all_bonus": { v31Weight: 0.75, v10Weight: 0.25, adaptiveMarket: true, morphBonus: true, softVolConfirm: true, volPenalty: 0.9, dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6, pricePosFilter: true, pricePosThreshold: 0.95, rsFilter: true, rsThreshold: 6, volumeRatioFilter: true, volumeRatioMin: 1.5, patternBonus: true, adxBonus: true, rsBonus: true, pricePosBonus: true, _minScore: 55 },
}

async function runBacktest() {
  console.log('='.repeat(60))
  console.log('V45 Strategy: V43b + Pattern Bonus + Score Optimization')
  console.log('='.repeat(60))

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

  for (var di = startIdx; di < tradeDates.length - 10; di += 3) {
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

  var v10Picks = []
  var variantPicks = {}
  var variantNames = Object.keys(VARIANTS)
  for (var v = 0; v < variantNames.length; v++) variantPicks[variantNames[v]] = []

  var sampleDates = Object.keys(allDayQuotes).sort()
  console.log('\nRunning backtest on ' + sampleDates.length + ' dates...')

  for (var si = 0; si < sampleDates.length; si++) {
    var dateStr = sampleDates[si]
    var dayQuotes = allDayQuotes[dateStr]
    var dateIdxMap = allDateIdxMaps[dateStr]
    var tradeDateIdx = tradeDates.indexOf(dateStr)
    var marketEnv = calcMarketEnv(allDayQuotes, tradeDates, tradeDateIdx)

    // V10 baseline
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

    for (var v = 0; v < variantNames.length; v++) {
      var vName = variantNames[v]
      var params = VARIANTS[vName]
      var minScore = params._minScore || CONFIG.minScore
      var picks = simulatePickV37(dayQuotes, klineMap, dateIdxMap, CONFIG.topN, params, marketEnv, minScore)
      for (var p = 0; p < picks.length; p++) {
        var pick = picks[p]
        var pickIdx = dateIdxMap[pick.code]
        variantPicks[vName].push({ code: pick.code, price: pick.price, dateIdx: pickIdx, returns: calcHoldingReturn(pick.price, klineMap[pick.code], pickIdx, CONFIG.holdDays) })
      }
    }

    if ((si + 1) % 30 === 0) console.log('  processed ' + (si + 1) + '/' + sampleDates.length + ' dates')
  }

  // Calculate and output stats
  console.log('\n' + '='.repeat(80))
  console.log('V45 Strategy Backtest - V43b + Pattern Bonus + Score Optimization')
  console.log('='.repeat(80))

  var v10Stats = calcStats(v10Picks, CONFIG.holdDays)
  console.log('\n--- V10 BASELINE (n=' + v10Picks.length + ') ---')
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var d = CONFIG.holdDays[h]
    var s = v10Stats['hold' + d]
    console.log('  Hold ' + d + 'd: winRate=' + s.winRate + '% avgReturn=' + s.avgReturn + '%')
  }

  var output = []
  output.push('================================================================================')
  output.push('V45 Strategy Backtest - V43b + Pattern Bonus + Score Optimization')
  output.push('================================================================================')
  output.push('')
  output.push('--- V10 BASELINE (n=' + v10Picks.length + ') ---')
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var d = CONFIG.holdDays[h]
    var s = v10Stats['hold' + d]
    output.push('  Hold ' + d + 'd: winRate=' + s.winRate + '% avgReturn=' + s.avgReturn + '%')
  }

  var summary = []
  var v10Line = 'V10: '
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var d = CONFIG.holdDays[h]
    var s = v10Stats['hold' + d]
    v10Line += d + 'dWR=' + s.winRate + '% ' + d + 'dAR=' + s.avgReturn + '% '
  }
  summary.push(v10Line)
  summary.push('')
  summary.push('Variant'.padEnd(22) + 'n    3dWR  3dAR  5dWR  5dAR  7dWR  7dAR 10dWR 10dAR  BeatV10')
  summary.push('-'.repeat(100))

  var winners = []
  for (var v = 0; v < variantNames.length; v++) {
    var vName = variantNames[v]
    var picks = variantPicks[vName]
    var stats = calcStats(picks, CONFIG.holdDays)
    var n = picks.length
    var beatCount = 0, totalMetrics = 0
    var line = vName.padEnd(22) + String(n).padStart(5)
    for (var h = 0; h < CONFIG.holdDays.length; h++) {
      var d = CONFIG.holdDays[h]
      var s = stats['hold' + d]
      var v10S = v10Stats['hold' + d]
      line += String(s.winRate).padStart(6) + String(s.avgReturn).padStart(6)
      if (s.winRate > v10S.winRate) beatCount++
      if (s.avgReturn > v10S.avgReturn) beatCount++
      totalMetrics += 2
    }
    line += '  ' + beatCount + '/' + totalMetrics
    summary.push(line)
    if (beatCount >= totalMetrics - 1) winners.push({ name: vName, n: n, stats: stats, beatCount: beatCount, totalMetrics: totalMetrics })
  }

  console.log('\n' + '='.repeat(80))
  console.log('SUMMARY')
  console.log('='.repeat(80))
  console.log(summary.join('\n'))

  output.push('')
  output.push('================================================================================')
  output.push('SUMMARY')
  output.push('================================================================================')
  output.push(summary.join('\n'))

  if (winners.length > 0) {
    console.log('\n' + '='.repeat(80))
    console.log('WINNERS: Beat V10 in ' + (winners[0].totalMetrics - 1) + '+ metrics!')
    console.log('='.repeat(80))
    for (var w = 0; w < winners.length; w++) {
      var winner = winners[w]
      console.log('\n' + winner.name + ' (n=' + winner.n + '):')
      for (var h = 0; h < CONFIG.holdDays.length; h++) {
        var d = CONFIG.holdDays[h]
        var s = winner.stats['hold' + d]
        var v10S = v10Stats['hold' + d]
        console.log('  ' + d + 'dWR: ' + v10S.winRate + '% -> ' + s.winRate + '% (' + (s.winRate > v10S.winRate ? '+' : '') + (s.winRate - v10S.winRate).toFixed(2) + '%)')
        console.log('  ' + d + 'dAR: ' + v10S.avgReturn + '% -> ' + s.avgReturn + '% (' + (s.avgReturn > v10S.avgRate ? '+' : '') + (s.avgReturn - v10S.avgReturn).toFixed(2) + '%)')
      }
    }
  }

  fs.writeFileSync(path.join(CONFIG.outputDir, 'backtest_v45.txt'), output.join('\n'), 'utf8')
  console.log('\nResults saved to backtest/results/backtest_v45.txt')
}

runBacktest().catch(function(e) { console.error('Error:', e); process.exit(1) })
