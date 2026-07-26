/**
 * 尾盘强势股选股 V7 - 优化版，解决超时
 * 优化：涨幅榜Top200+量比榜Top200合并，先粗评分取Top80再获取K线
 */
var cloud = require("wx-server-sdk")
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
var db = cloud.database()
var _ = db.command
var http = require("./http")
var _eval = require("./evaluate"); var evaluateStock = _eval.evaluateStock; var calculateBuySell = _eval.calculateBuySell; var industryConcentrationLimit = _eval.industryConcentrationLimit

function todayStr() { var d = new Date(Date.now() + 8 * 3600 * 1000); return d.toISOString().slice(0, 10) }

function calcWp2Score(stock, rsi, volumeRatio, bollPosition, goldenCross, maSignal, momentum5d) {
  var score = 0
  var chg = stock.changePct || 0
  if (chg >= 2 && chg <= 5) score += 30; else if (chg > 5 && chg <= 7) score += 20
  else if (chg >= 1 && chg < 2) score += 20; else if (chg >= 0 && chg < 1) score += 10
  else if (chg > 7 && chg <= 9.5) score += 10; else if (chg < 0) score += Math.max(0, 3 + chg * 3)
  if (volumeRatio >= 1.5 && volumeRatio <= 3) score += 25; else if (volumeRatio > 3 && volumeRatio <= 5) score += 18
  else if (volumeRatio >= 1 && volumeRatio < 1.5) score += 15; else if (volumeRatio > 5 && volumeRatio <= 8) score += 10
  else if (volumeRatio < 1) score += 5
  var techScore = 0
  if (rsi >= 45 && rsi <= 60) techScore += 15; else if (rsi >= 60 && rsi <= 70) techScore += 12; else if (rsi >= 35 && rsi < 45) techScore += 8
  if (goldenCross) techScore += 10
  if (maSignal === "bull") techScore += 12
  if (bollPosition >= 0.6 && bollPosition <= 0.85) techScore += 8; else if (bollPosition > 0.85) techScore += 3; else if (bollPosition >= 0.45 && bollPosition < 0.6) techScore += 5
  if (momentum5d >= 5) techScore += 3
  score += Math.min(35, techScore)
  if (stock.pe > 0 && stock.pe <= 30) score += 5; else if (stock.pe > 30 && stock.pe <= 50) score += 2
  if ((stock.roe || 0) >= 10) score += 5
  if ((stock.grossMargin || 0) >= 25) score += 3
  if ((stock.debtRatio || 0) > 0 && stock.debtRatio <= 50) score += 2
  return Math.round(score)
}

function genWp2Signals(stock, rsi, goldenCross, maSignal, volumeRatio, bollPosition) {
  var signals = []
  var chg = stock.changePct || 0
  if (chg >= 2 && chg <= 5) signals.push("强势上涨+" + Math.round(chg * 10) / 10 + "%")
  else if (chg > 5 && chg <= 7) signals.push("大涨+" + Math.round(chg * 10) / 10 + "%")
  else if (chg >= 1 && chg < 2) signals.push("稳步上扬+" + Math.round(chg * 10) / 10 + "%")
  if (maSignal === "bull") signals.push("MA多头排列")
  if (volumeRatio >= 1.5 && volumeRatio <= 3) signals.push("量比" + Math.round(volumeRatio * 10) / 10 + "倍(适中)")
  else if (volumeRatio > 3 && volumeRatio <= 5) signals.push("量比" + Math.round(volumeRatio * 10) / 10 + "倍(放量)")
  else if (volumeRatio > 5) signals.push("巨量" + Math.round(volumeRatio * 10) / 10 + "倍")
  if (rsi >= 45 && rsi <= 60) signals.push("RSI" + rsi + "(强势区)")
  else if (rsi >= 60 && rsi <= 70) signals.push("RSI" + rsi + "(超强区)")
  if (goldenCross) signals.push("MACD金叉")
  if (bollPosition >= 0.6 && bollPosition <= 0.85) signals.push("布林中轨上方")
  else if (bollPosition > 0.85) signals.push("布林上轨附近")
  var amtYi = (stock.amount || 0) / 100000000
  if (amtYi >= 3 && amtYi <= 20) signals.push("成交额" + Math.round(amtYi * 100) / 100 + "亿")
  return signals.length > 0 ? signals : ["关注"]
}

function quickScore(stock) {
  var score = 0
  var chg = stock.changePct || 0
  var vr = stock.volumeRatio || 0
  var to = stock.turnover || 0
  if (chg >= 2 && chg <= 7) score += 30; else if (chg >= 1 && chg < 2) score += 20; else if (chg >= 0 && chg < 1) score += 10
  if (vr >= 1.5 && vr <= 5) score += 25; else if (vr >= 1 && vr < 1.5) score += 15; else if (vr > 5) score += 15
  if (to >= 2 && to <= 8) score += 20; else if (to >= 1 && to < 2) score += 15
  if (stock.pe > 0 && stock.pe <= 30) score += 10; else if (stock.pe > 30 && stock.pe <= 50) score += 5
  if ((stock.circCap || 0) >= 30 && (stock.circCap || 0) <= 200) score += 15
  return score
}

async function runWp2Picker(topN, force) {
  if (!topN) topN = 20
  var today = todayStr()

  if (!force) {
    try {
      var cached = await db.collection("pick_cache").where({ type: "wp2", date: today }).orderBy("cachedAt", "desc").limit(1).get()
      if (cached.data.length > 0 && Date.now() - cached.data[0].cachedAt < 180000) {
        return { stocks: cached.data[0].stocks, marketEnv: cached.data[0].marketEnv, cached: true }
      }
    } catch(e) {}
  }

  // === Phase1: 并行获取大盘+涨幅榜+量比榜 ===
  console.log("尾盘选股: Phase1并行获取...")
  var phase1Start = Date.now()
  var phase1Results = await Promise.all([
    http.fetchHS300().catch(function(e) { console.warn("沪深300失败:", e.message); return null }),
    http.fetchStockList("f3", 200).catch(function(e) { console.warn("涨幅榜失败:", e.message); return {} }),
    http.fetchStockList("f10", 200).catch(function(e) { console.warn("量比榜失败:", e.message); return {} })
  ])
  var hs300 = phase1Results[0]
  var changeStocks = phase1Results[1]
  var volumeRatioStocks = phase1Results[2]
  var marketEnv = { canPick: true, status: "震荡", changePct: 0 }
  if (hs300) marketEnv = { canPick: true, status: hs300.status, changePct: hs300.changePct }
  console.log("Phase1完成, 耗时 " + (Date.now() - phase1Start) + "ms")

  var allStocks = {}
  var codes1 = Object.keys(changeStocks)
  var codes2 = Object.keys(volumeRatioStocks)
  for (var i = 0; i < codes1.length; i++) allStocks[codes1[i]] = changeStocks[codes1[i]]
  for (var i = 0; i < codes2.length; i++) {
    if (!allStocks[codes2[i]]) allStocks[codes2[i]] = volumeRatioStocks[codes2[i]]
    else {
      var vs = volumeRatioStocks[codes2[i]]
      if (vs.volumeRatio > 0) allStocks[codes2[i]].volumeRatio = vs.volumeRatio
      if (vs.turnover > 0 && (!allStocks[codes2[i]].turnover || allStocks[codes2[i]].turnover === 0)) allStocks[codes2[i]].turnover = vs.turnover
    }
  }
  var codes = Object.keys(allStocks)
  console.log("候选股票: " + codes.length + " 只")

  var candidates = []
  for (var i = 0; i < codes.length; i++) {
    var stock = allStocks[codes[i]]
    if (!stock || !stock.name || stock.name.indexOf("ST") >= 0 || stock.name.indexOf("退") >= 0) continue
    if (stock.price <= 3 || stock.changePct <= 0) continue
    if (stock.turnover < 1 && stock.volumeRatio < 1) continue
    if (stock.circCap > 0 && stock.circCap < 20) continue
    if (stock.code.startsWith("8") || stock.code.startsWith("4") || stock.code.startsWith("920")) continue
    var qs = quickScore(stock)
    if (qs >= 25) candidates.push({ stock: stock, quickScore: qs })
  }
  candidates.sort(function(a, b) { return b.quickScore - a.quickScore })
  candidates = candidates.slice(0, 60)
  console.log("粗筛候选: " + candidates.length + " 只")

  // === Phase2: 并行获取K线+腾讯补全+行业 ===
  var klineCodes = candidates.map(function(c) { return c.stock.code })
  console.log("Phase2: 并行获取K线+腾讯+行业...")
  var phase2Start = Date.now()
  var phase2Results = await Promise.all([
    http.fetchKlinesConcurrent(klineCodes, 20).catch(function(e) { console.warn("K线失败:", e.message); return {} }),
    http.fetchTencentBatch(klineCodes, 60).catch(function(e) { console.warn("腾讯补全失败:", e.message); return {} }),
    http.fetchIndustryBatch(klineCodes).catch(function(e) { console.warn("行业获取失败:", e.message); return {} })
  ])
  var klinesMap = phase2Results[0]
  var klinesMap = phase2Results[0]
  var tencentData = phase2Results[1]
  var industryMap = phase2Results[2]
  console.log("Phase2完成, 耗时 " + (Date.now() - phase2Start) + "ms, K线=" + Object.keys(klinesMap).length + " 腾讯=" + Object.keys(tencentData).length + " 行业=" + Object.keys(industryMap).length)


  var results = []
  for (var i = 0; i < candidates.length; i++) {
    var stock = candidates[i].stock
    var td = tencentData[stock.code]
    if (td) {
      if (td.roe) stock.roe = td.roe
      if (td.grossMargin) stock.grossMargin = td.grossMargin
      if (td.debtRatio) stock.debtRatio = td.debtRatio
      if (td.turnover && td.turnover > 0) stock.turnover = td.turnover
      if (td.volumeRatio && td.volumeRatio > 0) stock.volumeRatio = td.volumeRatio
      if (td.pe && td.pe > 0) stock.pe = td.pe
      if (td.pb && td.pb > 0) stock.pb = td.pb
      if (td.circCap && td.circCap > 0) stock.circCap = td.circCap
    }

    var klines = klinesMap[stock.code]
    var tech = klines ? http.calcTechFromKlines(klines) : null
    var rsi = tech ? tech.rsi : 50
    var goldenCross = tech ? tech.goldenCross : false
    var maSignal = tech ? tech.maSignal : "neutral"
    var bollPosition = tech ? tech.bollPosition : 0.5
    var momentum5d = tech ? tech.momentum5d : 0

    var volumeRatio = stock.volumeRatio || 0
    if (volumeRatio <= 0.5) {
      var to = stock.turnover || 0
      if (to > 0) volumeRatio = to < 0.5 ? 0.5 : to < 2 ? 1.0 + to * 0.3 : 1.5 + (to - 2) * 0.2
      else volumeRatio = 1.0
    }

    var wp2Score = calcWp2Score(stock, rsi, volumeRatio, bollPosition, goldenCross, maSignal, momentum5d)
    if (wp2Score < 30) continue

    var v5Score = 50
    try {
      var er = evaluateStock({
        code: stock.code, name: stock.name, price: stock.price,
        pe: stock.pe || 0, pb: stock.pb || 0, roe: stock.roe || 0,
        marketCap: stock.circCap || 0,
        turnover: stock.turnover || 0, volumeRatio: volumeRatio,
        amount: stock.amount || 0, changePct: stock.changePct || 0,
        grossMargin: stock.grossMargin || 0, debtRatio: stock.debtRatio || 0,
      }, { rsi: rsi, macdSignal: tech ? tech.macd : 0, maSignal: maSignal })
      if (er) v5Score = er.v5Score || 50
    } catch(e) {}

    var blendedScore = Math.round(wp2Score * 0.7 + v5Score * 0.3)
    var signals = genWp2Signals(stock, rsi, goldenCross, maSignal, volumeRatio, bollPosition)

    var buySell = null
    try {
      buySell = calculateBuySell({
        code: stock.code, name: stock.name, price: stock.price,
        pe: stock.pe || 0, pb: stock.pb || 0, roe: stock.roe || 0,
        marketCap: stock.circCap || 0,
        turnover: stock.turnover || 0, changePct: stock.changePct || 0,
      }, blendedScore, null)
    } catch(e) {}

    var industry = http.guessIndustry(stock.name, stock.code, stock.industry, industryMap[stock.code])

    results.push({
      code: stock.code, name: stock.name,
      price: Math.round(stock.price * 100) / 100,
      industry: industry,
      changePct: Math.round((stock.changePct || 0) * 100) / 100,
      turnover: Math.round((stock.turnover || 0) * 100) / 100,
      volumeRatio: Math.round(volumeRatio * 100) / 100,
      amount: Math.round((stock.amount || 0) / 10000),
      pe: Math.round((stock.pe || 0) * 100) / 100,
      pb: Math.round((stock.pb || 0) * 100) / 100,
      roe: Math.round((stock.roe || 0) * 100) / 100,
      marketCap: Math.round((stock.circCap || 0) * 100) / 100,
      totalScore: blendedScore,
      techScore: Math.round(wp2Score),
      v5Score: Math.round(v5Score),
      rsi: rsi, maSignal: maSignal, goldenCross: goldenCross,
      momentum5d: Math.round(momentum5d * 100) / 100,
      bollPosition: Math.round(bollPosition * 100) / 100,
      grossMargin: Math.round((stock.grossMargin || 0) * 100) / 100,
      debtRatio: Math.round((stock.debtRatio || 0) * 100) / 100,
      signals: signals, reasons: signals.join(" | "),
      buySell: buySell,
    })
  }

  results.sort(function(a, b) { return b.totalScore - a.totalScore })
  var finalResults
  try {
    var limited = industryConcentrationLimit(results, 2, Math.min(topN, results.length))
    finalResults = limited.slice(0, Math.min(topN, limited.length))
  } catch(e) { finalResults = results.slice(0, Math.min(topN, results.length)) }
  console.log("尾盘选出: " + finalResults.length + " 只")

  try {
    var doc = { type: "wp2", date: today, stocks: finalResults, marketEnv: marketEnv, cachedAt: Date.now() }
    var oldCache = await db.collection("pick_cache").where({ type: "wp2", date: today }).orderBy("cachedAt", "desc").limit(1).get()
    if (oldCache.data.length > 0) await db.collection("pick_cache").doc(oldCache.data[0]._id).update({ data: doc })
    else await db.collection("pick_cache").add({ data: doc })
  } catch(e) { console.warn("缓存写入失败:", e.message) }

  return { stocks: finalResults, marketEnv: marketEnv, cached: false }
}

exports.main = async function(event, context) {
  var action = event.action
  var data = event.data || {}
  try {
    switch (action) {
      case "run":
        var result = await runWp2Picker(data.topN || 20, data.force || false)
        return { success: true, data: result.stocks, marketEnv: result.marketEnv, cached: result.cached || false }
      case "list":
        var today = todayStr()
        var cached = await db.collection("pick_cache").where({ type: "wp2", date: today }).orderBy("cachedAt", "desc").limit(1).get()
        if (cached.data.length > 0) return { success: true, data: cached.data[0].stocks, cached: true, marketEnv: cached.data[0].marketEnv }
        return { success: true, data: [], cached: false }
      default:
        return { success: false, error: "未知操作" }
    }
  } catch (err) {
    console.error("wp2Picker error:", err)
    return { success: false, error: err.message }
  }
}
