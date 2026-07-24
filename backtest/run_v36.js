// run_v36.js - V36策略回测: V34e基础上探索量价细化+行业集中度+动态权重
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

var { calcTechFromKlines, calcVolumePriceCoord, calcTrendAcceleration, detectConsolidationBreakout, calcCandlePatterns, calcMA, calcADX, calcOBV, calcEMA } = require('./indicators')
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

// ===== V36新增因子 =====

// 1. 量比持续性: 近3日量比都>1.0(持续放量)
function calcSustainedVolume(klines, dateIdx) {
  if (dateIdx < 5) return { score: 0, sustained: false }
  var volRatios = []
  for (var d = dateIdx - 2; d <= dateIdx; d++) {
    if (d < 5) continue
    var todayVol = klines[d].volume
    var sumVol = 0, count = 0
    for (var i = d - 5; i < d; i++) {
      if (klines[i].volume > 0) { sumVol += klines[i].volume; count++ }
    }
    if (count > 0 && sumVol > 0) volRatios.push(todayVol / (sumVol / count))
  }
  if (volRatios.length < 2) return { score: 0, sustained: false }
  var allAbove1 = volRatios.every(function(vr) { return vr > 1.0 })
  var allAbove15 = volRatios.every(function(vr) { return vr > 1.5 })
  var avgVR = volRatios.reduce(function(a, b) { return a + b }, 0) / volRatios.length
  var score = 0
  if (allAbove15 && avgVR >= 1.5 && avgVR <= 3) score = 5  // 持续温和放量
  else if (allAbove1 && avgVR >= 1.0 && avgVR <= 2.5) score = 3  // 持续微放量
  else if (allAbove1) score = 1
  return { score: score, sustained: allAbove1, avgVR: avgVR }
}

// 2. 收盘价位置: 收盘在当日高位(实体占K线上部)
function calcClosePosition(klines, dateIdx) {
  if (dateIdx < 0 || dateIdx >= klines.length) return 0
  var k = klines[dateIdx]
  var range = k.high - k.low
  if (range <= 0) return 0.5
  // 收盘位置 = (close - low) / (high - low)
  return (k.close - k.low) / range
}

// 3. 连续缩量后放量: 前3-5天缩量，今天放量
function calcVolumeSqueezeRelease(klines, dateIdx) {
  if (dateIdx < 8) return { score: 0, detected: false }
  // 计算5日平均量
  function avgVol(start, end) {
    var sum = 0, count = 0
    for (var i = start; i < end; i++) {
      if (klines[i].volume > 0) { sum += klines[i].volume; count++ }
    }
    return count > 0 ? sum / count : 0
  }
  var recent5Avg = avgVol(dateIdx - 5, dateIdx)   // 近5天(含今天)
  var prev5Avg = avgVol(dateIdx - 10, dateIdx - 5) // 前5天
  var base5Avg = avgVol(dateIdx - 15, dateIdx - 10) // 再前5天
  if (prev5Avg <= 0 || base5Avg <= 0) return { score: 0, detected: false }
  // 前5天相对再前5天缩量(缩量比<0.8)，近5天相对前5天放量(放量比>1.3)
  var shrinkRatio = prev5Avg / base5Avg
  var expandRatio = recent5Avg / prev5Avg
  var detected = shrinkRatio < 0.8 && expandRatio > 1.3
  if (detected) {
    var score = 0
    // 缩量程度加分
    if (shrinkRatio < 0.5) score += 3  // 缩量50%以上
    else if (shrinkRatio < 0.7) score += 2
    else score += 1
    // 放量程度加分
    if (expandRatio > 2) score += 2  // 放量2倍以上
    else if (expandRatio > 1.5) score += 1
    return { score: score, detected: true, shrinkRatio: shrinkRatio, expandRatio: expandRatio }
  }
  return { score: 0, detected: false }
}

// 4. MA5斜率增强: MA5近3天斜率(趋势加速)
function calcMA5Accel(klines, dateIdx) {
  if (dateIdx < 10) return { score: 0, accelerating: false }
  var closes = []
  for (var i = dateIdx - 9; i <= dateIdx; i++) closes.push(klines[i].close)
  // 计算最近3个MA5值
  var ma5Values = []
  for (var i = 4; i < closes.length; i++) {
    var sum = 0
    for (var j = i - 4; j <= i; j++) sum += closes[j]
    ma5Values.push(sum / 5)
  }
  if (ma5Values.length < 3) return { score: 0, accelerating: false }
  var slope1 = ma5Values[ma5Values.length - 1] - ma5Values[ma5Values.length - 2]
  var slope2 = ma5Values[ma5Values.length - 2] - ma5Values[ma5Values.length - 3]
  var accelerating = slope1 > slope2 && slope1 > 0 && slope2 > 0
  var score = 0
  if (accelerating) {
    score = 2
    // 斜率增长幅度
    if (slope2 > 0 && slope1 / slope2 > 1.5) score += 2  // 斜率增长50%以上
  }
  return { score: score, accelerating: accelerating }
}

// V36策略
function simulatePickV36(dayQuotes, klineMap, dateIdxMap, topN, params, marketEnv, minScore) {
  var scored = []
  var adxThreshold = 20
  var bollThreshold = 0.85
  var maxConsecUp = 5

  if (params.adaptiveMarket && marketEnv) {
    if (marketEnv.trend === 'bear') {
      adxThreshold = Math.max(20, adxThreshold + (params.bearAdxBump || 8))
      bollThreshold = Math.max(0.70, bollThreshold - (params.bearBollDrop || 0.15))
      if (params.dynamicConsec) maxConsecUp = params.consecBear || 3
    } else if (marketEnv.trend === 'bull') {
      bollThreshold = Math.min(0.92, bollThreshold + (params.bullBollBump || 0.05))
      if (params.dynamicConsec) maxConsecUp = params.consecBull || 6
    } else {
      if (params.dynamicConsec) maxConsecUp = params.consecNeutral || 5
    }
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
    if (v10Score < (minScore || CONFIG.minScore)) continue
    var v31Score = calcTechScoreV31(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)

    // 硬过滤(与V34e一致)
    if (techData.adx < adxThreshold || techData.plusDI <= techData.minusDI) continue
    if (techData.vpCoord && techData.vpCoord.trend === 'bearish_divergence') continue
    if (techData.bollPosition > bollThreshold) continue

    // 连涨限制
    if (params.filterConsecUp || params.dynamicConsec) {
      var consecUp = calcConsecutiveUpDays(klines, dateIdx)
      if (consecUp > maxConsecUp) continue
    }

    // V34e形态加分
    var morphBonus = 0
    if (params.morphBonus) {
      if (techData.consolidationBreakout && techData.consolidationBreakout.score >= 70) morphBonus += 5
      if (techData.trendAccel && techData.trendAccel.accelerating) morphBonus += 3
      if (techData.candlePatterns && techData.candlePatterns.score >= 15) morphBonus += 3
    }

    // V36新因子
    var v36Bonus = 0

    // 持续放量因子
    if (params.sustainedVolume) {
      var sv = calcSustainedVolume(klines, dateIdx)
      v36Bonus += sv.score
    }

    // 收盘高位因子: 收盘在当日K线上部1/3
    if (params.closeHigh) {
      var closePos = calcClosePosition(klines, dateIdx)
      if (closePos >= 0.7) v36Bonus += 2  // 收盘在高位
      else if (closePos >= 0.5) v36Bonus += 1
    }

    // 缩量后放量因子
    if (params.volSqueeze) {
      var vs = calcVolumeSqueezeRelease(klines, dateIdx)
      v36Bonus += vs.score
    }

    // MA5加速因子
    if (params.ma5Accel) {
      var ma = calcMA5Accel(klines, dateIdx)
      v36Bonus += ma.score
    }

    var finalScore = v31Score * (params.v31Weight || 0.75) + v10Score * (params.v10Weight || 0.25) + morphBonus + v36Bonus

    // 软量比确认
    if (params.softVolConfirm && volumeRatio < 1.2) finalScore *= (params.volPenalty || 0.9)

    scored.push({ code: stock.code, price: stock.price, changePct: stock.changePct, score: Math.round(finalScore) })
  }
  scored.sort(function(a, b) { return b.score - a.score })

  // 行业集中度限制
  if (params.industryLimit) {
    scored = limitIndustryConcentration(scored, klineMap, 3)
  }

  return scored.slice(0, topN)
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

// V36变体
var VARIANTS = {
  // V34e基准(硬过滤)
  'V34e_ref': {
    v31Weight: 0.75, v10Weight: 0.25,
    adaptiveMarket: true, morphBonus: true,
    softVolConfirm: true, volPenalty: 0.9,
    dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6,
    _minScore: 60,
  },
  // V36a: +持续放量
  'V36a_sust_vol': {
    v31Weight: 0.75, v10Weight: 0.25,
    adaptiveMarket: true, morphBonus: true,
    softVolConfirm: true, volPenalty: 0.9,
    dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6,
    sustainedVolume: true,
    _minScore: 60,
  },
  // V36b: +收盘高位
  'V36b_close_hi': {
    v31Weight: 0.75, v10Weight: 0.25,
    adaptiveMarket: true, morphBonus: true,
    softVolConfirm: true, volPenalty: 0.9,
    dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6,
    closeHigh: true,
    _minScore: 60,
  },
  // V36c: +缩量后放量
  'V36c_vol_squeeze': {
    v31Weight: 0.75, v10Weight: 0.25,
    adaptiveMarket: true, morphBonus: true,
    softVolConfirm: true, volPenalty: 0.9,
    dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6,
    volSqueeze: true,
    _minScore: 60,
  },
  // V36d: +MA5加速
  'V36d_ma5_accel': {
    v31Weight: 0.75, v10Weight: 0.25,
    adaptiveMarket: true, morphBonus: true,
    softVolConfirm: true, volPenalty: 0.9,
    dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6,
    ma5Accel: true,
    _minScore: 60,
  },
  // V36e: 全部V36新因子
  'V36e_all': {
    v31Weight: 0.75, v10Weight: 0.25,
    adaptiveMarket: true, morphBonus: true,
    softVolConfirm: true, volPenalty: 0.9,
    dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6,
    sustainedVolume: true, closeHigh: true, volSqueeze: true, ma5Accel: true,
    _minScore: 60,
  },
  // V36f: 全部V36 + minScore=55
  'V36f_min55': {
    v31Weight: 0.75, v10Weight: 0.25,
    adaptiveMarket: true, morphBonus: true,
    softVolConfirm: true, volPenalty: 0.9,
    dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6,
    sustainedVolume: true, closeHigh: true, volSqueeze: true, ma5Accel: true,
    _minScore: 55,
  },
  // V36g: 全部V36 + V31权重0.8
  'V36g_v31_80': {
    v31Weight: 0.8, v10Weight: 0.2,
    adaptiveMarket: true, morphBonus: true,
    softVolConfirm: true, volPenalty: 0.9,
    dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6,
    sustainedVolume: true, closeHigh: true, volSqueeze: true, ma5Accel: true,
    _minScore: 60,
  },
}

async function runBacktest() {
  console.log('='.repeat(60))
  console.log('V36 Strategy: V34e + Volume/Price/Closing Refinement')
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
      var picks = simulatePickV36(dayQuotes, klineMap, dateIdxMap, CONFIG.topN, params, marketEnv, minScore)
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
  console.log('V36 Strategy Backtest - V34e + Volume/Price/Closing Refinement')
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
  output.push('V36 Strategy Backtest - V34e + Volume/Price/Closing Refinement')
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

  fs.writeFileSync(path.join(CONFIG.outputDir, 'backtest_v36.txt'), output.join('\n'), 'utf8')
  console.log('\nResults saved to backtest/results/backtest_v36.txt')
}

runBacktest().catch(function(e) { console.error('Error:', e); process.exit(1) })
