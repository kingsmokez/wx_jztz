/**
 * 短线强势股选股 V7 - 完全对齐原版 strong_stock_picker.py
 *
 * 信号体系（与原版 HTML 模板完全一致）：
 *   回调企稳 / 金叉 / 温和放量 / 明显放量 / 极端放量 / 突破 / 强势 / 追高风险
 *   RSI超卖 / RSI偏高 / PE低估 / ROE优秀
 *
 * 数据源: 东财datacenter全市场 + 腾讯K线技术指标
 */
var cloud = require("wx-server-sdk")
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
var db = cloud.database()
var _ = db.command
var http = require("./http")
var _eval = require("./evaluate"); var evaluateStock = _eval.evaluateStock; var calculateBuySell = _eval.calculateBuySell; var industryConcentrationLimit = _eval.industryConcentrationLimit

function todayStr() {
  var d = new Date(Date.now() + 8 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}

// ===== 涨停阈值 =====
function getLimitPct(code) {
  if (code.startsWith("300") || code.startsWith("301") || code.startsWith("688")) return 19.5
  return 9.5
}

// ===== 回踩企稳判断（原版 _check_pullback_stable）=====
function checkPullbackStable(maSignal, low, price, high, changePct) {
  if (maSignal !== "bull") return false
  if (!price || price <= 0) return false
  var hasLowerShadow = low < price && (price - low) > (high - price)
  var isUp = changePct > 0
  return hasLowerShadow && isUp
}

// ===== 量比兜底计算（原版 _calc_volume_ratio）=====
function calcVolumeRatioFallback(turnover) {
  if (turnover <= 0) return 0
  if (turnover < 0.5) return Math.round(turnover * 0.6 * 100) / 100
  if (turnover < 2) return Math.round((0.5 + turnover * 0.35) * 100) / 100
  if (turnover < 5) return Math.round((1.0 + (turnover - 2) * 0.5) * 100) / 100
  return Math.round((2.5 + (turnover - 5) * 0.5) * 100) / 100
}

// ===== 强势股技术面评分（原版 _calc_strong_score）=====
function calcTechScore(stock, rsi, goldenCross, volumeRatio, bollPosition, code, isAfterHours, change5d) {
  var score = 0
  var chg = stock.changePct || 0
  var isGem = code.startsWith("300") || code.startsWith("301") || code.startsWith("688")

  // 1. 涨幅得分 (0-25)
  if (isGem) {
    if (chg >= 2 && chg <= 4) score += 25
    else if (chg > 4 && chg <= 6) score += 22
    else if (chg > 6 && chg <= 10) score += 20
    else if (chg > 10 && chg <= 15) score += 15
    else if (chg > 15 && chg <= 19) score += 8
    else if (chg >= 1 && chg < 2) score += 18
    else if (chg >= 0 && chg < 1) score += 10
    else if (chg < 0) score += Math.max(0, 5 + chg)
  } else {
    if (chg >= 2 && chg <= 4) score += 25
    else if (chg > 4 && chg <= 6) score += 22
    else if (chg >= 1 && chg < 2) score += 18
    else if (chg >= 0 && chg < 1) score += 10
    else if (chg > 6 && chg <= 8) score += 15
    else if (chg < 0) score += Math.max(0, 5 + chg)
  }

  // 2. 量比得分 (0-20)
  if (isAfterHours && volumeRatio < 0.5) {
    score += 10
    if (change5d >= 10) score += 8
    else if (change5d >= 5) score += 5
    else if (change5d >= 3) score += 2
  } else if (volumeRatio >= 1.5 && volumeRatio <= 3) score += 20
  else if (volumeRatio >= 1.0 && volumeRatio < 1.5) score += 12
  else if (volumeRatio > 3 && volumeRatio <= 5) score += 15
  else if (volumeRatio >= 0.5 && volumeRatio < 1.0) score += 5
  else if (volumeRatio > 5) score += 8

  // 3. 技术指标得分 (0-25)
  var techScore = 0
  if (rsi >= 50 && rsi <= 65) techScore += 10
  else if (rsi >= 40 && rsi < 50) techScore += 6
  else if (rsi > 65 && rsi <= 75) techScore += 5

  if (goldenCross) techScore += 8

  if (bollPosition >= 0.7) techScore += 4
  else if (bollPosition >= 0.5 && bollPosition < 0.7) techScore += 7

  if (change5d >= 15) techScore += 5
  else if (change5d >= 10) techScore += 4
  else if (change5d >= 5) techScore += 2

  score += Math.min(25, techScore)

  // 4. 基本面加分 (0-18)
  var fundamental = 0
  if ((stock.roe || 0) >= 15) fundamental += 8
  else if ((stock.roe || 0) >= 10) fundamental += 5
  else if ((stock.roe || 0) >= 5) fundamental += 2

  if ((stock.grossMargin || 0) >= 30) fundamental += 4
  else if ((stock.grossMargin || 0) >= 20) fundamental += 2

  if (stock.pe > 0 && stock.pe <= 20) fundamental += 6
  else if (stock.pe > 20 && stock.pe <= 35) fundamental += 3

  if ((stock.debtRatio || 0) > 0 && stock.debtRatio <= 50) fundamental += 4
  else if ((stock.debtRatio || 0) > 50 && stock.debtRatio <= 70) fundamental += 2

  score += fundamental
  return Math.round(Math.min(100, Math.max(0, score)))
}

// ===== 生成选股理由（完全对齐原版 reason_parts）=====
function genReasons(stock, v5Reasons, goldenCross, volumeRatio, rsi, pullbackStable, pe, roe) {
  var parts = []
  if (v5Reasons) parts.push(v5Reasons)
  if (goldenCross) parts.push("金叉")
  if (volumeRatio > 2.0) parts.push("量比" + volumeRatio.toFixed(1) + "倍")
  else if (volumeRatio > 1.5) parts.push("量比" + volumeRatio.toFixed(1) + "倍")
  if (rsi > 0 && rsi < 30) parts.push("RSI超卖")
  else if (rsi > 70) parts.push("RSI偏高")
  if (pullbackStable) parts.push("回调企稳")
  if (pe > 0 && pe < 15) parts.push("PE" + Math.round(pe) + "低估")
  if (roe > 15) parts.push("ROE" + Math.round(roe) + "%优秀")
  return parts.length > 0 ? parts.join(" | ") : null
}

// ===== 主选股函数 =====
async function runStrongPicker(topN, force) {
  if (!topN) topN = 20
  var today = todayStr()

  // 1. 检查缓存
  if (!force) {
    try {
      var cached = await db.collection("pick_cache").where({ type: "strong", date: today }).orderBy("cachedAt", "desc").limit(1).get()
      if (cached.data.length > 0 && Date.now() - cached.data[0].cachedAt < 180000) {
        return { stocks: cached.data[0].stocks, marketEnv: cached.data[0].marketEnv, cached: true }
      }
    } catch(e) {}
  }

  var marketEnv = { canPick: true, status: "震荡", changePct: 0 }
  try { var hs300 = await http.fetchHS300(); if (hs300) marketEnv = { canPick: true, status: hs300.status, changePct: hs300.changePct } } catch(e) {}

  // 2. 获取全市场行情（东财主源 → 新浪降级）
  console.log("获取全市场行情(东财)...")
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

  // 3. 预筛选（排除ST/北交所/B股/价格异常/市值异常/跌停）
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
    if (s.turnover <= 0 && s.volume <= 0) continue
    candidates.push(s)
  }
  console.log("预筛选: " + candidates.length + " 只")

  if (candidates.length === 0) return { stocks: [], marketEnv: marketEnv, cached: false }

  // 4. 取TOP候选股计算K线技术指标
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


  // 5. 逐只评分（原版 score_one 逻辑）
  var results = []
  for (var i = 0; i < topCandidates.length; i++) {
    var stock = topCandidates[i]
    var code = stock.code

    var klines = klinesMap[code]
    var tech = klines ? http.calcTechFromKlines(klines) : null
    var rsi = tech ? tech.rsi : 50
    var goldenCross = tech ? tech.goldenCross : false
    var maSignal = tech ? tech.maSignal : "neutral"
    var bollPosition = tech ? tech.bollPosition : 0.5
    var change5d = tech ? tech.momentum5d : 0
    // 20日最高价
    var high20d = 0
    if (klines && klines.length >= 20) {
      var recentKlines = klines.slice(-20)
      high20d = Math.max.apply(null, recentKlines.map(function(k) { return k.high }))
    }

    // 量比（原版优先级：API真实值 > K线估算 > 兜底计算）
    var volumeRatio = stock.volumeRatio || 0
    var turnover = stock.turnover || 0
    var isAfterHours = turnover < 0.3 && volumeRatio < 0.5
    if (volumeRatio <= 0.5) volumeRatio = calcVolumeRatioFallback(turnover)

    // 原版信号判断
    var pullbackStable = checkPullbackStable(maSignal, stock.low || 0, stock.price, stock.high || 0, stock.changePct || 0)
    var limitRatio = 1.0 + (getLimitPct(code) + 0.5) / 100
    var hasLimitUp = stock.high > 0 && stock.prevClose > 0 && stock.high / stock.prevClose >= limitRatio

    var gentleVolume = volumeRatio >= 1.0 && volumeRatio <= 2.0 && (isAfterHours || turnover > 0)
    var moderateVolume = volumeRatio > 2.0 && volumeRatio <= 4.0 && (isAfterHours || turnover > 0)
    var extremeVolume = volumeRatio > 4.0 && (isAfterHours || turnover > 0)

    // 突破（价格接近20日高点）
    var breakthroughPct = -1
    if (stock.price > 0 && high20d > 0) {
      breakthroughPct = Math.round((stock.price / high20d - 1) * 10000) / 100
    }

    // 布林位置（百分比）
    var positionPct = Math.round(bollPosition * 1000) / 10

    // 技术面评分
    var techScore = calcTechScore(stock, rsi, goldenCross, volumeRatio, bollPosition, code, isAfterHours, change5d)

    // V5基本面评分
    var v5Score = 50, v5Reasons = null
    try {
      var er = evaluateStock({
        code: code, name: stock.name, price: stock.price,
        pe: stock.pe || 0, pb: stock.pb || 0, roe: stock.roe || 0,
        marketCap: stock.circCap || 0,
        turnover: turnover, volumeRatio: volumeRatio,
        amount: stock.amount || 0, changePct: stock.changePct || 0,
        grossMargin: stock.grossMargin || 0, debtRatio: stock.debtRatio || 0,
      }, { rsi: rsi, macdSignal: tech ? (tech.macd > 0 ? "golden_cross" : "death_cross") : "neutral", maSignal: maSignal, momentum_20: change5d })
      if (er) { v5Score = er.v5Score || er.totalScore || 50; v5Reasons = er.v5Reasons || er.recommendation || null }
    } catch(e) {}

    // ROE/Q惩罚
    var roe = stock.roe || 0
    if (roe > 0 && roe < 5) v5Score *= 0.80
    else if (roe > 0 && roe < 8) v5Score *= 0.90
    if (er && er.v5Factors) {
      var qVal = er.v5Factors.quality || 50
      if (qVal < 25) v5Score *= 0.85
    }

    // 混合评分
    var blendedScore = Math.round(techScore * 0.6 + v5Score * 0.4)

    // 原版 reason_parts
    var reasons = genReasons(stock, v5Reasons, goldenCross, volumeRatio, rsi, pullbackStable, stock.pe || 0, roe)

    var buySell = null
    try {
      buySell = calculateBuySell({
        code: code, name: stock.name, price: stock.price,
        pe: stock.pe || 0, pb: stock.pb || 0, roe: roe,
        marketCap: stock.circCap || 0,
        turnover: turnover, changePct: stock.changePct || 0,
      }, blendedScore, null)
    } catch(e) {}

    var industry = http.guessIndustry(stock.name, code)

    // 输出字段与原版 result dict 完全一致
    results.push({
      code: code,
      name: stock.name,
      price: Math.round(stock.price * 100) / 100,
      changePct: Math.round((stock.changePct || 0) * 100) / 100,
      change5d: Math.round(change5d * 100) / 100,
      marketCap: Math.round((stock.circCap || 0) * 100) / 100,
      score: blendedScore,
      totalScore: blendedScore,
      techScore: Math.round(techScore),
      v5Score: Math.round(v5Score * 10) / 10,
      volumeRatio: Math.round(volumeRatio * 100) / 100,
      turnover: Math.round(turnover * 100) / 100,
      positionPct: positionPct,
      breakthroughPct: breakthroughPct,
      rsi: Math.round(rsi * 10) / 10,
      goldenCross: goldenCross,
      pullbackStable: pullbackStable,
      hasLimitUp: hasLimitUp,
      gentleVolume: gentleVolume,
      moderateVolume: moderateVolume,
      extremeVolume: extremeVolume,
      pe: Math.round((stock.pe || 0) * 100) / 100,
      pb: Math.round((stock.pb || 0) * 100) / 100,
      roe: Math.round(roe * 100) / 100,
      grossMargin: Math.round((stock.grossMargin || 0) * 100) / 100,
      debtRatio: Math.round((stock.debtRatio || 0) * 100) / 100,
      amount: Math.round((stock.amount || 0) / 10000),
      amplitude: Math.round((stock.amplitude || 0) * 100) / 100,
      bollPosition: Math.round(bollPosition * 100) / 100,
      maSignal: maSignal,
      momentum5d: Math.round(change5d * 100) / 100,
      reasons: reasons,
      buySell: buySell,
      industry: industry,
      // 信号标签列表（供WXML渲染）
      signals: buildSignalTags({
        goldenCross: goldenCross,
        pullbackStable: pullbackStable,
        gentleVolume: gentleVolume,
        moderateVolume: moderateVolume,
        extremeVolume: extremeVolume,
        breakthroughPct: breakthroughPct,
        change5d: change5d,
        positionPct: positionPct,
        changePct: stock.changePct || 0,
        rsi: rsi,
        pe: stock.pe || 0,
        roe: roe,
      }),
    })
  }

  // 排序
  results.sort(function(a, b) { return b.score - a.score })

  // 行业集中度限制
  var finalResults
  try {
    var limited = industryConcentrationLimit(results, 2, Math.min(topN, results.length))
    finalResults = limited.slice(0, Math.min(topN, limited.length))
  } catch(e) { finalResults = results.slice(0, Math.min(topN, results.length)) }
  console.log("短线强势股选出: " + finalResults.length + " 只")

  // 缓存
  try {
    var doc = { type: "strong", date: today, stocks: finalResults, marketEnv: marketEnv, cachedAt: Date.now() }
    var oldCache = await db.collection("pick_cache").where({ type: "strong", date: today }).orderBy("cachedAt", "desc").limit(1).get()
    if (oldCache.data.length > 0) await db.collection("pick_cache").doc(oldCache.data[0]._id).update({ data: doc })
    else await db.collection("pick_cache").add({ data: doc })
  } catch(e) { console.warn("缓存写入失败:", e.message) }

  return { stocks: finalResults, marketEnv: marketEnv, cached: false }
}

// ===== 构建信号标签（与原版 HTML 模板一一对应）=====
function buildSignalTags(s) {
  var tags = []
  // 回调企稳 — sig-pullback
  if (s.pullbackStable) tags.push("回调企稳")
  // 突破 — sig-break
  if (s.breakthroughPct >= 0) tags.push("突破")
  // 金叉 — sig-cross
  if (s.goldenCross) tags.push("金叉")
  // 温和放量 — sig-gentle
  if (s.gentleVolume) tags.push("温和放量")
  // 明显放量 — sig-moderate
  if (s.moderateVolume) tags.push("明显放量")
  // 极端放量 — sig-extreme
  if (s.extremeVolume) tags.push("极端放量")
  // 强势 — sig-strong (change_5d >= 10)
  if (s.change5d >= 10) tags.push("强势")
  // 追高风险 — sig-risk (position_pct >= 90 && change_pct >= 7 或 change_pct >= 9)
  if ((s.positionPct >= 90 && s.changePct >= 7) || s.changePct >= 9) tags.push("追高风险")
  // RSI超卖
  if (s.rsi > 0 && s.rsi < 30) tags.push("RSI超卖")
  // RSI偏高
  if (s.rsi > 70) tags.push("RSI偏高")
  // PE低估
  if (s.pe > 0 && s.pe < 15) tags.push("PE低估")
  // ROE优秀
  if (s.roe > 15) tags.push("ROE优秀")
  return tags
}

exports.main = async function(event, context) {
  var action = event.action
  var data = event.data || {}
  try {
    switch (action) {
      case "run":
        var result = await runStrongPicker(data.topN || 20, data.force || false)
        return { success: true, data: result.stocks, marketEnv: result.marketEnv, cached: result.cached || false }
      case "list":
        var today = todayStr()
        var cached = await db.collection("pick_cache").where({ type: "strong", date: today }).orderBy("cachedAt", "desc").limit(1).get()
        if (cached.data.length > 0) return { success: true, data: cached.data[0].stocks, cached: true, marketEnv: cached.data[0].marketEnv }
        return { success: true, data: [], cached: false }
      default:
        return { success: false, error: "未知操作" }
    }
  } catch (err) {
    console.error("strongPicker error:", err)
    return { success: false, error: err.message }
  }
}

