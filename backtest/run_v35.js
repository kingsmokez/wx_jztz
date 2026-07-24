// run_v35.js - V35策略回测: V34e基础 + 新形态因子探索
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

var { calcTechFromKlines, calcVolumePriceCoord, calcTrendAcceleration, detectConsolidationBreakout, calcCandlePatterns, calcMA, calcADX, calcOBV } = require('./indicators')
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

// ===== V35新增形态因子 =====

// 1. 放量突破MA20: 今日放量且价格突破20日均线
function calcBreakoutMA20(klines, dateIdx) {
  if (dateIdx < 20) return { detected: false, score: 0 }
  var closes = []
  var vols = []
  for (var i = dateIdx - 20; i <= dateIdx; i++) {
    closes.push(klines[i].close)
    vols.push(klines[i].volume)
  }
  var ma20 = 0
  for (var i = 0; i < 20; i++) ma20 += closes[i]
  ma20 = ma20 / 20
  var todayClose = closes[20]
  var prevClose = closes[19]
  var todayVol = vols[20]
  var avgVol = 0
  for (var i = 0; i < 20; i++) avgVol += vols[i]
  avgVol = avgVol / 20
  // 条件: 前一天在MA20下方, 今天站上MA20, 且放量
  var prevBelowMA = prevClose < ma20
  var todayAboveMA = todayClose > ma20
  var volRatio = avgVol > 0 ? todayVol / avgVol : 0
  var volBreak = volRatio >= 1.3  // 量比>=1.3
  if (prevBelowMA && todayAboveMA && volBreak) {
    var score = 0
    // 突破幅度加分
    var breakPct = (todayClose / ma20 - 1) * 100
    if (breakPct >= 1 && breakPct <= 3) score += 4  // 温和突破最优
    else if (breakPct > 3 && breakPct <= 5) score += 3
    else if (breakPct > 0 && breakPct < 1) score += 2
    else score += 1
    // 量比加分
    if (volRatio >= 1.5 && volRatio <= 3) score += 3  // 温和放量最优
    else if (volRatio >= 1.3 && volRatio < 1.5) score += 2
    else if (volRatio > 3) score += 1
    return { detected: true, score: score, breakPct: breakPct, volRatio: volRatio }
  }
  return { detected: false, score: 0 }
}

// 2. 底部V型反转: 近5日从底部快速回升
function calcVReversal(klines, dateIdx) {
  if (dateIdx < 10) return { detected: false, score: 0 }
  // 寻找近5-10日内的最低点
  var minIdx = dateIdx - 5
  var minClose = klines[minIdx].close
  for (var i = dateIdx - 5; i <= dateIdx; i++) {
    if (klines[i].close < minClose) {
      minClose = klines[i].close
      minIdx = i
    }
  }
  var todayClose = klines[dateIdx].close
  var recoveryPct = (todayClose / minClose - 1) * 100
  // 最低点不能是今天
  if (minIdx >= dateIdx) return { detected: false, score: 0 }
  // 反弹幅度3-10%为V型反转
  if (recoveryPct >= 3 && recoveryPct <= 10) {
    var score = 0
    // 反弹速度加分
    var reboundDays = dateIdx - minIdx
    if (reboundDays <= 2) score += 5  // 1-2天快速反弹
    else if (reboundDays <= 3) score += 3
    else score += 1
    // 反弹前的跌幅(跌得越深, 反转越有价值)
    var preDropPct = 0
    if (minIdx >= 5) {
      var preClose = klines[minIdx - 5].close
      preDropPct = (minClose / preClose - 1) * 100
    }
    if (preDropPct <= -5) score += 3  // 前期跌幅>5%
    else if (preDropPct <= -3) score += 2
    // 今日放量确认
    var todayVol = klines[dateIdx].volume
    var avgVol = 0, count = 0
    for (var i = dateIdx - 5; i < dateIdx; i++) {
      if (klines[i].volume > 0) { avgVol += klines[i].volume; count++ }
    }
    if (count > 0) avgVol = avgVol / count
    var volRatio = avgVol > 0 ? todayVol / avgVol : 0
    if (volRatio >= 1.5) score += 2
    return { detected: true, score: score, recoveryPct: recoveryPct, reboundDays: reboundDays }
  }
  return { detected: false, score: 0 }
}

// 3. 缩量回踩MA10后企稳: 回踩到10日均线附近后放量回升
function calcPullbackMA10(klines, dateIdx) {
  if (dateIdx < 15) return { detected: false, score: 0 }
  var closes = []
  for (var i = dateIdx - 15; i <= dateIdx; i++) closes.push(klines[i].close)
  var ma10 = 0
  for (var i = closes.length - 11; i < closes.length - 1; i++) ma10 += closes[i]
  ma10 = ma10 / 10
  var todayClose = closes[closes.length - 1]
  var prevClose = closes[closes.length - 2]
  // 今天站上MA10, 前一天曾跌破MA10
  var todayAboveMA = todayClose > ma10 * 1.005  // 站上0.5%以上
  var prevBelowMA = prevClose < ma10 * 1.01     // 前一天在MA10附近或下方
  if (todayAboveMA && prevBelowMA) {
    var score = 0
    // 近5日是否缩量(回踩期间缩量是好事)
    var vols = []
    for (var i = dateIdx - 5; i <= dateIdx; i++) vols.push(klines[i].volume)
    var avgVol3 = (vols[0] + vols[1] + vols[2]) / 3  // 前3天
    var avgVol2 = (vols[3] + vols[4]) / 2             // 近2天
    if (avgVol3 > 0 && avgVol2 / avgVol3 >= 1.2) score += 3  // 近2天放量(企稳信号)
    // 站上MA10幅度
    var abovePct = (todayClose / ma10 - 1) * 100
    if (abovePct >= 1 && abovePct <= 3) score += 3
    else if (abovePct > 0.5 && abovePct < 1) score += 2
    return { detected: true, score: score, abovePct: abovePct }
  }
  return { detected: false, score: 0 }
}

// V35策略: V34e + 新形态因子
function simulatePickV35(dayQuotes, klineMap, dateIdxMap, topN, params, marketEnv, minScore) {
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

    // V35: 硬过滤(和V34e回测一致)
    if (techData.adx < adxThreshold || techData.plusDI <= techData.minusDI) continue
    if (techData.vpCoord && techData.vpCoord.trend === "bearish_divergence") continue
    if (techData.bollPosition > bollThreshold) continue
    // 连涨限制
    if (params.filterConsecUp || params.dynamicConsec) {
      var consecUp = calcConsecutiveUpDays(klines, dateIdx)
      if (consecUp > maxConsecUp) continue
    }

    // 形态加分(V34e原有)
    var morphBonus = 0
    if (params.morphBonus) {
      if (techData.consolidationBreakout && techData.consolidationBreakout.score >= 70) morphBonus += 5
      if (techData.trendAccel && techData.trendAccel.accelerating) morphBonus += 3
      if (techData.candlePatterns && techData.candlePatterns.score >= 15) morphBonus += 3
    }

    // V35新形态因子
    var newMorphBonus = 0
    if (params.breakoutMA20) {
      var breakout = calcBreakoutMA20(klines, dateIdx)
      if (breakout.detected) newMorphBonus += breakout.score
    }
    if (params.vReversal) {
      var vRev = calcVReversal(klines, dateIdx)
      if (vRev.detected) newMorphBonus += vRev.score
    }
    if (params.pullbackMA10) {
      var pullback = calcPullbackMA10(klines, dateIdx)
      if (pullback.detected) newMorphBonus += pullback.score
    }

    var finalScore = v31Score * (params.v31Weight || 0.75) + v10Score * (params.v10Weight || 0.25) + morphBonus + newMorphBonus

    // 软量比确认(降权而非排除)
    if (params.softVolConfirm && volumeRatio < 1.2) finalScore *= (params.volPenalty || 0.9)
    scored.push({ code: stock.code, price: stock.price, changePct: stock.changePct, score: Math.round(finalScore) })
  }
  scored.sort(function(a, b) { return b.score - a.score })
  return scored.slice(0, topN)
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

// V35变体: V34e基础 + 新形态因子探索
var VARIANTS = {
  // V34e基准(用软过滤重现)
  'V34e_soft': {
    v31Weight: 0.75, v10Weight: 0.25,
    adaptiveMarket: true, morphBonus: true,
    softVolConfirm: true, volPenalty: 0.9,
    dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6,
        _minScore: 60,
  },
  // V35a: V34e + 放量突破MA20
  'V35a_breakout': {
    v31Weight: 0.75, v10Weight: 0.25,
    adaptiveMarket: true, morphBonus: true,
    softVolConfirm: true, volPenalty: 0.9,
    dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6,
        breakoutMA20: true,
    _minScore: 60,
  },
  // V35b: V34e + V型反转
  'V35b_vreversal': {
    v31Weight: 0.75, v10Weight: 0.25,
    adaptiveMarket: true, morphBonus: true,
    softVolConfirm: true, volPenalty: 0.9,
    dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6,
        vReversal: true,
    _minScore: 60,
  },
  // V35c: V34e + 缩量回踩MA10企稳
  'V35c_pullback': {
    v31Weight: 0.75, v10Weight: 0.25,
    adaptiveMarket: true, morphBonus: true,
    softVolConfirm: true, volPenalty: 0.9,
    dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6,
        pullbackMA10: true,
    _minScore: 60,
  },
  // V35d: V34e + 全部新形态
  'V35d_all_morph': {
    v31Weight: 0.75, v10Weight: 0.25,
    adaptiveMarket: true, morphBonus: true,
    softVolConfirm: true, volPenalty: 0.9,
    dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6,
        breakoutMA20: true, vReversal: true, pullbackMA10: true,
    _minScore: 60,
  },
  // V35e: V34e + 全部新形态 + minScore=65
  'V35e_min65': {
    v31Weight: 0.75, v10Weight: 0.25,
    adaptiveMarket: true, morphBonus: true,
    softVolConfirm: true, volPenalty: 0.9,
    dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6,
        breakoutMA20: true, vReversal: true, pullbackMA10: true,
    _minScore: 65,
  },
  // V35f: V34e + 全部新形态 + V31权重0.8
  'V35f_v31_80': {
    v31Weight: 0.8, v10Weight: 0.2,
    adaptiveMarket: true, morphBonus: true,
    softVolConfirm: true, volPenalty: 0.9,
    dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6,
        breakoutMA20: true, vReversal: true, pullbackMA10: true,
    _minScore: 60,
  },
  // V35g: V34e + 全部新形态 + minScore=55(宽松)
  'V35g_min55': {
    v31Weight: 0.75, v10Weight: 0.25,
    adaptiveMarket: true, morphBonus: true,
    softVolConfirm: true, volPenalty: 0.9,
    dynamicConsec: true, consecBear: 3, consecNeutral: 5, consecBull: 6,
        breakoutMA20: true, vReversal: true, pullbackMA10: true,
    _minScore: 55,
  },
}

async function runBacktest() {
  console.log('='.repeat(60))
  console.log('V35 Strategy: V34e + New Morphology Factors')
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

    // Variant picks
    for (var v = 0; v < variantNames.length; v++) {
      var vName = variantNames[v]
      var params = VARIANTS[vName]
      var minScore = params._minScore || CONFIG.minScore
      var picks = simulatePickV35(dayQuotes, klineMap, dateIdxMap, CONFIG.topN, params, marketEnv, minScore)
      for (var p = 0; p < picks.length; p++) {
        var pick = picks[p]
        var pickIdx = dateIdxMap[pick.code]
        variantPicks[vName].push({ code: pick.code, price: pick.price, dateIdx: pickIdx, returns: calcHoldingReturn(pick.price, klineMap[pick.code], pickIdx, CONFIG.holdDays) })
      }
    }

    if ((si + 1) % 30 === 0) console.log('  processed ' + (si + 1) + '/' + sampleDates.length + ' dates')
  }

  // Calculate stats
  console.log('\n' + '='.repeat(80))
  console.log('V35 Strategy Backtest - V34e + New Morphology Factors')
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
  output.push('V35 Strategy Backtest - V34e + New Morphology Factors')
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

  var header = 'Variant'.padEnd(22) + 'n    3dWR  3dAR  5dWR  5dAR  7dWR  7dAR 10dWR 10dAR  BeatV10'
  summary.push(header)
  summary.push('-'.repeat(100))

  var winners = []

  for (var v = 0; v < variantNames.length; v++) {
    var vName = variantNames[v]
    var picks = variantPicks[vName]
    var stats = calcStats(picks, CONFIG.holdDays)
    var n = picks.length

    var beatCount = 0
    var totalMetrics = 0
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
    var beatStr = beatCount + '/' + totalMetrics
    line += '  ' + beatStr
    summary.push(line)

    if (beatCount >= totalMetrics - 1) {
      winners.push({ name: vName, n: n, stats: stats, beatCount: beatCount, totalMetrics: totalMetrics })
    }
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
        console.log('  ' + d + 'dAR: ' + v10S.avgReturn + '% -> ' + s.avgReturn + '% (' + (s.avgReturn > v10S.avgReturn ? '+' : '') + (s.avgReturn - v10S.avgReturn).toFixed(2) + '%)')
      }
    }
  }

  fs.writeFileSync(path.join(CONFIG.outputDir, 'backtest_v35.txt'), output.join('\n'), 'utf8')
  console.log('\nResults saved to backtest/results/backtest_v35.txt')
}

runBacktest().catch(function(e) { console.error('Error:', e); process.exit(1) })
