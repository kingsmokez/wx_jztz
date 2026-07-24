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
var { getLimitPct, calcTechScoreV10 } = require("./scoring")

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

// V27: V10 score + conditional filter (not in scoring, but in selection)
function simulatePickV27(dayQuotes, klineMap, dateIdxMap, topN) {
  var scored = []
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
    if (score < CONFIG.minScore) continue

    var chg = stock.changePct || 0
    var isMild = chg >= 1 && chg <= 5 && volumeRatio >= 1 && volumeRatio <= 3
    var isHot = chg > 5 || volumeRatio > 3
    var isWeak = chg < 1 && volumeRatio < 1.5

    if (isWeak) continue
    if (isHot && (techData.rsi > 65 || techData.maSignal === "bear")) continue
    scored.push({ code: stock.code, price: stock.price, changePct: stock.changePct, score: score })
  }
  scored.sort(function(a, b) { return b.score - a.score })
  return scored.slice(0, topN)
}

// V28: V10 score + weighted ranking with mild factor
function simulatePickV28(dayQuotes, klineMap, dateIdxMap, topN) {
  var scored = []
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

    var chg = stock.changePct || 0
    var rsi = techData.rsi || 50

    // Mild factor score (0-100)
    var mildScore = 0
    // chg mildness
    if (chg >= 1 && chg <= 3) mildScore += 40
    else if (chg >= 0.5 && chg < 1) mildScore += 25
    else if (chg > 3 && chg <= 5) mildScore += 30
    else if (chg > 5 && chg <= 7) mildScore += 15
    else if (chg > 7) mildScore += 5
    else mildScore += 10

    // volumeRatio mildness
    if (volumeRatio >= 1 && volumeRatio <= 2) mildScore += 40
    else if (volumeRatio >= 0.7 && volumeRatio < 1) mildScore += 25
    else if (volumeRatio > 2 && volumeRatio <= 3) mildScore += 30
    else if (volumeRatio > 3 && volumeRatio <= 5) mildScore += 15
    else if (volumeRatio > 5) mildScore += 5
    else mildScore += 10

    // RSI mildness
    if (rsi >= 40 && rsi <= 60) mildScore += 20
    else if (rsi >= 30 && rsi < 40) mildScore += 15
    else if (rsi > 60 && rsi <= 70) mildScore += 10
    else if (rsi > 70) mildScore += 3
    else mildScore += 8

    var finalScore = v10Score * 0.5 + mildScore * 0.5
    scored.push({ code: stock.code, price: stock.price, changePct: stock.changePct, score: Math.round(finalScore), v10Score: v10Score })
  }
  scored.sort(function(a, b) { return b.score - a.score })
  return scored.slice(0, topN)
}

// V10 baseline
function simulatePickV10(dayQuotes, klineMap, dateIdxMap, topN) {
  var scored = []
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
  console.log("V27/V28 Selection Strategy Backtest")
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

  console.log("\nBacktesting...")
  var allPicksV10 = [], allPicksV27 = [], allPicksV28 = []
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

    var strategies = [
      { name: "v10", fn: simulatePickV10, picks: allPicksV10 },
      { name: "v27", fn: simulatePickV27, picks: allPicksV27 },
      { name: "v28", fn: simulatePickV28, picks: allPicksV28 },
    ]

    for (var s = 0; s < strategies.length; s++) {
      var st = strategies[s]
      var picks = st.fn(dayQuotes, klineMap, dateIdxMap, CONFIG.topN)
      for (var p = 0; p < picks.length; p++) {
        var pick = picks[p]
        var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)
        if (returns) st.picks.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })
      }
    }
  }

  var lines = []
  lines.push("=".repeat(60))
  lines.push("V27/V28 Backtest Report")
  lines.push("=".repeat(60))

  var sV10 = calcStats(allPicksV10, CONFIG.holdDays)
  var sV27 = calcStats(allPicksV27, CONFIG.holdDays)
  var sV28 = calcStats(allPicksV28, CONFIG.holdDays)

  var results = [
    { name: "V10(baseline)", stats: sV10, n: allPicksV10.length },
    { name: "V27(V10+conditional filter)", stats: sV27, n: allPicksV27.length },
    { name: "V28(V10+mild weighted ranking)", stats: sV28, n: allPicksV28.length },
  ]

  for (var r = 0; r < results.length; r++) {
    var res = results[r]
    lines.push("\n--- " + res.name + " (n=" + res.n + ") ---")
    for (var h = 0; h < CONFIG.holdDays.length; h++) {
      var d = CONFIG.holdDays[h]
      var stat = res.stats["hold" + d]
      if (!stat || stat.total === 0) continue
      lines.push("  Hold " + d + "d: winRate=" + stat.winRate + "% avgReturn=" + stat.avgReturn + "%")
    }
  }

  // Comparison
  lines.push("\n" + "=".repeat(60))
  lines.push("COMPARISON vs V10")
  lines.push("=".repeat(60))

  var comparisons = [
    { name: "V27", stats: sV27 },
    { name: "V28", stats: sV28 },
  ]

  for (var c = 0; c < comparisons.length; c++) {
    var cmp = comparisons[c]
    lines.push("\n" + cmp.name + " vs V10:")
    for (var h = 0; h < CONFIG.holdDays.length; h++) {
      var d = CONFIG.holdDays[h]
      var orig = sV10["hold" + d], opt = cmp.stats["hold" + d]
      if (!orig || !opt || orig.total === 0 || opt.total === 0) continue
      var dw = (opt.winRate - orig.winRate).toFixed(2)
      var dr = (opt.avgReturn - orig.avgReturn).toFixed(2)
      lines.push("  Hold " + d + "d: winRate " + orig.winRate + "%->" + opt.winRate + "%(" + (dw >= 0 ? "+" : "") + dw + "%) avgReturn " + orig.avgReturn + "%->" + opt.avgReturn + "%(" + (dr >= 0 ? "+" : "") + dr + "%)")
    }
  }

  var report = lines.join("\n")
  fs.writeFileSync(path.join(CONFIG.outputDir, "backtest_v27_v28.txt"), report, "utf8")
  console.log("\n" + report)
}

runBacktest().catch(function(e) { console.error("Backtest failed:", e); process.exit(1) })
