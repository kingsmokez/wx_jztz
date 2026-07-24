var fs = require("fs")
var path = require("path")

var CONFIG = {
  holdDays: [5, 10],
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

// Generic V28 variant with configurable mildScore params
function simulatePickV28Variant(dayQuotes, klineMap, dateIdxMap, topN, params) {
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
    var mildScore = 0

    // chg mildness with params
    var chgBands = params.chgBands
    for (var b = 0; b < chgBands.length; b++) {
      if (chg >= chgBands[b][0] && chg < chgBands[b][1]) { mildScore += chgBands[b][2]; break }
    }
    // catch-all if no band matched
    if (b >= chgBands.length) mildScore += params.chgDefault || 5

    // volumeRatio mildness with params
    var vrBands = params.vrBands
    for (var b2 = 0; b2 < vrBands.length; b2++) {
      if (volumeRatio >= vrBands[b2][0] && volumeRatio < vrBands[b2][1]) { mildScore += vrBands[b2][2]; break }
    }
    if (b2 >= vrBands.length) mildScore += params.vrDefault || 5

    // RSI mildness with params
    var rsiBands = params.rsiBands
    for (var b3 = 0; b3 < rsiBands.length; b3++) {
      if (rsi >= rsiBands[b3][0] && rsi < rsiBands[b3][1]) { mildScore += rsiBands[b3][2]; break }
    }
    if (b3 >= rsiBands.length) mildScore += params.rsiDefault || 5

    // ADX confirmation bonus (if enabled)
    if (params.adxBonus && techData.adx !== undefined) {
      if (techData.adx >= params.adxThreshold && techData.plusDI > techData.minusDI) {
        mildScore += params.adxBonus
      }
    }

    // MA trend bonus (if enabled)
    if (params.maTrendBonus && techData.maSignal === "bull") {
      mildScore += params.maTrendBonus
    }

    var finalScore = v10Score * params.v10Weight + mildScore * params.mildWeight
    scored.push({ code: stock.code, price: stock.price, changePct: stock.changePct, score: Math.round(finalScore), v10Score: v10Score })
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

// V28 variants to test
var VARIANTS = {
  "V28_base": {
    v10Weight: 0.5, mildWeight: 0.5,
    chgBands: [[1,3,40],[0.5,1,25],[3,5,30],[5,7,15],[7,99,5]],
    chgDefault: 10,
    vrBands: [[1,2,40],[0.7,1,25],[2,3,30],[3,5,15],[5,99,5]],
    vrDefault: 10,
    rsiBands: [[40,60,20],[30,40,15],[60,70,10],[70,99,3]],
    rsiDefault: 8,
  },
  "V28a_0.6_0.4": {
    v10Weight: 0.6, mildWeight: 0.4,
    chgBands: [[1,3,40],[0.5,1,25],[3,5,30],[5,7,15],[7,99,5]],
    chgDefault: 10,
    vrBands: [[1,2,40],[0.7,1,25],[2,3,30],[3,5,15],[5,99,5]],
    vrDefault: 10,
    rsiBands: [[40,60,20],[30,40,15],[60,70,10],[70,99,3]],
    rsiDefault: 8,
  },
  "V28b_0.4_0.6": {
    v10Weight: 0.4, mildWeight: 0.6,
    chgBands: [[1,3,40],[0.5,1,25],[3,5,30],[5,7,15],[7,99,5]],
    chgDefault: 10,
    vrBands: [[1,2,40],[0.7,1,25],[2,3,30],[3,5,15],[5,99,5]],
    vrDefault: 10,
    rsiBands: [[40,60,20],[30,40,15],[60,70,10],[70,99,3]],
    rsiDefault: 8,
  },
  "V28c_chg35": {
    v10Weight: 0.5, mildWeight: 0.5,
    chgBands: [[1,3,40],[0.5,1,25],[3,5,35],[5,7,15],[7,99,5]],
    chgDefault: 10,
    vrBands: [[1,2,40],[0.7,1,25],[2,3,30],[3,5,15],[5,99,5]],
    vrDefault: 10,
    rsiBands: [[40,60,20],[30,40,15],[60,70,10],[70,99,3]],
    rsiDefault: 8,
  },
  "V28d_adx": {
    v10Weight: 0.5, mildWeight: 0.5,
    chgBands: [[1,3,40],[0.5,1,25],[3,5,30],[5,7,15],[7,99,5]],
    chgDefault: 10,
    vrBands: [[1,2,40],[0.7,1,25],[2,3,30],[3,5,15],[5,99,5]],
    vrDefault: 10,
    rsiBands: [[40,60,20],[30,40,15],[60,70,10],[70,99,3]],
    rsiDefault: 8,
    adxBonus: 10, adxThreshold: 20,
  },
  "V28e_chg1_4": {
    v10Weight: 0.5, mildWeight: 0.5,
    chgBands: [[1,4,40],[0.5,1,25],[4,6,30],[6,8,15],[8,99,5]],
    chgDefault: 10,
    vrBands: [[1,2,40],[0.7,1,25],[2,3,30],[3,5,15],[5,99,5]],
    vrDefault: 10,
    rsiBands: [[40,60,20],[30,40,15],[60,70,10],[70,99,3]],
    rsiDefault: 8,
  },
  "V28f_0.55_0.45": {
    v10Weight: 0.55, mildWeight: 0.45,
    chgBands: [[1,3,40],[0.5,1,25],[3,5,30],[5,7,15],[7,99,5]],
    chgDefault: 10,
    vrBands: [[1,2,40],[0.7,1,25],[2,3,30],[3,5,15],[5,99,5]],
    vrDefault: 10,
    rsiBands: [[40,60,20],[30,40,15],[60,70,10],[70,99,3]],
    rsiDefault: 8,
  },
  "V28g_adx_ma": {
    v10Weight: 0.5, mildWeight: 0.5,
    chgBands: [[1,3,40],[0.5,1,25],[3,5,30],[5,7,15],[7,99,5]],
    chgDefault: 10,
    vrBands: [[1,2,40],[0.7,1,25],[2,3,30],[3,5,15],[5,99,5]],
    vrDefault: 10,
    rsiBands: [[40,60,20],[30,40,15],[60,70,10],[70,99,3]],
    rsiDefault: 8,
    adxBonus: 8, adxThreshold: 18,
    maTrendBonus: 5,
  },
  "V28h_0.6_chg35": {
    v10Weight: 0.6, mildWeight: 0.4,
    chgBands: [[1,3,40],[0.5,1,25],[3,5,35],[5,7,15],[7,99,5]],
    chgDefault: 10,
    vrBands: [[1,2,40],[0.7,1,25],[2,3,30],[3,5,15],[5,99,5]],
    vrDefault: 10,
    rsiBands: [[40,60,20],[30,40,15],[60,70,10],[70,99,3]],
    rsiDefault: 8,
  },
  "V28i_0.55_adx": {
    v10Weight: 0.55, mildWeight: 0.45,
    chgBands: [[1,3,40],[0.5,1,25],[3,5,30],[5,7,15],[7,99,5]],
    chgDefault: 10,
    vrBands: [[1,2,40],[0.7,1,25],[2,3,30],[3,5,15],[5,99,5]],
    vrDefault: 10,
    rsiBands: [[40,60,20],[30,40,15],[60,70,10],[70,99,3]],
    rsiDefault: 8,
    adxBonus: 8, adxThreshold: 18,
  },
  "V28j_0.6_adx_ma": {
    v10Weight: 0.6, mildWeight: 0.4,
    chgBands: [[1,3,40],[0.5,1,25],[3,5,30],[5,7,15],[7,99,5]],
    chgDefault: 10,
    vrBands: [[1,2,40],[0.7,1,25],[2,3,30],[3,5,15],[5,99,5]],
    vrDefault: 10,
    rsiBands: [[40,60,20],[30,40,15],[60,70,10],[70,99,3]],
    rsiDefault: 8,
    adxBonus: 6, adxThreshold: 18,
    maTrendBonus: 4,
  },
}

async function runBacktest() {
  console.log("=".repeat(60))
  console.log("V28 Parameter Sweep Backtest")
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

  // Precompute dayQuotes for each sampling date
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

  // Run all variants
  var v10Picks = []
  var variantPicks = {}
  var variantNames = Object.keys(VARIANTS)
  for (var v = 0; v < variantNames.length; v++) variantPicks[variantNames[v]] = []

  var sampleDates = Object.keys(allDayQuotes).sort()
  console.log("\nRunning backtest on " + sampleDates.length + " dates...")

  for (var si = 0; si < sampleDates.length; si++) {
    var dateStr = sampleDates[si]
    var dayQuotes = allDayQuotes[dateStr]
    var dateIdxMap = allDateIdxMaps[dateStr]

    // V10 baseline
    var picks10 = simulatePickV10(dayQuotes, klineMap, dateIdxMap, CONFIG.topN)
    for (var p = 0; p < picks10.length; p++) {
      var pick = picks10[p]
      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)
      if (returns) v10Picks.push({ date: dateStr, code: pick.code, price: pick.price, returns: returns })
    }

    // All V28 variants
    for (var v = 0; v < variantNames.length; v++) {
      var vName = variantNames[v]
      var picks = simulatePickV28Variant(dayQuotes, klineMap, dateIdxMap, CONFIG.topN, VARIANTS[vName])
      for (var p = 0; p < picks.length; p++) {
        var pick = picks[p]
        var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)
        if (returns) variantPicks[vName].push({ date: dateStr, code: pick.code, price: pick.price, returns: returns })
      }
    }
  }

  // Calculate stats
  var sV10 = calcStats(v10Picks, CONFIG.holdDays)
  var lines = []
  lines.push("=".repeat(80))
  lines.push("V28 Parameter Sweep - Backtest Report")
  lines.push("=".repeat(80))
  lines.push("")
  lines.push("--- V10 BASELINE (n=" + v10Picks.length + ") ---")
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var d = CONFIG.holdDays[h]
    var stat = sV10["hold" + d]
    if (stat && stat.total > 0) lines.push("  Hold " + d + "d: winRate=" + stat.winRate + "% avgReturn=" + stat.avgReturn + "%")
  }

  // Collect results for ranking
  var resultsTable = []
  for (var v = 0; v < variantNames.length; v++) {
    var vName = variantNames[v]
    var sV = calcStats(variantPicks[vName], CONFIG.holdDays)
    var row = { name: vName, n: variantPicks[vName].length }

    lines.push("\n--- " + vName + " (n=" + row.n + ") ---")
    for (var h = 0; h < CONFIG.holdDays.length; h++) {
      var d = CONFIG.holdDays[h]
      var stat = sV["hold" + d]
      if (!stat || stat.total === 0) continue
      var orig = sV10["hold" + d]
      var dw = (stat.winRate - orig.winRate).toFixed(2)
      var dr = (stat.avgReturn - orig.avgReturn).toFixed(2)
      lines.push("  Hold " + d + "d: winRate=" + stat.winRate + "%(" + (dw >= 0 ? "+" : "") + dw + ") avgReturn=" + stat.avgReturn + "%(" + (dr >= 0 ? "+" : "") + dr + ")")
      row["wr" + d] = stat.winRate
      row["ar" + d] = stat.avgReturn
      row["dw" + d] = parseFloat(dw)
      row["dr" + d] = parseFloat(dr)
    }
    // Count how many metrics beat V10
    row.beatsV10 = 0
    for (var h = 0; h < CONFIG.holdDays.length; h++) {
      var d = CONFIG.holdDays[h]
      if (row["dw" + d] > 0) row.beatsV10++
      if (row["dr" + d] > 0) row.beatsV10++
    }
    resultsTable.push(row)
  }

  // Summary table
  lines.push("\n" + "=".repeat(80))
  lines.push("SUMMARY: Which variants beat V10 on ALL 4 metrics?")
  lines.push("=".repeat(80))
  lines.push("V10 baseline: 5dWR=" + sV10.hold5.winRate + "% 5dAR=" + sV10.hold5.avgReturn + "% 10dWR=" + sV10.hold10.winRate + "% 10dAR=" + sV10.hold10.avgReturn + "%")
  lines.push("")
  lines.push("Variant".padEnd(20) + "5dWR".padEnd(10) + "5dAR".padEnd(10) + "10dWR".padEnd(10) + "10dAR".padEnd(10) + "BeatsV10")
  lines.push("-".repeat(70))

  resultsTable.sort(function(a, b) { return b.beatsV10 - a.beatsV10 })
  for (var r = 0; r < resultsTable.length; r++) {
    var row = resultsTable[r]
    var allBeat = row.beatsV10 === 4 ? "ALL 4!" : row.beatsV10 + "/4"
    lines.push(row.name.padEnd(20) + (row.wr5 || "-").toString().padEnd(10) + (row.ar5 || "-").toString().padEnd(10) + (row.wr10 || "-").toString().padEnd(10) + (row.ar10 || "-").toString().padEnd(10) + allBeat)
  }

  // Best variants detail
  var bestVariants = resultsTable.filter(function(r) { return r.beatsV10 >= 3 })
  if (bestVariants.length > 0) {
    lines.push("\n" + "=".repeat(80))
    lines.push("BEST VARIANTS (3+ metrics beat V10):")
    lines.push("=".repeat(80))
    for (var b = 0; b < bestVariants.length; b++) {
      var bv = bestVariants[b]
      lines.push("\n" + bv.name + ":")
      lines.push("  5dWR: " + sV10.hold5.winRate + "% -> " + bv.wr5 + "% (" + (bv.dw5 >= 0 ? "+" : "") + bv.dw5 + "%)")
      lines.push("  5dAR: " + sV10.hold5.avgReturn + "% -> " + bv.ar5 + "% (" + (bv.dr5 >= 0 ? "+" : "") + bv.dr5 + "%)")
      lines.push("  10dWR: " + sV10.hold10.winRate + "% -> " + bv.wr10 + "% (" + (bv.dw10 >= 0 ? "+" : "") + bv.dw10 + "%)")
      lines.push("  10dAR: " + sV10.hold10.avgReturn + "% -> " + bv.ar10 + "% (" + (bv.dr10 >= 0 ? "+" : "") + bv.dr10 + "%)")
    }
  }

  var report = lines.join("\n")
  fs.writeFileSync(path.join(CONFIG.outputDir, "backtest_v28_sweep.txt"), report, "utf8")
  console.log("\n" + report)
}

runBacktest().catch(function(e) { console.error("Backtest failed:", e); process.exit(1) })
