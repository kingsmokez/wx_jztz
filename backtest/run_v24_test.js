var fs = require("fs")
var path = require("path")

var CONFIG = {
  holdDays: [1, 3, 5, 10],
  topN: 20,
  minScore: 55,
  cacheDir: path.join(__dirname, "cache"),
  outputDir: path.join(__dirname, "results"),
}

if (!fs.existsSync(CONFIG.outputDir)) fs.mkdirSync(CONFIG.outputDir, { recursive: true })

var { calcTechFromKlines } = require("./indicators")
var { getLimitPct, calcTechScoreV10, calcTechScoreV22, calcTechScoreV23, calcTechScoreV24, calcTechScoreV25, calcTechScoreV26 } = require("./scoring")

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

var scoreFuncs = {
  v10: calcTechScoreV10,
  v22: calcTechScoreV22,
  v23: calcTechScoreV23,
  v24: calcTechScoreV24,
  v25: calcTechScoreV25,
  v26: calcTechScoreV26,
}

function simulatePick(dayQuotes, klineMap, dateIdxMap, scoreFuncName, topN) {
  var scored = []
  var scoreFunc = scoreFuncs[scoreFuncName]
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
    var score = scoreFunc(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)
    if (score >= CONFIG.minScore) {
      scored.push({ code: stock.code, price: stock.price, changePct: stock.changePct, score: score })
    }
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

async function runBacktest() {
  console.log("=".repeat(60))
  console.log("V24/V25/V26 Backtest (vs V10 baseline)")
  console.log("=".repeat(60))

  var cacheDir = CONFIG.cacheDir
  var cacheFiles = fs.readdirSync(cacheDir).filter(function(f) { return f.startsWith("tx_kline_") && f.endsWith(".json") })
  console.log("Cached K-line files: " + cacheFiles.length)

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
  console.log("Trade dates: " + tradeDates.length)

  console.log("\nBacktesting...")
  var allPicks = { v10: [], v22: [], v23: [], v24: [], v25: [], v26: [] }
  var processed = 0

  var startIdx = 0
  for (var si = 0; si < tradeDates.length; si++) { if (tradeDates[si] >= "2024-07-01") { startIdx = si; break } }

  for (var di = startIdx; di < tradeDates.length - 10; di += 3) {
    var dateStr = tradeDates[di]
    processed++
    if (processed % 30 === 0) console.log("  " + dateStr + " (" + processed + ")")

    var dayQuotes = []
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

    var dateIdxMap = {}
    for (var i = 0; i < dayQuotes.length; i++) dateIdxMap[dayQuotes[i].code] = dayQuotes[i]._dateIdx

    var strategyNames = ["v10", "v22", "v23", "v24", "v25", "v26"]
    for (var s = 0; s < strategyNames.length; s++) {
      var name = strategyNames[s]
      var picks = simulatePick(dayQuotes, klineMap, dateIdxMap, name, CONFIG.topN)
      for (var p = 0; p < picks.length; p++) {
        var pick = picks[p]
        var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)
        if (returns) allPicks[name].push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })
      }
    }
  }

  // Stats
  var lines = []
  lines.push("=".repeat(60))
  lines.push("V24/V25/V26 Backtest Report")
  lines.push("=".repeat(60))

  var strategyNames = ["v10", "v22", "v23", "v24", "v25", "v26"]
  var strategyLabels = {
    v10: "V10(baseline)",
    v22: "V22(V10+momentum bonus+risk)",
    v23: "V23(V16+volRatio boost)",
    v24: "V24(V10+momentum filter)",
    v25: "V25(V10+volRatio 0-18)",
    v26: "V26(V25+momentum filter)",
  }

  var statsMap = {}
  for (var s = 0; s < strategyNames.length; s++) {
    var name = strategyNames[s]
    var stats = calcStats(allPicks[name], CONFIG.holdDays)
    statsMap[name] = stats
    lines.push("\n--- " + strategyLabels[name] + " (n=" + allPicks[name].length + ") ---")
    for (var h = 0; h < CONFIG.holdDays.length; h++) {
      var d = CONFIG.holdDays[h]
      var stat = stats["hold" + d]
      if (!stat || stat.total === 0) continue
      lines.push("  Hold " + d + "d: winRate=" + stat.winRate + "% avgReturn=" + stat.avgReturn + "%")
    }
  }

  // Comparison
  lines.push("\n" + "=".repeat(60))
  lines.push("COMPARISON vs V10")
  lines.push("=".repeat(60))

  for (var s = 1; s < strategyNames.length; s++) {
    var name = strategyNames[s]
    var sV10 = statsMap.v10, sOpt = statsMap[name]
    lines.push("\n" + strategyLabels[name] + " vs V10:")
    for (var h = 0; h < CONFIG.holdDays.length; h++) {
      var d = CONFIG.holdDays[h]
      var orig = sV10["hold" + d], opt = sOpt["hold" + d]
      if (!orig || !opt || orig.total === 0 || opt.total === 0) continue
      var dw = (opt.winRate - orig.winRate).toFixed(2)
      var dr = (opt.avgReturn - orig.avgReturn).toFixed(2)
      lines.push("  Hold " + d + "d: winRate " + orig.winRate + "%->" + opt.winRate + "%(" + (dw >= 0 ? "+" : "") + dw + "%) avgReturn " + orig.avgReturn + "%->" + opt.avgReturn + "%(" + (dr >= 0 ? "+" : "") + dr + "%)")
    }
  }

  var report = lines.join("\n")
  fs.writeFileSync(path.join(CONFIG.outputDir, "backtest_v24_v26.txt"), report, "utf8")
  console.log("\n" + report)
}

runBacktest().catch(function(e) { console.error("Backtest failed:", e); process.exit(1) })
