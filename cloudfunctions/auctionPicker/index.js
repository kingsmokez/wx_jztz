/**
 * 早盘集合竞价选股 V6 - 对齐原版 auction_picker.py
 * 两阶段评分: Phase1趋势/量能/位置 + Phase2跳空/量比/竞价金额/大盘
 * 信号: 跳空高开/温和放量/趋势向好/确认信号/换手率激活
 */
const cloud = require("wx-server-sdk")
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const http = require("./http")
const { evaluateStock, calculateBuySell } = require("./evaluate")

function todayStr() {
  var d = new Date(Date.now() + 8 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}

// ===== 第一阶段评分：趋势/量能/位置 =====
function phase1Score(stock) {
  var score = 0
  var chg = stock.changePct || 0
  var vr = stock.volumeRatio || 0
  var capYi = stock.circCap || stock.marketCap || 0
  var to = stock.turnover || 0

  // 涨幅趋势 (0-30)
  if (chg >= 1 && chg <= 3) score += 30
  else if (chg > 3 && chg <= 5) score += 25
  else if (chg > 5 && chg <= 8) score += 18
  else if (chg >= 0.5 && chg < 1) score += 15
  else if (chg >= 0 && chg < 0.5) score += 10

  // 量比能量 (0-30)
  if (vr >= 1.5 && vr <= 3) score += 30
  else if (vr > 3 && vr <= 5) score += 22
  else if (vr >= 1.0 && vr < 1.5) score += 18
  else if (vr > 5) score += 12

  // 市值位置 (0-20)
  if (capYi >= 30 && capYi <= 100) score += 20
  else if (capYi > 100 && capYi <= 200) score += 15
  else if (capYi > 200 && capYi <= 500) score += 10
  else if (capYi > 0 && capYi < 30) score += 12

  // 换手率 (0-20)
  if (to >= 1 && to <= 5) score += 20
  else if (to > 5 && to <= 10) score += 15
  else if (to >= 0.5 && to < 1) score += 10

  return Math.min(100, score)
}

// ===== 第二阶段评分：跳空/量比/竞价金额/大盘 =====
function phase2Score(stock, marketEnv) {
  var score = 0
  var chg = stock.changePct || 0

  // 跳空确认 (0-25)
  if (chg >= 1 && chg <= 3) score += 25
  else if (chg > 3 && chg <= 5) score += 20
  else if (chg > 5 && chg <= 8) score += 12
  else if (chg >= 0.5 && chg < 1) score += 15

  // 量比确认 (0-25)
  var vr = stock.volumeRatio || 0
  if (vr >= 2 && vr <= 4) score += 25
  else if (vr >= 1.5 && vr < 2) score += 20
  else if (vr > 4 && vr <= 6) score += 16
  else if (vr >= 1 && vr < 1.5) score += 10

  // 竞价成交额 (0-20)
  var amtYi = (stock.amount || 0) / 100000000
  if (amtYi >= 1 && amtYi <= 5) score += 20
  else if (amtYi > 5 && amtYi <= 10) score += 15
  else if (amtYi >= 0.5 && amtYi < 1) score += 10
  else if (amtYi >= 0.1 && amtYi < 0.5) score += 5

  // 大盘环境 (0-20)
  if (marketEnv && marketEnv.status === "上涨") score += 20
  else if (marketEnv && marketEnv.status === "大涨") score += 15
  else if (marketEnv && (marketEnv.status === "震荡" || marketEnv.status === "未知")) score += 10
  else if (marketEnv && marketEnv.status === "下跌") score += 5

  // 换手率确认 (0-10)
  var to = stock.turnover || 0
  if (to >= 1 && to <= 5) score += 10
  else if (to >= 0.5 && to < 1) score += 5

  return Math.min(100, score)
}

// ===== 集合竞价信号体系（对齐原版）=====
function genAuctionSignals(stock, phase1, phase2) {
  var signals = []
  var chg = stock.changePct || 0

  // 跳空高开信号
  if (chg >= 1 && chg <= 3) signals.push("跳空高开+" + Math.round(chg * 10) / 10 + "%")
  else if (chg > 3 && chg <= 5) signals.push("大幅高开+" + Math.round(chg * 10) / 10 + "%")
  else if (chg > 5) signals.push("跳空" + Math.round(chg * 10) / 10 + "%")
  else if (chg >= 0.5 && chg < 1) signals.push("小幅高开+" + Math.round(chg * 10) / 10 + "%")

  // 量比信号
  var vr = stock.volumeRatio || 0
  if (vr >= 1.5 && vr <= 3) signals.push("温和放量(" + Math.round(vr * 10) / 10 + "倍)")
  else if (vr > 3 && vr <= 5) signals.push("量比" + Math.round(vr * 10) / 10 + "倍")
  else if (vr > 5) signals.push("巨量" + Math.round(vr * 10) / 10 + "倍")

  // 换手率信号
  var to = stock.turnover || 0
  if (to >= 1 && to <= 5) signals.push("换手率" + Math.round(to * 100) / 100 + "%(活跃)")
  else if (to > 5 && to <= 10) signals.push("换手率" + Math.round(to * 100) / 100 + "%(高换手)")

  // 成交额信号
  var amtYi = (stock.amount || 0) / 100000000
  if (amtYi >= 1 && amtYi <= 5) signals.push("竞价成交" + Math.round(amtYi * 100) / 100 + "亿")
  else if (amtYi > 5) signals.push("竞价大额" + Math.round(amtYi * 100) / 100 + "亿")

  // 阶段评分信号
  if (phase1 >= 70) signals.push("初选强势(P1:" + Math.round(phase1) + ")")
  if (phase2 >= 70) signals.push("确认强势(P2:" + Math.round(phase2) + ")")

  return signals.length > 0 ? signals : ["关注"]
}

// ===== 主选股函数 =====
async function runAuctionPicker(topN, force) {
  if (!topN) topN = 20
  var today = todayStr()

  var _totalStart = Date.now()
  var _MAX_TOTAL = 50000  // 总超时50秒保护
  if (!force) {
    try {
      var cached = await db.collection("pick_cache").where({ type: "auction", date: today }).orderBy("cachedAt", "desc").limit(1).get()
      if (cached.data.length > 0 && Date.now() - cached.data[0].cachedAt < 120000) {
        return { stocks: cached.data[0].stocks, marketEnv: cached.data[0].marketEnv, cached: true }
      }
    } catch(e) {}
  }

  // === Phase1: 并行获取大盘+涨幅榜+换手率榜 ===
  console.log("竞价选股: Phase1并行获取...")
  var phase1Start = Date.now()
  var phase1Results = await Promise.all([
    http.fetchHS300().catch(function(e) { console.warn("沪深300失败:", e.message); return null }),
    http.fetchStockList("f3", 300).catch(function(e) { console.warn("涨幅榜失败:", e.message); return {} }),
    http.fetchStockList("f8", 200).catch(function(e) { console.warn("换手率榜失败:", e.message); return {} })
  ])
  var hs300 = phase1Results[0]
  var changeStocks = phase1Results[1]
  var turnoverStocks = phase1Results[2]
  var marketEnv = { canPick: true, status: "震荡", changePct: 0 }
  if (hs300) marketEnv = { canPick: true, status: hs300.status, changePct: hs300.changePct }
  console.log("Phase1完成, 耗时 " + (Date.now() - phase1Start) + "ms")

  // 合并去重
  var allStocks = {}
  var codes1 = Object.keys(changeStocks)
  var codes2 = Object.keys(turnoverStocks)
  for (var i = 0; i < codes1.length; i++) allStocks[codes1[i]] = changeStocks[codes1[i]]
  for (var i = 0; i < codes2.length; i++) { if (!allStocks[codes2[i]]) allStocks[codes2[i]] = turnoverStocks[codes2[i]] }
  var codes = Object.keys(allStocks)
  console.log("东财行情: " + codes.length + " 只")

  if (codes.length < 50) return { stocks: [], marketEnv: marketEnv, cached: false }

  // 预筛选
  var candidates = []
  for (var i = 0; i < codes.length; i++) {
    var s = allStocks[codes[i]]
    if (!s.code || !s.name) continue
    if (s.name.indexOf("ST") >= 0 || s.name.indexOf("*") >= 0 || s.name.indexOf("退") >= 0) continue
    if (s.code.startsWith("8") || s.code.startsWith("4") || s.code.startsWith("920") || s.code.startsWith("900") || s.code.startsWith("200")) continue
    if (s.price <= 3 || s.price > 500) continue
    if (s.circCap > 0 && (s.circCap < 20 || s.circCap > 3000)) continue
      if (s.changePct < -5) continue
      var limitPct = (s.code && (s.code.startsWith("300") || s.code.startsWith("301") || s.code.startsWith("688"))) ? 19.5 : 9.5
      if (s.changePct > limitPct) continue
    candidates.push(s)
  }
  console.log("预筛选: " + candidates.length + " 只")

  if (candidates.length === 0) return { stocks: [], marketEnv: marketEnv, cached: false }

  // 超时保护
  if (Date.now() - _totalStart > _MAX_TOTAL) {
    console.warn('总超时保护: Phase1后已超时，返回空结果')
    return { stocks: [], marketEnv: marketEnv, cached: false }
  }

  // === Phase2: 并行获取腾讯补全+行业 ===
  var candidateCodes = candidates.map(function(c) { return c.code })
  console.log("Phase2: 并行获取腾讯+行业...")
  var phase2Start = Date.now()
  var phase2Results = await Promise.all([
    http.fetchTencentBatch(candidateCodes.slice(0, Math.min(candidateCodes.length, 300)), 80).catch(function(e) { console.warn("腾讯补全失败:", e.message); return {} }),
    http.fetchIndustryBatch(candidateCodes).catch(function(e) { console.warn("行业获取失败:", e.message); return {} })
  ])
  var tencentData = phase2Results[0]
  var industryMap = phase2Results[1]
  console.log("Phase2完成, 耗时 " + (Date.now() - phase2Start) + "ms, 腾讯=" + Object.keys(tencentData).length + " 行业=" + Object.keys(industryMap).length)

  // 补全财务数据
  for (var ti = 0; ti < candidates.length; ti++) {
    var tc = candidates[ti]
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
var results = []
  for (var i = 0; i < candidates.length; i++) {
    var stock = candidates[i]
    var p1 = phase1Score(stock)
    var p2 = phase2Score(stock, marketEnv)
    var finalScore = Math.round(p1 * 0.5 + p2 * 0.5)

    if (finalScore < 30) continue

    var signals = genAuctionSignals(stock, p1, p2)

    var v5Score = 50
    try {
      var er = evaluateStock({
        code: stock.code, name: stock.name, price: stock.price,
        pe: stock.pe || 0, pb: stock.pb || 0, roe: stock.roe || 0,
        marketCap: stock.circCap || 0,
        turnover: stock.turnover || 0, volumeRatio: stock.volumeRatio || 0,
        amount: stock.amount || 0, changePct: stock.changePct || 0,
      }, null)
      if (er) v5Score = er.v5Score || 50
    } catch(e) {}

    var buySell = null
    try {
      buySell = calculateBuySell({
        code: stock.code, name: stock.name, price: stock.price,
        pe: stock.pe || 0, pb: stock.pb || 0, roe: stock.roe || 0,
        marketCap: stock.circCap || 0,
        turnover: stock.turnover || 0, changePct: stock.changePct || 0,
      }, finalScore, null)
    } catch(e) {}

    var industry = http.guessIndustry(stock.name, stock.code, stock.industry, industryMap[stock.code])

    results.push({
      code: stock.code, name: stock.name,
      price: Math.round(stock.price * 100) / 100,
      industry: industry,
      changePct: Math.round((stock.changePct || 0) * 100) / 100,
      gapPct: Math.round((stock.changePct || 0) * 100) / 100,
      turnover: Math.round((stock.turnover || 0) * 100) / 100,
      volumeRatio: Math.round((stock.volumeRatio || 0) * 100) / 100,
      amount: Math.round((stock.amount || 0) / 10000),
      pe: Math.round((stock.pe || 0) * 100) / 100,
      pb: Math.round((stock.pb || 0) * 100) / 100,
      marketCap: Math.round((stock.circCap || 0) * 100) / 100,
              roe: Math.round((stock.roe || 0) * 100) / 100,
        grossMargin: Math.round((stock.grossMargin || 0) * 100) / 100,
        debtRatio: Math.round((stock.debtRatio || 0) * 100) / 100,
phase1Score: Math.round(p1), phase2Score: Math.round(p2),
      finalScore: finalScore,
      signals: signals, reasons: signals.join(" | "),
      buySell: buySell,
    })
  }

  results.sort(function(a, b) { return b.finalScore - a.finalScore })
  var finalResults = results.slice(0, Math.min(topN, results.length))
  console.log("竞价选出: " + finalResults.length + " 只")

  try {
    var doc = { type: "auction", date: today, stocks: finalResults, marketEnv: marketEnv, cachedAt: Date.now() }
    var oldCache = await db.collection("pick_cache").where({ type: "auction", date: today }).orderBy("cachedAt", "desc").limit(1).get()
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
        var result = await runAuctionPicker(data.topN || 20, data.force || false)
        return { success: true, data: result.stocks, marketEnv: result.marketEnv, cached: result.cached || false }
      case "list":
        var today = todayStr()
        var cached = await db.collection("pick_cache").where({ type: "auction", date: today }).orderBy("cachedAt", "desc").limit(1).get()
        if (cached.data.length > 0) return { success: true, data: cached.data[0].stocks, cached: true, marketEnv: cached.data[0].marketEnv }
        return { success: true, data: [], cached: false }
      default:
        return { success: false, error: "未知操作" }
    }
  } catch (err) {
    console.error("auctionPicker error:", err)
    return { success: false, error: err.message }
  }
}
