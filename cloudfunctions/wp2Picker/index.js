/**
 * 尾盘强势股选股 V6 - 对齐原版 wp2_picker.py
 * 信号: MA多头排列/放量突破/RSI强势/下影线支撑
 */
const cloud = require("wx-server-sdk")
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const http = require("./http")
const { evaluateStock, calculateBuySell, industryConcentrationLimit } = require("./evaluate")

function todayStr() {
  var d = new Date(Date.now() + 8 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}

// ===== 尾盘选股评分（对齐原版 _wp2_calc_score）=====
function calcWp2Score(stock, rsi, volumeRatio, bollPosition, goldenCross, maSignal, momentum5d) {
  var score = 0
  var chg = stock.changePct || 0

  // 涨幅评分（尾盘偏好中等涨幅2-5%）
  if (chg >= 2 && chg <= 5) score += 30
  else if (chg > 5 && chg <= 7) score += 20
  else if (chg >= 1 && chg < 2) score += 20
  else if (chg >= 0 && chg < 1) score += 10
  else if (chg > 7 && chg <= 9.5) score += 10
  else if (chg < 0) score += Math.max(0, 3 + chg * 3)

  // 量比评分
  if (volumeRatio >= 1.5 && volumeRatio <= 3) score += 25
  else if (volumeRatio > 3 && volumeRatio <= 5) score += 18
  else if (volumeRatio >= 1 && volumeRatio < 1.5) score += 15
  else if (volumeRatio > 5 && volumeRatio <= 8) score += 10
  else if (volumeRatio < 1) score += 5

  // 技术指标
  var techScore = 0
  if (rsi >= 45 && rsi <= 60) techScore += 15
  else if (rsi >= 60 && rsi <= 70) techScore += 12
  else if (rsi >= 35 && rsi < 45) techScore += 8

  if (goldenCross) techScore += 10
  if (maSignal === "bull") techScore += 12

  if (bollPosition >= 0.6 && bollPosition <= 0.85) techScore += 8
  else if (bollPosition > 0.85) techScore += 3
  else if (bollPosition >= 0.45 && bollPosition < 0.6) techScore += 5

  if (momentum5d >= 5) techScore += 3
  score += Math.min(35, techScore)

  // 基本面加分
  if (stock.pe > 0 && stock.pe <= 30) score += 5
  else if (stock.pe > 30 && stock.pe <= 50) score += 2
  if ((stock.roe || 0) >= 10) score += 5
  if ((stock.grossMargin || 0) >= 25) score += 3
  if ((stock.debtRatio || 0) > 0 && stock.debtRatio <= 50) score += 2

  return Math.round(score)
}

// ===== 尾盘信号生成（对齐原版 WP2 信号体系）=====
function genWp2Signals(stock, rsi, goldenCross, maSignal, volumeRatio, bollPosition) {
  var signals = []
  var chg = stock.changePct || 0

  // 涨幅信号
  if (chg >= 2 && chg <= 5) signals.push("强势上涨+" + Math.round(chg * 10) / 10 + "%")
  else if (chg > 5 && chg <= 7) signals.push("大涨+" + Math.round(chg * 10) / 10 + "%")
  else if (chg >= 1 && chg < 2) signals.push("稳步上扬+" + Math.round(chg * 10) / 10 + "%")

  // MA信号
  if (maSignal === "bull") signals.push("MA多头排列")

  // 量比信号
  if (volumeRatio >= 1.5 && volumeRatio <= 3) signals.push("量比" + Math.round(volumeRatio * 10) / 10 + "倍(适中)")
  else if (volumeRatio > 3 && volumeRatio <= 5) signals.push("量比" + Math.round(volumeRatio * 10) / 10 + "倍(放量)")
  else if (volumeRatio > 5) signals.push("巨量" + Math.round(volumeRatio * 10) / 10 + "倍")

  // RSI信号
  if (rsi >= 45 && rsi <= 60) signals.push("RSI" + rsi + "(强势区)")
  else if (rsi >= 60 && rsi <= 70) signals.push("RSI" + rsi + "(超强区)")

  // 金叉信号
  if (goldenCross) signals.push("MACD金叉")

  // 布林带位置
  if (bollPosition >= 0.6 && bollPosition <= 0.85) signals.push("布林中轨上方")
  else if (bollPosition > 0.85) signals.push("布林上轨附近")

  // 成交额信号
  var amtYi = (stock.amount || 0) / 100000000
  if (amtYi >= 3 && amtYi <= 20) signals.push("成交额" + Math.round(amtYi * 100) / 100 + "亿")

  return signals.length > 0 ? signals : ["关注"]
}

// ===== 主选股函数 =====
async function runWp2Picker(topN, force) {
  if (!topN) topN = 20
  var today = todayStr()

  // 1. 检查缓存
  if (!force) {
    try {
      var cached = await db.collection("pick_cache").where({ type: "wp2", date: today }).orderBy("cachedAt", "desc").limit(1).get()
      if (cached.data.length > 0 && Date.now() - cached.data[0].cachedAt < 180000) {
        return { stocks: cached.data[0].stocks, marketEnv: cached.data[0].marketEnv, cached: true }
      }
    } catch(e) {}
  }

  var marketEnv = { canPick: true, status: "震荡", changePct: 0 }
  try { var hs300 = await http.fetchHS300(); if (hs300) marketEnv = { canPick: true, status: hs300.status, changePct: hs300.changePct } } catch(e) {}

  // 2. 东财全市场行情
  console.log("获取全市场行情...")
  var startTime = Date.now()
  var allStocks = await http.fetchEMAllStocks()
  var codes = Object.keys(allStocks)
  console.log("东财行情: " + codes.length + " 只, 耗时 " + (Date.now() - startTime) + "ms")

  if (codes.length < 3000) {
    console.log("东财数据不足,尝试新浪降级...")
    startTime = Date.now()
    allStocks = await http.fetchSinaAllStocks()
    codes = Object.keys(allStocks)
    console.log("新浪行情: " + codes.length + " 只, 耗时 " + (Date.now() - startTime) + "ms")
  }

  if (codes.length < 50) return { stocks: [], marketEnv: marketEnv, cached: false }

  // 3. 预筛选
  var candidates = []
  for (var i = 0; i < codes.length; i++) {
    var s = allStocks[codes[i]]
    if (!s.code || !s.name) continue
    if (s.name.indexOf("ST") >= 0 || s.name.indexOf("*") >= 0 || s.name.indexOf("退") >= 0) continue
    if (s.code.startsWith("8") || s.code.startsWith("4") || s.code.startsWith("920") || s.code.startsWith("900") || s.code.startsWith("200")) continue
    if (s.price <= 3 || s.price > 500) continue
    if (s.circCap > 0 && (s.circCap < 20 || s.circCap > 3000)) continue
      if (s.changePct < -3) continue
      var limitPct = (s.code && (s.code.startsWith("300") || s.code.startsWith("301") || s.code.startsWith("688"))) ? 19.5 : 9.5
      if (s.changePct > limitPct) continue
    candidates.push(s)
  }
  console.log("预筛选: " + candidates.length + " 只")

  if (candidates.length === 0) return { stocks: [], marketEnv: marketEnv, cached: false }

  // 4. 取候选股中top的K线计算技术指标
  var topCandidates = candidates.slice(0, Math.min(candidates.length, 300))
  var candidateCodes = topCandidates.map(function(c) { return c.code })
  console.log("获取K线技术指标...")
  var klinesMap = await http.fetchKlinesConcurrent(candidateCodes, 20)
  // 补全财务数据（ROE/毛利率/负债率/换手率/量比）
  console.log("获取腾讯行情补全财务数据...")
  var tencentStartTime = Date.now()
  var tencentData = {}
  try {
    tencentData = await http.fetchTencentBatch(candidateCodes, 80)
    console.log("腾讯行情补全: " + Object.keys(tencentData).length + " 只, 耗时 " + (Date.now() - tencentStartTime) + "ms")
    // 合并腾讯数据到候选股
    for (var ti = 0; ti < topCandidates.length; ti++) {
      var tc = topCandidates[ti]
      var td = tencentData[tc.code]
      if (td) {
        if (td.roe) tc.roe = td.roe
        if (td.grossMargin) tc.grossMargin = td.grossMargin
        if (td.debtRatio) tc.debtRatio = td.debtRatio
        if (td.turnover && td.turnover > 0) tc.turnover = td.turnover
        if (td.volumeRatio && td.volumeRatio > 0) tc.volumeRatio = td.volumeRatio
        if (td.pe && td.pe > 0) tc.pe = td.pe
        if (td.pb && td.pb > 0) tc.pb = td.pb
        if (td.circCap && td.circCap > 0) tc.circCap = td.circCap
      }
    }
  } catch(e) { console.warn("腾讯行情补全失败:", e.message) }


  // 5. 计算技术指标 + 评分
  var results = []
  for (var i = 0; i < topCandidates.length; i++) {
    var stock = topCandidates[i]
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

    var industry = http.guessIndustry(stock.name, stock.code)

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
