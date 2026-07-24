// run_v33.js - V33策略回测: 市场环境自适应+动态阈值+3天持仓+连涨限制
var fs = require("fs")
var path = require("path")

var CONFIG = {
  holdDays: [3, 5, 7, 10],
  topN: 20,
  minScore: 55,
  cacheDir: path.join(__dirname, "cache"),
  outputDir: path.join(__dirname, "results"),
}

if (!fs.existsSync(CONFIG.outputDir)) fs.mkdirSync(CONFIG.outputDir, { recursive: true })

var { calcTechFromKlines, calcVolumePriceCoord, calcTrendAcceleration, detectConsolidationBreakout, calcCandlePatterns, calcMA, calcADX, calcOBV } = require("./indicators")
var { getLimitPct, calcTechScoreV10, calcTechScoreV31 } = require("./scoring")

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

// V33新: 计算连涨天数
function calcConsecutiveUpDays(klines, dateIdx) {
  if (dateIdx < 1) return 0
  var count = 0
  for (var i = dateIdx; i >= 1; i--) {
    if (klines[i].close > klines[i - 1].close) count++
    else break
  }
  return count
}

// V33新: 计算市场环境 (用全体样本的20日平均涨跌幅)
function calcMarketEnv(allDayQuotes, tradeDates, currentIdx) {
  var recent20Dates = tradeDates.slice(Math.max(0, currentIdx - 20), currentIdx)
  if (recent20Dates.length < 5) return { trend: "neutral", volatility: 0 }
  var avgChanges = []
  for (var i = 0; i < recent20Dates.length; i++) {
    var dq = allDayQuotes[recent20Dates[i]]
    if (!dq || dq.length === 0) continue
    var avgChg = 0
    for (var j = 0; j < dq.length; j++) avgChg += (dq[j].changePct || 0)
    avgChg = avgChg / dq.length
    avgChanges.push(avgChg)
  }
  if (avgChanges.length === 0) return { trend: "neutral", volatility: 0 }
  var sum = 0
  for (var i = 0; i < avgChanges.length; i++) sum += avgChanges[i]
  var mean = sum / avgChanges.length
  var variance = 0
  for (var i = 0; i < avgChanges.length; i++) variance += (avgChanges[i] - mean) * (avgChanges[i] - mean)
  var volatility = Math.sqrt(variance / avgChanges.length)
  var trend = "neutral"
  if (mean > 0.5) trend = "bull"
  else if (mean < -0.3) trend = "bear"
  return { trend: trend, volatility: volatility, avgChange: mean }
}

// V32b基准 (用于对比)
function simulatePickV32b(dayQuotes, klineMap, dateIdxMap, topN) {
  var scored = []
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
    if (v10Score < CONFIG.minScore) continue
    var v31Score = calcTechScoreV31(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)
    if (techData.adx < 20 || techData.plusDI <= techData.minusDI) continue
    if (techData.vpCoord && techData.vpCoord.trend === "bearish_divergence") continue
    if (techData.bollPosition > 0.85) continue
    var finalScore = v31Score * 0.75 + v10Score * 0.25
    scored.push({ code: stock.code, price: stock.price, changePct: stock.changePct, score: Math.round(finalScore) })
  }
  scored.sort(function(a, b) { return b.score - a.score })
  return scored.slice(0, topN)
}

// V33策略: 市场环境自适应 + 动态过滤
function simulatePickV33(dayQuotes, klineMap, dateIdxMap, topN, params, marketEnv) {
  var scored = []
  // 动态阈值: 根据市场环境调整
  var adxThreshold = params.adxThreshold || 20
  var bollThreshold = params.bollThreshold || 0.85
  var maxConsecUp = params.maxConsecUp || 5

  if (params.adaptiveMarket && marketEnv) {
    if (marketEnv.trend === "bear") {
      adxThreshold = Math.max(20, adxThreshold + 5) // 弱势市场更严格
      bollThreshold = Math.max(0.75, bollThreshold - 0.1)
    } else if (marketEnv.trend === "bull") {
      bollThreshold = Math.min(0.9, bollThreshold + 0.05) // 强势市场放宽
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
    if (v10Score < CONFIG.minScore) continue
    var v31Score = calcTechScoreV31(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)

    // 基础过滤
    if (techData.adx < adxThreshold || techData.plusDI <= techData.minusDI) continue
    if (techData.vpCoord && techData.vpCoord.trend === "bearish_divergence") continue
    if (techData.bollPosition > bollThreshold) continue

    // V33新增过滤: 连涨天数限制
    if (params.filterConsecUp) {
      var consecUp = calcConsecutiveUpDays(klines, dateIdx)
      if (consecUp > maxConsecUp) continue
    }

    // V33新增过滤: 量比确认
    if (params.filterVolConfirm && volumeRatio < 1.2) continue

    // V33新增: 形态加分
    var bonus = 0
    if (params.morphBonus) {
      if (techData.consolidationBreakout && techData.consolidationBreakout.score >= 70) bonus += 5
      if (techData.trendAccel && techData.trendAccel.accelerating) bonus += 3
      if (techData.candlePatterns && techData.candlePatterns.score >= 15) bonus += 3
    }

    var finalScore = v31Score * (params.v31Weight || 0.75) + v10Score * (params.v10Weight || 0.25) + bonus
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
    if (returns.length === 0) { stats["hold" + days] = { total: 0 }; continue }
    var wins = returns.filter(function(r) { return r > 0 }).length
    var sum = returns.reduce(function(a, b) { return a + b }, 0)
    stats["hold" + days] = {
      total: returns.length,
      winRate: Math.round(wins / returns.length * 10000) / 100,
      avgReturn: Math.round(sum / returns.length * 100) / 100
    }
  }
  return stats
}

var VARIANTS = {
  "V32b_base": { v31Weight: 0.75, v10Weight: 0.25 },
  "V33a_consec5": { v31Weight: 0.75, v10Weight: 0.25, filterConsecUp: true, maxConsecUp: 5 },
  "V33b_consec4": { v31Weight: 0.75, v10Weight: 0.25, filterConsecUp: true, maxConsecUp: 4 },
  "V33c_volConfirm": { v31Weight: 0.75, v10Weight: 0.25, filterVolConfirm: true },
  "V33d_morphBonus": { v31Weight: 0.75, v10Weight: 0.25, morphBonus: true },
  "V33e_adaptive": { v31Weight: 0.75, v10Weight: 0.25, adaptiveMarket: true },
  "V33f_all": { v31Weight: 0.75, v10Weight: 0.25, filterConsecUp: true, maxConsecUp: 5, filterVolConfirm: true, morphBonus: true, adaptiveMarket: true },
  "V33g_all_consec4": { v31Weight: 0.75, v10Weight: 0.25, filterConsecUp: true, maxConsecUp: 4, filterVolConfirm: true, morphBonus: true, adaptiveMarket: true },
  "V33h_strict": { v31Weight: 0.75, v10Weight: 0.25, filterConsecUp: true, maxConsecUp: 3, filterVolConfirm: true, morphBonus: true, adaptiveMarket: true, adxThreshold: 22 },
  "V33i_vol2": { v31Weight: 0.75, v10Weight: 0.25, filterVolConfirm: true, filterConsecUp: true, maxConsecUp: 5, morphBonus: true, adaptiveMarket: true },
}

async function runBacktest() {
  console.log("=".repeat(60))
  console.log("V33 Strategy: Market-adaptive + Dynamic filters")
  console.log("=".repeat(60))

  var cacheDir = CONFIG.cacheDir
  var cacheFiles = fs.readdirSync(cacheDir).filter(function(f) { return f.startsWith("tx_kline_") && f.endsWith(".json") })

  var klineMap = {}
  var codes = []
  for (var i = 0; i < cacheFiles.length; i++) {
    try {
      var data = JSON.parse(fs.readFileSync(path.join(cacheDir, cacheFiles[i]), "utf8"))
      if (data.length >= 60) {
        var code = cacheFiles[i].replace("tx_kline_", "").replace(".json", "")
        klineMap[code] = data
        codes.push(code)
      }
    } catch(e) {}
  }
  console.log("Valid K-lines: " + codes.length)

  var dateSet = {}
  for (var ci = 0; ci < codes.length; ci++) {
    var klines = klineMap[codes[ci]]
    for (var ki = 0; ki < klines.length; ki++) dateSet[klines[ki].date] = true
  }
  var tradeDates = Object.keys(dateSet).sort()

  var startIdx = 0
  for (var si = 0; si < tradeDates.length; si++) { if (tradeDates[si] >= "2024-07-01") { startIdx = si; break } }

  console.log("Precomputing day quotes...")
  var allDayQuotes = {}
  var allDateIdxMaps = {}
  var processed = 0

  for (var di = startIdx; di < tradeDates.length - 10; di += 3) {
    var dateStr = tradeDates[di]
    processed++
    if (processed % 50 === 0) console.log("  prep " + dateStr + " (" + processed + ")")

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
        circCap: 0, roe: 0, grossMargin: 0, debtRatio: 0, industry: "",
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
  console.log("Precomputed " + Object.keys(allDayQuotes).length + " sampling dates")

  var v10Picks = []
  var v32bPicks = []
  var variantPicks = {}
  var variantNames = Object.keys(VARIANTS)
  for (var v = 0; v < variantNames.length; v++) variantPicks[variantNames[v]] = []

  var sampleDates = Object.keys(allDayQuotes).sort()
  console.log("\nRunning backtest on " + sampleDates.length + " dates...")

  for (var si = 0; si < sampleDates.length; si++) {
    var dateStr = sampleDates[si]
    var dayQuotes = allDayQuotes[dateStr]
    var dateIdxMap = allDateIdxMaps[dateStr]

    // 市场环境
    var tradeDateIdx = tradeDates.indexOf(dateStr)
    var marketEnv = calcMarketEnv(allDayQuotes, tradeDates, tradeDateIdx)

    // V10
    var picks10 = []
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
      var score = calcTechScoreV10(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)
      if (score >= CONFIG.minScore) picks10.push({ code: stock.code, price: stock.price })
    }
    picks10.sort(function(a, b) { return b.score - a.score })
    picks10 = picks10.slice(0, CONFIG.topN)
    for (var p = 0; p < picks10.length; p++) {
      var returns = calcHoldingReturn(picks10[p].price, klineMap[picks10[p].code], dateIdxMap[picks10[p].code], CONFIG.holdDays)
      if (returns) v10Picks.push({ date: dateStr, code: picks10[p].code, price: picks10[p].price, returns: returns })
    }

    // V32b
    var picks32b = simulatePickV32b(dayQuotes, klineMap, dateIdxMap, CONFIG.topN)
    for (var p = 0; p < picks32b.length; p++) {
      var returns = calcHoldingReturn(picks32b[p].price, klineMap[picks32b[p].code], dateIdxMap[picks32b[p].code], CONFIG.holdDays)
      if (returns) v32bPicks.push({ date: dateStr, code: picks32b[p].code, price: picks32b[p].price, returns: returns })
    }

    // V33 variants
    for (var v = 0; v < variantNames.length; v++) {
      var vName = variantNames[v]
      var picks = simulatePickV33(dayQuotes, klineMap, dateIdxMap, CONFIG.topN, VARIANTS[vName], marketEnv)
      for (var p = 0; p < picks.length; p++) {
        var returns = calcHoldingReturn(picks[p].price, klineMap[picks[p].code], dateIdxMap[picks[p].code], CONFIG.holdDays)
        if (returns) variantPicks[vName].push({ date: dateStr, code: picks[p].code, price: picks[p].price, returns: returns })
      }
    }
  }

  // 输出结果
  var report = []
  report.push("=".repeat(80))
  report.push("V33 Strategy Backtest - Market-adaptive + Dynamic filters")
  report.push("=".repeat(80))

  var v10Stats = calcStats(v10Picks, CONFIG.holdDays)
  report.push("\n--- V10 BASELINE (n=" + v10Picks.length + ") ---")
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var d = CONFIG.holdDays[h]
    var s = v10Stats["hold" + d]
    report.push("  Hold " + d + "d: winRate=" + s.winRate + "% avgReturn=" + s.avgReturn + "%")
  }

  var v32bStats = calcStats(v32bPicks, CONFIG.holdDays)
  report.push("\n--- V32b BASELINE (n=" + v32bPicks.length + ") ---")
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var d = CONFIG.holdDays[h]
    var s = v32bStats["hold" + d]
    var v10s = v10Stats["hold" + d]
    report.push("  Hold " + d + "d: winRate=" + s.winRate + "%(" + (s.winRate - v10s.winRate >= 0 ? "+" : "") + (s.winRate - v10s.winRate).toFixed(2) + ") avgReturn=" + s.avgReturn + "%(" + (s.avgReturn - v10s.avgReturn >= 0 ? "+" : "") + (s.avgReturn - v10s.avgReturn).toFixed(2) + ")")
  }

  report.push("\n" + "=".repeat(80))
  report.push("SUMMARY")
  report.push("=".repeat(80))
  report.push("V10 baseline: 3dWR=" + v10Stats.hold3.winRate + "% 3dAR=" + v10Stats.hold3.avgReturn + "% 5dWR=" + v10Stats.hold5.winRate + "% 5dAR=" + v10Stats.hold5.avgReturn + "% 7dWR=" + v10Stats.hold7.winRate + "% 7dAR=" + v10Stats.hold7.avgReturn + "% 10dWR=" + v10Stats.hold10.winRate + "% 10dAR=" + v10Stats.hold10.avgReturn + "%")
  report.push("")
  report.push("Variant               n      3dWR   3dAR   5dWR   5dAR   7dWR   7dAR   10dWR  10dAR  BeatsV10")
  report.push("-".repeat(100))

  var winners = []
  for (var v = 0; v < variantNames.length; v++) {
    var vName = variantNames[v]
    var picks = variantPicks[vName]
    var stats = calcStats(picks, CONFIG.holdDays)
    var line = vName.padEnd(22) + String(picks.length).padStart(6)
    var beatsAll = true
    for (var h = 0; h < CONFIG.holdDays.length; h++) {
      var d = CONFIG.holdDays[h]
      var s = stats["hold" + d]
      var v10s = v10Stats["hold" + d]
      var wrDiff = (s.winRate - v10s.winRate).toFixed(2)
      var arDiff = (s.avgReturn - v10s.avgReturn).toFixed(2)
      line += String(s.winRate).padStart(7) + String(s.avgReturn).padStart(7)
      if (s.winRate <= v10s.winRate || s.avgReturn <= v10s.avgReturn) beatsAll = false
    }
    var beatsCount = 0
    for (var h = 0; h < CONFIG.holdDays.length; h++) {
      var d = CONFIG.holdDays[h]
      var s = stats["hold" + d]
      var v10s = v10Stats["hold" + d]
      if (s.winRate > v10s.winRate) beatsCount++
      if (s.avgReturn > v10s.avgReturn) beatsCount++
    }
    line += "  " + beatsCount + "/8"
    if (beatsAll) { line += " ALL8!"; winners.push(vName) }
    report.push(line)
  }

  report.push("\n" + "=".repeat(80))
  if (winners.length > 0) {
    report.push("WINNERS: All 8 metrics beat V10!")
    report.push("=".repeat(80))
    for (var w = 0; w < winners.length; w++) {
      var vName = winners[w]
      var stats = calcStats(variantPicks[vName], CONFIG.holdDays)
      report.push("\n" + vName + " (n=" + variantPicks[vName].length + "):")
      for (var h = 0; h < CONFIG.holdDays.length; h++) {
        var d = CONFIG.holdDays[h]
        var s = stats["hold" + d]
        var v10s = v10Stats["hold" + d]
        report.push("  " + d + "dWR: " + v10s.winRate + "% -> " + s.winRate + "% (" + (s.winRate - v10s.winRate >= 0 ? "+" : "") + (s.winRate - v10s.winRate).toFixed(2) + "%)")
        report.push("  " + d + "dAR: " + v10s.avgReturn + "% -> " + s.avgReturn + "% (" + (s.avgReturn - v10s.avgReturn >= 0 ? "+" : "") + (s.avgReturn - v10s.avgReturn).toFixed(2) + "%)")
      }
    }
  } else {
    report.push("No variant beat V10 on all 8 metrics")
    report.push("=".repeat(80))
  }

  var reportText = report.join("\n")
  console.log("\n" + reportText)
  fs.writeFileSync(path.join(CONFIG.outputDir, "backtest_v33.txt"), reportText, "utf8")
  console.log("\nReport saved to backtest/results/backtest_v33.txt")
}

runBacktest().catch(function(e) { console.error(e); process.exit(1) })
