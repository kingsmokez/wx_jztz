/**
 * 回测 V3 - 精简版
 * 直接硬编码一批活跃股票代码
 */
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

if (!fs.existsSync(CONFIG.cacheDir)) fs.mkdirSync(CONFIG.cacheDir, { recursive: true })
if (!fs.existsSync(CONFIG.outputDir)) fs.mkdirSync(CONFIG.outputDir, { recursive: true })

var { calcTechFromKlines } = require("./indicators")
var { getLimitPct, calcTechScoreOriginal, calcTechScoreOptimized, calcTechScoreV10, calcTechScoreV11, calcTechScoreV12, calcTechScoreV13, calcTechScoreV14, calcTechScoreV15, calcTechScoreV16, calcTechScoreV17, calcTechScoreV18, calcTechScoreV19, calcTechScoreV20, calcTechScoreV21 } = require("./scoring")

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

// 直接生成代码列表
function generateStockCodes() {
  var codes = []
  // 沪市主板 600000-600999
  for (var i = 0; i <= 999; i++) { var c = "600" + String(i).padStart(3, "0"); codes.push(c) }
  // 沪市 601000-601999
  for (var i = 0; i <= 999; i++) { var c = "601" + String(i).padStart(3, "0"); codes.push(c) }
  // 沪市 603000-603999
  for (var i = 0; i <= 999; i++) { var c = "603" + String(i).padStart(3, "0"); codes.push(c) }
  // 沪市 605000-605999
  for (var i = 0; i <= 999; i++) { var c = "605" + String(i).padStart(3, "0"); codes.push(c) }
  // 深市主板 000001-002999
  for (var i = 1; i <= 2999; i++) { var c = String(i).padStart(6, "0"); codes.push(c) }
  // 创业板 300001-300999
  for (var i = 1; i <= 999; i++) { var c = "300" + String(i).padStart(3, "0"); codes.push(c) }
  // 创业板 301001-301999
  for (var i = 1; i <= 999; i++) { var c = "301" + String(i).padStart(3, "0"); codes.push(c) }
  return codes
}

// 用腾讯行情API验证哪些股票存在（批量80只）
async function validateStocks(codes) {
  var cacheFile = path.join(CONFIG.cacheDir, "validated_stocks.json")
  if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, "utf8"))
  
  var validCodes = []
  var batchSize = 80
  console.log("验证股票代码: " + codes.length + " 只")
  
  for (var b = 0; b < Math.min(codes.length, 5000); b += batchSize) {
    // 只检查前5000个（覆盖最活跃的）
    var batch = codes.slice(b, b + batchSize)
    var txCodes = batch.map(function(c) { return (c.startsWith("6") ? "sh" : "sz") + c })
    try {
      var text = await request("https://qt.gtimg.cn/q=" + txCodes.join(","), 10000)
      var lines = text.split(";")
      for (var li = 0; li < lines.length; li++) {
        var match = lines[li].match(/v_\w+="([^"]+)"/)
        if (!match) continue
        var parts = match[1].split("~")
        if (parts.length < 50) continue
        var code = parts[2]
        var price = parseFloat(parts[3]) || 0
        if (price > 0) validCodes.push({ code: code, market: code.startsWith("6") ? "sh" : "sz" })
      }
    } catch(e) {}
    if (b % 800 === 0) console.log("  已验证: " + validCodes.length + " 只 (处理到" + b + ")")
    await new Promise(function(r) { setTimeout(r, 200) })
  }
  
  console.log("有效股票: " + validCodes.length + " 只")
  fs.writeFileSync(cacheFile, JSON.stringify(validCodes), "utf8")
  return validCodes
}

async function fetchTencentKline(code, market) {
  var cacheFile = path.join(CONFIG.cacheDir, "tx_kline_" + code + ".json")
  if (fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, "utf8"))
  }
  var prefix = market || (code.startsWith("6") ? "sh" : "sz")
  var url = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=" + prefix + code + ",day,,,600,qfq"
  try {
    var text = await request(url, 10000)
    var data = JSON.parse(text)
    if (!data || !data.data) return []
    var stockKey = prefix + code
    var klineArr = (data.data[stockKey] && data.data[stockKey].qfqday) || []
    if (klineArr.length === 0) klineArr = (data.data[stockKey] && data.data[stockKey].day) || []
    if (klineArr.length === 0) return []
    var result = klineArr.map(function(arr) {
      return {
        date: arr[0], open: parseFloat(arr[1])||0, close: parseFloat(arr[2])||0,
        high: parseFloat(arr[3])||0, low: parseFloat(arr[4])||0,
        volume: parseFloat(arr[5])||0,
      }
    }).filter(function(k) { return k.close > 0 })
    for (var i = 1; i < result.length; i++) {
      if (result[i-1].close > 0) result[i].changePct = Math.round((result[i].close / result[i-1].close - 1) * 10000) / 100
      else result[i].changePct = 0
    }
    result[0].changePct = 0
    fs.writeFileSync(cacheFile, JSON.stringify(result), "utf8")
    return result
  } catch(e) { return [] }
}

async function fetchKlinesBatch(stockList, concurrency) {
  if (!concurrency) concurrency = 15
  var results = {}
  var index = 0
  var total = stockList.length
  async function worker() {
    while (index < total) {
      var stock = stockList[index++]
      try {
        var klines = await fetchTencentKline(stock.code, stock.market)
        if (klines.length >= 60) results[stock.code] = klines
      } catch(e) {}
      if (index % 200 === 0) console.log("  K线进度: " + index + "/" + total + " 有效:" + Object.keys(results).length)
      await new Promise(function(r) { setTimeout(r, 30) })
    }
  }
  var workers = []
  for (var i = 0; i < concurrency; i++) workers.push(worker())
  await Promise.all(workers)
  return results
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
    if (scoreFunc === "original") {
      score = calcTechScoreOriginal(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d)
    } else if (scoreFunc === "v10") {
      score = calcTechScoreV10(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)
    } else if (scoreFunc === "v13") {
      score = calcTechScoreV13(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)
} else if (scoreFunc === "v19") {
      score = calcTechScoreV19(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)
    } else if (scoreFunc === "v20") {
      score = calcTechScoreV20(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)
    } else if (scoreFunc === "v21") {
      score = calcTechScoreV21(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)
    } else if (scoreFunc === "v17") {
      score = calcTechScoreV17(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)
    } else if (scoreFunc === "v18") {
      score = calcTechScoreV18(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)
    } else if (scoreFunc === "v15") {
      score = calcTechScoreV15(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)
    } else if (scoreFunc === "v16") {
      score = calcTechScoreV16(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)
    } else if (scoreFunc === "v14") {
      // V14: V10评分 + 更严格筛选
      if (stock.changePct < 0) continue
      if (techData.rsi > 78) continue
      if (techData.maSignal === "bear") continue
      score = calcTechScoreV10(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)
    } else if (scoreFunc === "v12") {
      score = calcTechScoreV12(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)
    } else if (scoreFunc === "v11") {
      score = calcTechScoreV11(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)
    } else {
      score = calcTechScoreOptimized(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)
    }
    var minS = CONFIG.minScore
    if (score >= minS) {
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

function calcStats(picks, name) {
  var stats = { name: name, totalPicks: picks.length }
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var days = CONFIG.holdDays[h]
    var returns = [], wins = 0, total = 0, sumReturn = 0
    for (var i = 0; i < picks.length; i++) {
      var r = picks[i].returns[days]
      if (r === null || r === undefined) continue
      total++; returns.push(r); sumReturn += r
      if (r > 0) wins++
    }
    if (total === 0) { stats["hold" + days] = { total: 0 }; continue }
    returns.sort(function(a, b) { return a - b })
    stats["hold" + days] = {
      total: total,
      winRate: Math.round(wins / total * 10000) / 100,
      avgReturn: Math.round(sumReturn / total * 100) / 100,
      medianReturn: Math.round(returns[Math.floor(returns.length / 2)] * 100) / 100,
    }
  }
  // 分数区间
  stats.byBracket = {}
  var brackets = [{ min: 80, max: 100, label: "80-100分" }, { min: 65, max: 79, label: "65-79分" }, { min: 50, max: 64, label: "50-64分" }, { min: 45, max: 49, label: "45-49分" }]
  for (var b = 0; b < brackets.length; b++) {
    var br = brackets[b]
    var bp = picks.filter(function(p) { return p.score >= br.min && p.score <= br.max })
    if (bp.length === 0) continue
    var r5 = bp.filter(function(p) { return p.returns[5] !== null && p.returns[5] !== undefined }).map(function(p) { return p.returns[5] })
    if (r5.length === 0) continue
    var w5 = r5.filter(function(r) { return r > 0 }).length
    stats.byBracket[br.label] = { count: bp.length, winRate5d: Math.round(w5 / r5.length * 10000) / 100, avgReturn5d: Math.round(r5.reduce(function(a, b) { return a + b }, 0) / r5.length * 100) / 100 }
  }
  return stats
}

async function runBacktest() {
  console.log("=".repeat(60))
  console.log("短线强势股策略回测 V3")
  console.log("=".repeat(60))

  // 1. 验证股票
  console.log("\n[1/3] 验证活跃股票...")
  var allCodes = generateStockCodes()
  console.log("代码池: " + allCodes.length + " 只")
  var stockList = await validateStocks(allCodes)
  console.log("有效股票: " + stockList.length + " 只")

  // 2. 下载K线
  console.log("\n[2/3] 下载K线数据...")
  var klineMap = await fetchKlinesBatch(stockList, 15)
  var codes = Object.keys(klineMap)
  console.log("有效K线: " + codes.length + " 只")

  if (codes.length === 0) { console.error("无K线数据"); return }

  // 3. 提取交易日
  var dateSet = {}
  for (var ci = 0; ci < codes.length; ci++) {
    var klines = klineMap[codes[ci]]
    for (var ki = 0; ki < klines.length; ki++) dateSet[klines[ki].date] = true
  }
  var tradeDates = Object.keys(dateSet).sort()
  console.log("交易日: " + tradeDates.length + " 天")

  // 4. 回测
  console.log("\n[3/3] 逐日回测...")
  var allPicksV8 = [], allPicksV9 = [], allPicksV10 = [], allPicksV11 = [], allPicksV12 = [], allPicksV13 = [], allPicksV14 = [], allPicksV15 = [], allPicksV16 = [], allPicksV17 = [], allPicksV18 = [], allPicksV19 = [], allPicksV20 = [], allPicksV21 = []
  var processed = 0

  var startIdx = 0; for (var si = 0; si < tradeDates.length; si++) { if (tradeDates[si] >= "2024-07-01") { startIdx = si; break } } for (var di = startIdx; di < tradeDates.length - 10; di += 3) {
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

    var picksOrig = simulatePick(dayQuotes, klineMap, dateIdxMap, "original", CONFIG.topN)
    var picksOpt = simulatePick(dayQuotes, klineMap, dateIdxMap, "optimized", CONFIG.topN)
    var picksV10 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v10", CONFIG.topN)
    var picksV11 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v11", CONFIG.topN)
    var picksV12 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v12", CONFIG.topN)
    var picksV13 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v13", CONFIG.topN)
    var picksV14 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v14", CONFIG.topN)
    var picksV15 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v15", CONFIG.topN)
    var picksV16 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v16", CONFIG.topN)
    var picksV17 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v17", CONFIG.topN)
    var picksV18 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v18", CONFIG.topN)
    var picksV19 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v19", CONFIG.topN)
    var picksV20 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v20", CONFIG.topN)
    var picksV21 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v21", CONFIG.topN)

    for (var p = 0; p < picksOrig.length; p++) {
      var pick = picksOrig[p]
      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)
      if (returns) allPicksV8.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })
    }
    for (var p = 0; p < picksV10.length; p++) {
      var pick = picksV10[p]
      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)
      if (returns) allPicksV10.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })
    }
    for (var p = 0; p < picksV11.length; p++) {
      var pick = picksV11[p]
      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)
      if (returns) allPicksV11.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })
    }
    for (var p = 0; p < picksV12.length; p++) {
      var pick = picksV12[p]
      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)
      if (returns) allPicksV12.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })
    }
    for (var p = 0; p < picksV13.length; p++) {
      var pick = picksV13[p]
      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)
      if (returns) allPicksV13.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })
    }
    for (var p = 0; p < picksV14.length; p++) {
      var pick = picksV14[p]
      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)
      if (returns) allPicksV14.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })
    }
    for (var p = 0; p < picksV15.length; p++) {
      var pick = picksV15[p]
      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)
      if (returns) allPicksV15.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })
    }
    for (var p = 0; p < picksV16.length; p++) {
      var pick = picksV16[p]
      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)
      if (returns) allPicksV16.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })
    }
    for (var p = 0; p < picksV17.length; p++) {
      var pick = picksV17[p]
      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)
      if (returns) allPicksV17.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })
    }
    for (var p = 0; p < picksV18.length; p++) {
      var pick = picksV18[p]
      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)
      if (returns) allPicksV18.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })
    }
    for (var p = 0; p < picksV19.length; p++) {
      var pick = picksV19[p]
      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)
      if (returns) allPicksV19.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })
    }
    for (var p = 0; p < picksV20.length; p++) {
      var pick = picksV20[p]
      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)
      if (returns) allPicksV20.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })
    }
    for (var p = 0; p < picksV21.length; p++) {
      var pick = picksV21[p]
      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)
      if (returns) allPicksV21.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })
    }
    for (var p = 0; p < picksOpt.length; p++) {
      var pick = picksOpt[p]
      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)
      if (returns) allPicksV9.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })
    }
  }

  console.log("\nV8选股: " + allPicksV8.length + " 次")
  console.log("V9选股: " + allPicksV9.length + " 次")
console.log("V10选股: " + allPicksV10.length + " 次")
console.log("V11选股: " + allPicksV11.length + " 次")
console.log("V12选股: " + allPicksV12.length + " 次")
console.log("V13选股: " + allPicksV13.length + " 次")
console.log("V14选股: " + allPicksV14.length + " 次")
console.log("V15选股: " + allPicksV15.length + " 次")
console.log("V16选股: " + allPicksV16.length + " 次")
console.log("V17选股: " + allPicksV17.length + " 次")
console.log("V18选股: " + allPicksV18.length + " 次")
console.log("V19选股: " + allPicksV19.length + " 次")
console.log("V20选股: " + allPicksV20.length + " 次")
console.log("V21选股: " + allPicksV21.length + " 次")

  var sV8 = calcStats(allPicksV8, "原始策略V8")
  var sV9 = calcStats(allPicksV9, "优化策略V9")
  var sV10 = calcStats(allPicksV10, "深度优化V10")
  var sV11 = calcStats(allPicksV11, "终极优化V11")
  var sV12 = calcStats(allPicksV12, "终极V12")
  var sV13 = calcStats(allPicksV13, "区分度V13")
  var sV14 = calcStats(allPicksV14, "可持续V14")
  var sV15 = calcStats(allPicksV15, "形态识别V15")
  var sV16 = calcStats(allPicksV16, "动量趋势V16")
  var sV17 = calcStats(allPicksV17, "形态动量确认V17")
  var sV18 = calcStats(allPicksV18, "激进形态V18")
  var sV19 = calcStats(allPicksV19, "混合排名V19")
  var sV20 = calcStats(allPicksV20, "V10+形态过滤V20")
  var sV21 = calcStats(allPicksV21, "V16+形态过滤V21")

  // 输出
  var lines = []
  lines.push("=".repeat(70))
  lines.push("短线强势股策略回测报告")
  lines.push("区间: " + CONFIG.startDate + " ~ " + CONFIG.endDate)
  lines.push("=".repeat(70))
  var allStats = [sV8, sV9, sV10, sV11, sV12, sV13, sV14, sV15, sV16, sV17, sV18, sV19, sV20, sV21]
  for (var s = 0; s < allStats.length; s++) {
    var st = allStats[s]
    lines.push("\n--- " + st.name + " ---")
    lines.push("总选股: " + st.totalPicks)
    for (var h = 0; h < CONFIG.holdDays.length; h++) {
      var d = st["hold" + CONFIG.holdDays[h]]
      if (!d || d.total === 0) continue
      lines.push("  持" + CONFIG.holdDays[h] + "天: 样本" + d.total + " 胜率" + d.winRate + "% 均收" + d.avgReturn + "% 中位" + d.medianReturn + "%")
    }
    if (st.byBracket) {
      lines.push("  [按分数-持有5天]")
      for (var label in st.byBracket) { var b = st.byBracket[label]; lines.push("    " + label + ": " + b.count + "只 胜率" + b.winRate5d + "% 均收" + b.avgReturn5d + "%") }
    }
  }
  lines.push("\n=== V14 vs V8 ===")
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var orig = sV8["hold" + CONFIG.holdDays[h]], opt = sV14["hold" + CONFIG.holdDays[h]]
    if (!orig || !opt || orig.total === 0 || opt.total === 0) continue
    var dw = (opt.winRate - orig.winRate).toFixed(2), dr = (opt.avgReturn - orig.avgReturn).toFixed(2)
    lines.push("  持" + CONFIG.holdDays[h] + "天: 胜率" + orig.winRate + "%->" + opt.winRate + "%(" + (dw >= 0 ? "+" : "") + dw + "%) 均收" + orig.avgReturn + "%->" + opt.avgReturn + "%(" + (dr >= 0 ? "+" : "") + dr + "%)")
  }
  lines.push("\n=== V13 vs V8 ===")
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var orig = sV8["hold" + CONFIG.holdDays[h]], opt = sV13["hold" + CONFIG.holdDays[h]]
    if (!orig || !opt || orig.total === 0 || opt.total === 0) continue
    var dw = (opt.winRate - orig.winRate).toFixed(2), dr = (opt.avgReturn - orig.avgReturn).toFixed(2)
    lines.push("  持" + CONFIG.holdDays[h] + "天: 胜率" + orig.winRate + "%->" + opt.winRate + "%(" + (dw >= 0 ? "+" : "") + dw + "%) 均收" + orig.avgReturn + "%->" + opt.avgReturn + "%(" + (dr >= 0 ? "+" : "") + dr + "%)")
  }
  lines.push("\n=== V12 vs V8 ===")
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var orig = sV8["hold" + CONFIG.holdDays[h]], opt = sV12["hold" + CONFIG.holdDays[h]]
    if (!orig || !opt || orig.total === 0 || opt.total === 0) continue
    var dw = (opt.winRate - orig.winRate).toFixed(2), dr = (opt.avgReturn - orig.avgReturn).toFixed(2)
    lines.push("  持" + CONFIG.holdDays[h] + "天: 胜率" + orig.winRate + "%->" + opt.winRate + "%(" + (dw >= 0 ? "+" : "") + dw + "%) 均收" + orig.avgReturn + "%->" + opt.avgReturn + "%(" + (dr >= 0 ? "+" : "") + dr + "%)")
  }
  lines.push("\n=== V11 vs V8 ===")
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var orig = sV8["hold" + CONFIG.holdDays[h]], opt = sV11["hold" + CONFIG.holdDays[h]]
    if (!orig || !opt || orig.total === 0 || opt.total === 0) continue
    var dw = (opt.winRate - orig.winRate).toFixed(2), dr = (opt.avgReturn - orig.avgReturn).toFixed(2)
    lines.push("  持" + CONFIG.holdDays[h] + "天: 胜率" + orig.winRate + "%->" + opt.winRate + "%(" + (dw >= 0 ? "+" : "") + dw + "%) 均收" + orig.avgReturn + "%->" + opt.avgReturn + "%(" + (dr >= 0 ? "+" : "") + dr + "%)")
  }
  lines.push("\n=== V16 vs V8 ===")
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var orig = sV8["hold" + CONFIG.holdDays[h]], opt = sV16["hold" + CONFIG.holdDays[h]]
    if (!orig || !opt || orig.total === 0 || opt.total === 0) continue
    var dw = (opt.winRate - orig.winRate).toFixed(2), dr = (opt.avgReturn - orig.avgReturn).toFixed(2)
    lines.push("  持" + CONFIG.holdDays[h] + "天: 胜率" + orig.winRate + "%->" + opt.winRate + "%(" + (dw >= 0 ? "+" : "") + dw + "%) 均收" + orig.avgReturn + "%->" + opt.avgReturn + "%(" + (dr >= 0 ? "+" : "") + dr + "%)")
  }
  lines.push("\n=== V18 vs V8 ===")
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var orig = sV8["hold" + CONFIG.holdDays[h]], opt = sV18["hold" + CONFIG.holdDays[h]]
    if (!orig || !opt || orig.total === 0 || opt.total === 0) continue
    var dw = (opt.winRate - orig.winRate).toFixed(2), dr = (opt.avgReturn - orig.avgReturn).toFixed(2)
    lines.push("  持" + CONFIG.holdDays[h] + "天: 胜率" + orig.winRate + "%->" + opt.winRate + "%(" + (dw >= 0 ? "+" : "") + dw + "%) 均收" + orig.avgReturn + "%->" + opt.avgReturn + "%(" + (dr >= 0 ? "+" : "") + dr + "%)")
  }
  lines.push("\n=== V21 vs V10 ===")
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var orig = sV10["hold" + CONFIG.holdDays[h]], opt = sV21["hold" + CONFIG.holdDays[h]]
    if (!orig || !opt || orig.total === 0 || opt.total === 0) continue
    var dw = (opt.winRate - orig.winRate).toFixed(2), dr = (opt.avgReturn - orig.avgReturn).toFixed(2)
    lines.push("  持" + CONFIG.holdDays[h] + "天: 胜率" + orig.winRate + "%->" + opt.winRate + "%(" + (dw >= 0 ? "+" : "") + dw + "%) 均收" + orig.avgRate + "%->" + opt.avgReturn + "%(" + (dr >= 0 ? "+" : "") + dr + "%)")
  }
  lines.push("\n=== V20 vs V10 ===")
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var orig = sV10["hold" + CONFIG.holdDays[h]], opt = sV20["hold" + CONFIG.holdDays[h]]
    if (!orig || !opt || orig.total === 0 || opt.total === 0) continue
    var dw = (opt.winRate - orig.winRate).toFixed(2), dr = (opt.avgReturn - orig.avgReturn).toFixed(2)
    lines.push("  持" + CONFIG.holdDays[h] + "天: 胜率" + orig.winRate + "%->" + opt.winRate + "%(" + (dw >= 0 ? "+" : "") + dw + "%) 均收" + orig.avgReturn + "%->" + opt.avgReturn + "%(" + (dr >= 0 ? "+" : "") + dr + "%)")
  }
  lines.push("\n=== V19 vs V10 ===")
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var orig = sV10["hold" + CONFIG.holdDays[h]], opt = sV19["hold" + CONFIG.holdDays[h]]
    if (!orig || !opt || orig.total === 0 || opt.total === 0) continue
    var dw = (opt.winRate - orig.winRate).toFixed(2), dr = (opt.avgReturn - orig.avgReturn).toFixed(2)
    lines.push("  持" + CONFIG.holdDays[h] + "天: 胜率" + orig.winRate + "%->" + opt.winRate + "%(" + (dw >= 0 ? "+" : "") + dw + "%) 均收" + orig.avgReturn + "%->" + opt.avgReturn + "%(" + (dr >= 0 ? "+" : "") + dr + "%)")
  }
  lines.push("\n=== V17 vs V8 ===")
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var orig = sV8["hold" + CONFIG.holdDays[h]], opt = sV17["hold" + CONFIG.holdDays[h]]
    if (!orig || !opt || orig.total === 0 || opt.total === 0) continue
    var dw = (opt.winRate - orig.winRate).toFixed(2), dr = (opt.avgReturn - orig.avgReturn).toFixed(2)
    lines.push("  持" + CONFIG.holdDays[h] + "天: 胜率" + orig.winRate + "%->" + opt.winRate + "%(" + (dw >= 0 ? "+" : "") + dw + "%) 均收" + orig.avgReturn + "%->" + opt.avgReturn + "%(" + (dr >= 0 ? "+" : "") + dr + "%)")
  }
  lines.push("\n=== V15 vs V8 ===")
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var orig = sV8["hold" + CONFIG.holdDays[h]], opt = sV15["hold" + CONFIG.holdDays[h]]
    if (!orig || !opt || orig.total === 0 || opt.total === 0) continue
    var dw = (opt.winRate - orig.winRate).toFixed(2), dr = (opt.avgReturn - orig.avgReturn).toFixed(2)
    lines.push("  持" + CONFIG.holdDays[h] + "天: 胜率" + orig.winRate + "%->" + opt.winRate + "%(" + (dw >= 0 ? "+" : "") + dw + "%) 均收" + orig.avgReturn + "%->" + opt.avgReturn + "%(" + (dr >= 0 ? "+" : "") + dr + "%)")
  }
  lines.push("\n=== V16 vs V8 ===")
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var orig = sV8["hold" + CONFIG.holdDays[h]], opt = sV16["hold" + CONFIG.holdDays[h]]
    if (!orig || !opt || orig.total === 0 || opt.total === 0) continue
    var dw = (opt.winRate - orig.winRate).toFixed(2), dr = (opt.avgReturn - orig.avgReturn).toFixed(2)
    lines.push("  持" + CONFIG.holdDays[h] + "天: 胜率" + orig.winRate + "%->" + opt.winRate + "%(" + (dw >= 0 ? "+" : "") + dw + "%) 均收" + orig.avgReturn + "%->" + opt.avgReturn + "%(" + (dr >= 0 ? "+" : "") + dr + "%)")
  }
  lines.push("\n=== V15 vs V8 ===")
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var orig = sV8["hold" + CONFIG.holdDays[h]], opt = sV15["hold" + CONFIG.holdDays[h]]
    if (!orig || !opt || orig.total === 0 || opt.total === 0) continue
    var dw = (opt.winRate - orig.winRate).toFixed(2), dr = (opt.avgReturn - orig.avgReturn).toFixed(2)
    lines.push("  持" + CONFIG.holdDays[h] + "天: 胜率" + orig.winRate + "%->" + opt.winRate + "%(" + (dw >= 0 ? "+" : "") + dw + "%) 均收" + orig.avgReturn + "%->" + opt.avgReturn + "%(" + (dr >= 0 ? "+" : "") + dr + "%)")
  }
  lines.push("\n=== V10 vs V8 ===")
  for (var h = 0; h < CONFIG.holdDays.length; h++) {
    var orig = sV8["hold" + CONFIG.holdDays[h]], opt = sV10["hold" + CONFIG.holdDays[h]]
    if (!orig || !opt || orig.total === 0 || opt.total === 0) continue
    var dw = (opt.winRate - orig.winRate).toFixed(2), dr = (opt.avgReturn - orig.avgReturn).toFixed(2)
    lines.push("  持" + CONFIG.holdDays[h] + "天: 胜率" + orig.winRate + "%->" + opt.winRate + "%(" + (dw >= 0 ? "+" : "") + dw + "%) 均收" + orig.avgReturn + "%->" + opt.avgReturn + "%(" + (dr >= 0 ? "+" : "") + dr + "%)")
  }

  var report = lines.join("\n")
  fs.writeFileSync(path.join(CONFIG.outputDir, "backtest_report_v3.txt"), report, "utf8")
  fs.writeFileSync(path.join(CONFIG.outputDir, "backtest_data_v3.json"), JSON.stringify({ sV8: sV8, sV9: sV9, sV10: sV10, sV11: sV11, sV12: sV12, sV13: sV13, sV14: sV14, sV15: sV15, sV16: sV16, sV17: sV17, sV18: sV18, sV19: sV19, sV20: sV20, sV21: sV21 }, null, 2), "utf8")
  console.log("\n" + report)
  console.log("\n报告已保存到: " + CONFIG.outputDir)
}

runBacktest().catch(function(e) { console.error("回测失败:", e); process.exit(1) })
