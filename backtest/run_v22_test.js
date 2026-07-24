var fs = require("fs")
var path = require("path")
var https = require("https")

var CONFIG = {
  startDate: "2024-07-25",
  endDate: "2026-07-25",
  holdDays: [1, 3, 5, 10],
  topN: 20,
  minScore: 55,
  cacheDir: path.join(__dirname, "cache"),
  outputDir: path.join(__dirname, "results"),
}

if (!fs.existsSync(CONFIG.outputDir)) fs.mkdirSync(CONFIG.outputDir, { recursive: true })

var { calcTechFromKlines } = require("./indicators")
var { getLimitPct, calcTechScoreV10, calcTechScoreV22, calcTechScoreV23 } = require("./scoring")

function request(url, timeout) {
  return new Promise(function(resolve, reject) {
    var timer = setTimeout(function() { req.destroy(); reject(new Error("timeout")) }, timeout || 15000)
    var req = https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, function(res) {
      var bufs = []
      res.on("data", function(c) { bufs.push(c) })
      res.on("end", function() { clearTimeout(timer); resolve(Buffer.concat(bufs).toString(url.indexOf("gtimg") >= 0 ? "latin1" : "utf8")) })
    })
    req.on("error", function(e) { clearTimeout(timer); reject(e) })
  })
}

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

function simulatePick(dayQuotes, klineMap, dateIdxMap, scoreFunc, topN) {
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
    var score
    if (scoreFunc === "v10") {
      score = calcTechScoreV10(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)
    } else if (scoreFunc === "v22") {
      score = calcTechScoreV22(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)
    } else if (scoreFunc === "v23") {
      score = calcTechScoreV23(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)
    }
    if (score >= CONFIG.minScore) {
      scored.push({ code: stock.code, price: stock.price, changePct: stock.changePct, score: score, volumeRatio: volumeRatio, rsi: techData.rsi, maSignal: techData.maSignal })
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
  // Score brackets
  stats.byBracket = {}
  var brackets = [{ min: 55, max: 65, label: "55-65" }, { min: 65, max: 75, label: "65-75" }, { min: 75, max: 85, label: "75-85" }, { min: 85, max: 101, label: "85+" }]
  for (var b = 0; b < brackets.length; b++) {
    var br = brackets[b]
    var bp = allPicks.filter(function(p) { return p.score >= br.min && p.score <= br.max })
    if (bp.length === 0) continue
    var r5 = bp.filter(function(p) { return p.returns[5] !== null && p.returns[5] !== undefined }).map(function(p) { return p.returns[5] })
    var r10 = bp.filter(function(p) { return p.returns[10] !== null && p.returns[10] !== undefined }).map(function(p) { return p.returns[10] })
    var obj = { count: bp.length }
    if (r5.length > 0) {
      obj.winRate5d = Math.round(r5.filter(function(r) { return r > 0 }).length / r5.length * 10000) / 100
      obj.avgReturn5d = Math.round(r5.reduce(function(a, b) { return a + b }, 0) / r5.length * 100) / 100
    }
    if (r10.length > 0) {
      obj.winRate10d = Math.round(r10.filter(function(r) { return r > 0 }).length / r10.length * 10000) / 100
      obj.avgReturn10d = Math.round(r10.reduce(function(a, b) { return a + b }, 0) / r10.length * 100) / 100
    }
    stats.byBracket[br.label] = obj
  }
  return stats
}

async function runBacktest() {
  console.log("=".repeat(60))
  console.log("V22/V23 Strategy Backtest (vs V10 baseline)")
  console.log("=".repeat(60))

  // Load cached kline data
  var cacheDir = CONFIG.cacheDir
  if (!fs.existsSync(cacheDir)) { console.error("No cache dir"); return }
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

  if (codes.length === 0) { console.error("No K-line data"); return }

  // Extract trade dates
  var dateSet = {}
  for (var ci = 0; ci < codes.length; ci++) {
    var klines = klineMap[codes[ci]]
    for (var ki = 0; ki < klines.length; ki++) dateSet[klines[ki].date] = true
  }
  var tradeDates = Object.keys(dateSet).sort()
  console.log("Trade dates: " + tradeDates.length)

  // Backtest
  console.log("\nBacktesting...")
  var allPicksV10 = [], allPicksV22 = [], allPicksV23 = []
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
      { name: "v10", picks: allPicksV10 },
      { name: "v22", picks: allPicksV22 },
      { name: "v23", picks: allPicksV23 },
    ]

    for (var s = 0; s < strategies.length; s++) {
      var st = strategies[s]
      var picks = simulatePick(dayQuotes, klineMap, dateIdxMap, st.name, CONFIG.topN)
      for (var p = 0; p < picks.length; p++) {
        var pick = picks[p]
        var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)
        if (returns) st.picks.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })
      }
    }
  }

  console.log("\nTotal picks - V10:", allPicksV10.length, "V22:", allPicksV22.length, "V23:", allPicksV23.length)

  // Calculate stats
  var sV10 = calcStats(allPicksV10, CONFIG.holdDays)
  var sV22 = calcStats(allPicksV22, CONFIG.holdDays)
  var sV23 = calcStats(allPicksV23, CONFIG.holdDays)

  // Generate report
  var lines = []
  lines.push("=".repeat(60))
  lines.push("V22/V23 Backtest Report")
  lines.push("=".repeat(60))

  var strategies = [
    { name: "V10(baseline)", stats: sV10 },
    { name: "V22(V10+momentum+risk)", stats: sV22 },
    { name: "V23(V16+volRatio boost)", stats: sV23 },
  ]

  for (var s = 0; s < strategies.length; s++) {
    var st = strategies[s]
    lines.push("\n--- " + st.name + " ---")
    for (var h = 0; h < CONFIG.holdDays.length; h++) {
      var d = CONFIG.holdDays[h]
      var stat = st.stats["hold" + d]
      if (!stat || stat.total === 0) continue
      lines.push("  Hold " + d + "d: winRate=" + stat.winRate + "% avgReturn=" + stat.avgReturn + "% (n=" + stat.total + ")")
    }
    // Brackets
    lines.push("  Score brackets:")
    var brackets = ["55-65", "65-75", "75-85", "85+"]
    for (var b = 0; b < brackets.length; b++) {
      var br = st.stats.byBracket[brackets[b]]
      if (!br) continue
      lines.push("    " + brackets[b] + ": n=" + br.count + " win5d=" + (br.winRate5d || "N/A") + "% avg5d=" + (br.avgReturn5d || "N/A") + "% win10d=" + (br.winRate10d || "N/A") + "% avg10d=" + (br.avgReturn10d || "N/A") + "%")
    }
  }

  // Comparison
  lines.push("\n" + "=".repeat(60))
  lines.push("COMPARISON vs V10")
  lines.push("=".repeat(60))

  var comparisons = [
    { name: "V22", stats: sV22 },
    { name: "V23", stats: sV23 },
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
  fs.writeFileSync(path.join(CONFIG.outputDir, "backtest_v22_v23.txt"), report, "utf8")
  console.log("\n" + report)
  console.log("\nReport saved to: " + CONFIG.outputDir)
}

runBacktest().catch(function(e) { console.error("Backtest failed:", e); process.exit(1) })
