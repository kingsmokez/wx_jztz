/**
 * 短线强势股选股 V32b - 基于回测最优策略V32b_75_25
 * 核心: V31评分×0.75 + V10评分×0.25 + ADX/VP/BOLL过滤
 * V31五维度: 资金活跃度(30)+趋势确认(25)+量价配合(20)+形态信号(15)+位置安全(10)
 * 回测2年数据全面超越V10基准(5dWR+2.11%, 10dWR+1.90%, 10dAR+0.25%)
 * 优化：涨幅榜Top300+换手率榜Top300合并，先粗评分取Top80再获取K线
 */
var cloud = require("wx-server-sdk")
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
var db = cloud.database()
var _ = db.command
var http = require("./http")
var _eval = require("./evaluate"); var evaluateStock = _eval.evaluateStock; var calculateBuySell = _eval.calculateBuySell; var industryConcentrationLimit = _eval.industryConcentrationLimit

function todayStr() { var d = new Date(Date.now() + 8 * 3600 * 1000); return d.toISOString().slice(0, 10) }
function getLimitPct(code) { return (code.startsWith("300") || code.startsWith("301") || code.startsWith("688")) ? 19.5 : 9.5 }

function checkPullbackStable(maSignal, low, price, high, changePct) {
  if (maSignal !== "bull" || !price || price <= 0) return false
  return (low < price && (price - low) > (high - price)) && changePct > 0
}

function calcVolumeRatioFallback(turnover) {
  if (turnover <= 0) return 0
  if (turnover < 0.5) return Math.round(turnover * 0.6 * 100) / 100
  if (turnover < 2) return Math.round((0.5 + turnover * 0.35) * 100) / 100
  if (turnover < 5) return Math.round((1.0 + (turnover - 2) * 0.5) * 100) / 100
  return Math.round((2.5 + (turnover - 5) * 0.5) * 100) / 100
}

function calcTechScore(stock, rsi, goldenCross, volumeRatio, bollPosition, code, isAfterHours, change5d) {
  var score = 0
  var chg = stock.changePct || 0
  var isGem = code.startsWith("300") || code.startsWith("301") || code.startsWith("688")
  if (isGem) {
    if (chg >= 2 && chg <= 4) score += 25; else if (chg > 4 && chg <= 6) score += 22
    else if (chg > 6 && chg <= 10) score += 20; else if (chg > 10 && chg <= 15) score += 15
    else if (chg > 15 && chg <= 19) score += 8; else if (chg >= 1 && chg < 2) score += 18
    else if (chg >= 0 && chg < 1) score += 10; else if (chg < 0) score += Math.max(0, 5 + chg)
  } else {
    if (chg >= 2 && chg <= 4) score += 25; else if (chg > 4 && chg <= 6) score += 22
    else if (chg >= 1 && chg < 2) score += 18; else if (chg >= 0 && chg < 1) score += 10
    else if (chg > 6 && chg <= 8) score += 15; else if (chg < 0) score += Math.max(0, 5 + chg)
  }
  if (isAfterHours && volumeRatio < 0.5) {
    score += 10
    if (change5d >= 10) score += 8; else if (change5d >= 5) score += 5; else if (change5d >= 3) score += 2
  } else if (volumeRatio >= 1.5 && volumeRatio <= 3) score += 20
  else if (volumeRatio >= 1.0 && volumeRatio < 1.5) score += 12
  else if (volumeRatio > 3 && volumeRatio <= 5) score += 15
  else if (volumeRatio >= 0.5 && volumeRatio < 1.0) score += 5
  else if (volumeRatio > 5) score += 8
  var techScore = 0
  if (rsi >= 50 && rsi <= 65) techScore += 10; else if (rsi >= 40 && rsi < 50) techScore += 6; else if (rsi > 65 && rsi <= 75) techScore += 5
  if (goldenCross) techScore += 8
  if (bollPosition >= 0.7) techScore += 4; else if (bollPosition >= 0.5 && bollPosition < 0.7) techScore += 7
  if (change5d >= 15) techScore += 5; else if (change5d >= 10) techScore += 4; else if (change5d >= 5) techScore += 2
  score += Math.min(25, techScore)
  var fundamental = 0
  if ((stock.roe || 0) >= 15) fundamental += 8; else if ((stock.roe || 0) >= 10) fundamental += 5; else if ((stock.roe || 0) >= 5) fundamental += 2
  if ((stock.grossMargin || 0) >= 30) fundamental += 4; else if ((stock.grossMargin || 0) >= 20) fundamental += 2
  if (stock.pe > 0 && stock.pe <= 20) fundamental += 6; else if (stock.pe > 20 && stock.pe <= 35) fundamental += 3
  if ((stock.debtRatio || 0) > 0 && stock.debtRatio <= 50) fundamental += 4; else if ((stock.debtRatio || 0) > 50 && stock.debtRatio <= 70) fundamental += 2
  score += fundamental
  return Math.round(Math.min(100, Math.max(0, score)))
}


/**
 * 温和因子评分 (V28b4回测最优策略)
 * 思路: 不追高热门股，偏好涨幅温和(1-3%)、量比温和(1-2)、RSI适中(40-60)的股票
 * 这类股票上涨空间更大，胜率更高
 * @returns {number} 0-100分的温和因子评分
 */
function calcMildScore(stock, volumeRatio, rsi) {
  var chg = stock.changePct || 0
  var mildScore = 0
  // 涨幅温和度 (0-40分): 1-3%最优，3-5%次优(35分)
  if (chg >= 1 && chg < 3) mildScore += 40
  else if (chg >= 0.5 && chg < 1) mildScore += 25
  else if (chg >= 3 && chg < 5) mildScore += 35
  else if (chg >= 5 && chg < 7) mildScore += 15
  else if (chg >= 7) mildScore += 5
  else mildScore += 10
  // 量比温和度 (0-40分): 1-2最优
  if (volumeRatio >= 1 && volumeRatio < 2) mildScore += 40
  else if (volumeRatio >= 0.7 && volumeRatio < 1) mildScore += 25
  else if (volumeRatio >= 2 && volumeRatio < 3) mildScore += 30
  else if (volumeRatio >= 3 && volumeRatio < 5) mildScore += 15
  else if (volumeRatio >= 5) mildScore += 5
  else mildScore += 10
  // RSI温和度 (0-20分): 40-60最优
  if (rsi >= 40 && rsi < 60) mildScore += 20
  else if (rsi >= 30 && rsi < 40) mildScore += 15
  else if (rsi >= 60 && rsi < 70) mildScore += 10
  else if (rsi >= 70) mildScore += 3
  else mildScore += 8
  return mildScore
}

/**
 * V31五维度评分 (回测V32b最优策略核心)
 * 5维度: 资金活跃度(30) + 趋势确认度(25) + 量价配合度(20) + 形态信号(15) + 位置安全度(10)
 * 回测2年: 5dWR+2.11%, 10dWR+1.90%, 10dAR+0.25% 全面超越V10基准
 */
function calcTechScoreV31(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData) {
  var score = 0
  var chg = stock.changePct || 0
  var isGem = code.startsWith("300") || code.startsWith("301") || code.startsWith("688")
  var maSignal = techData ? (techData.maSignal || "neutral") : "neutral"
  var macdObj = techData ? (techData.macdObj || {}) : {}
  var price = stock.price || 0
  var turnover = stock.turnover || 0
  var amount = stock.amount || 0

  // ====== 1. 资金活跃度 (0-30) ======
  var capitalScore = 0
  if (volumeRatio >= 1.5 && volumeRatio <= 2.5) capitalScore += 15
  else if (volumeRatio >= 1.0 && volumeRatio < 1.5) capitalScore += 10
  else if (volumeRatio > 2.5 && volumeRatio <= 4) capitalScore += 8
  else if (volumeRatio > 4 && volumeRatio <= 6) capitalScore += 4
  else if (volumeRatio > 6) capitalScore += 1
  if (turnover >= 3 && turnover <= 8) capitalScore += 10
  else if (turnover >= 1.5 && turnover < 3) capitalScore += 6
  else if (turnover > 8 && turnover <= 15) capitalScore += 5
  else if (turnover >= 0.5 && turnover < 1.5) capitalScore += 3
  else if (turnover > 15) capitalScore += 1
  if (amount >= 500000000) capitalScore += 5
  else if (amount >= 200000000) capitalScore += 4
  else if (amount >= 100000000) capitalScore += 3
  else if (amount >= 50000000) capitalScore += 2
  score += Math.min(30, capitalScore)

  // ====== 2. 趋势确认度 (0-25) ======
  var trendScore = 0
  if (maSignal === "bull") trendScore += 8
  else if (techData && techData.ma5 > 0 && techData.ma10 > 0) {
    if (price > techData.ma5 && price > techData.ma10) trendScore += 4
    else if (price > techData.ma5 || price > techData.ma10) trendScore += 2
  }
  if (goldenCross) trendScore += 7
  else if (macdObj.dif > 0 && macdObj.dea > 0 && macdObj.macd > 0) trendScore += 4
  else if (macdObj.dif > 0 && macdObj.dea > 0) trendScore += 2
  if (techData && techData.adx !== undefined) {
    if (techData.adx >= 25 && techData.plusDI > techData.minusDI) trendScore += 5
    else if (techData.adx >= 20 && techData.plusDI > techData.minusDI) trendScore += 3
  }
  if (change5d >= 5 && change5d <= 15) trendScore += 5
  else if (change5d >= 3 && change5d < 5) trendScore += 3
  else if (change5d >= 1 && change5d < 3) trendScore += 1
  score += Math.min(25, trendScore)

  // ====== 3. 量价配合度 (0-20) ======
  var vpScore = 0
  if (techData && techData.vpCoord) {
    var vp = techData.vpCoord
    if (vp.trend === "bullish") vpScore += 12
    else if (vp.trend === "neutral") vpScore += 6
    else if (vp.trend === "bearish_divergence") vpScore += 1
    if (vp.score >= 70) vpScore += 8
    else if (vp.score >= 50) vpScore += 4
  } else {
    if (techData && techData.obvTrend === 1) vpScore += 10
    else if (techData && techData.obvSlope5 > 0) vpScore += 6
  }
  score += Math.min(20, vpScore)

  // ====== 4. 形态信号 (0-15) ======
  var patternScore = 0
  if (techData) {
    if (techData.consolidationBreakout) {
      if (techData.consolidationBreakout.score >= 70) patternScore += 6
      else if (techData.consolidationBreakout.score >= 50) patternScore += 4
    }
    if (techData.trendAccel) {
      if (techData.trendAccel.accelerating) patternScore += 4
      else if (techData.trendAccel.score >= 30) patternScore += 2
    }
    if (techData.candlePatterns) {
      patternScore += Math.min(5, Math.floor(techData.candlePatterns.score / 6))
    }
    if (techData.patterns) {
      if (techData.patterns.breakout >= 4) patternScore += 2
      else if (techData.patterns.maSupport >= 3) patternScore += 2
    }
  }
  score += Math.min(15, patternScore)

  // ====== 5. 位置安全度 (0-10) ======
  var safetyScore = 0
  if (isGem) {
    if (chg >= 1.5 && chg <= 5) safetyScore += 4
    else if (chg >= 1 && chg < 1.5) safetyScore += 3
    else if (chg > 5 && chg <= 8) safetyScore += 2
    else if (chg > 8) safetyScore += 0
    else if (chg >= 0 && chg < 1) safetyScore += 1
  } else {
    if (chg >= 1.5 && chg <= 4) safetyScore += 4
    else if (chg >= 1 && chg < 1.5) safetyScore += 3
    else if (chg > 4 && chg <= 6) safetyScore += 2
    else if (chg > 6) safetyScore += 0
    else if (chg >= 0 && chg < 1) safetyScore += 1
  }
  if (rsi >= 45 && rsi <= 65) safetyScore += 3
  else if (rsi >= 35 && rsi < 45) safetyScore += 2
  else if (rsi > 65 && rsi <= 75) safetyScore += 1
  if (bollPosition >= 0.3 && bollPosition < 0.7) safetyScore += 3
  else if (bollPosition >= 0.5 && bollPosition < 0.8) safetyScore += 2
  else if (bollPosition >= 0.1 && bollPosition < 0.3) safetyScore += 1
  score += Math.min(10, safetyScore)

  return Math.round(Math.min(100, Math.max(0, score)))
}


function genReasons(stock, v5Reasons, goldenCross, volumeRatio, rsi, pullbackStable, pe, roe) {
  var parts = []
  if (v5Reasons) parts.push(v5Reasons)
  if (goldenCross) parts.push("金叉")
  if (volumeRatio > 2.0) parts.push("量比" + volumeRatio.toFixed(1) + "倍")
  else if (volumeRatio > 1.5) parts.push("量比" + volumeRatio.toFixed(1) + "倍")
  if (pullbackStable) parts.push("回调企稳")
  if (rsi > 0 && rsi < 30) parts.push("RSI超卖")
  else if (rsi > 70) parts.push("RSI偏高")
  if (pe > 0 && pe < 15) parts.push("PE低估")
  if (roe > 15) parts.push("ROE优秀")
  return parts.length > 0 ? parts.join(" | ") : ""
}

function buildSignalTags(s) {
  var tags = []
  if (s.pullbackStable) tags.push("回调企稳")
  if (s.breakthroughPct >= 0) tags.push("突破")
  if (s.goldenCross) tags.push("金叉")
  if (s.gentleVolume) tags.push("温和放量")
  if (s.moderateVolume) tags.push("明显放量")
  if (s.extremeVolume) tags.push("极端放量")
  if (s.change5d >= 10) tags.push("强势")
  if ((s.positionPct >= 90 && s.changePct >= 7) || s.changePct >= 9) tags.push("追高风险")
  if (s.rsi > 0 && s.rsi < 30) tags.push("RSI超卖")
  if (s.rsi > 70) tags.push("RSI偏高")
  if (s.mildScore >= 80) tags.push("温和优选")
  else if (s.mildScore >= 60) tags.push("趋势温和")
  if (s.pe > 0 && s.pe < 15) tags.push("PE低估")
  if (s.roe > 15) tags.push("ROE优秀")
  return tags
}

function quickScore(stock) {
  var score = 0
  var chg = stock.changePct || 0
  var vr = stock.volumeRatio || 0
  var to = stock.turnover || 0
  if (chg >= 2 && chg <= 6) score += 30; else if (chg >= 1 && chg < 2) score += 20; else if (chg >= 0 && chg < 1) score += 10
  if (vr >= 1.5 && vr <= 3) score += 25; else if (vr >= 1 && vr < 1.5) score += 15; else if (vr > 3) score += 15
  if (to >= 1 && to <= 8) score += 20; else if (to >= 0.5 && to < 1) score += 10
  if (stock.pe > 0 && stock.pe <= 30) score += 10; else if (stock.pe > 30 && stock.pe <= 50) score += 5
  if ((stock.circCap || 0) >= 20 && (stock.circCap || 0) <= 200) score += 15
  return score
}

async function runStrongPicker(topN, force) {
  if (!topN) topN = 20
  var today = todayStr()

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

  console.log("获取候选股票...")
  var startTime = Date.now()

  // 优化：只获取涨幅榜Top300 + 换手率榜Top300，不再全量获取6000只
  var changeStocks = await http.fetchStockList("f3", 300)
  var turnoverStocks = await http.fetchStockList("f8", 300)

  // 合并去重
  var allStocks = {}
  var codes1 = Object.keys(changeStocks)
  var codes2 = Object.keys(turnoverStocks)
  for (var i = 0; i < codes1.length; i++) allStocks[codes1[i]] = changeStocks[codes1[i]]
  for (var i = 0; i < codes2.length; i++) {
    if (!allStocks[codes2[i]]) allStocks[codes2[i]] = turnoverStocks[codes2[i]]
    else {
      var ts = turnoverStocks[codes2[i]]
      if (ts.turnover > 0 && (!allStocks[codes2[i]].turnover || allStocks[codes2[i]].turnover === 0)) allStocks[codes2[i]].turnover = ts.turnover
      if (ts.volumeRatio > 0 && (!allStocks[codes2[i]].volumeRatio || allStocks[codes2[i]].volumeRatio === 0)) allStocks[codes2[i]].volumeRatio = ts.volumeRatio
    }
  }
  var codes = Object.keys(allStocks)
  console.log("候选股票: " + codes.length + " 只, 耗时 " + (Date.now() - startTime) + "ms")

  // 粗筛选
  var candidates = []
  for (var i = 0; i < codes.length; i++) {
    var stock = allStocks[codes[i]]
    if (!stock || !stock.name || stock.name.indexOf("ST") >= 0 || stock.name.indexOf("退") >= 0) continue
    if (stock.price <= 3 || stock.changePct <= 0) continue
    if (stock.turnover < 0.5 && stock.volumeRatio < 0.8) continue
    if (stock.circCap > 0 && stock.circCap < 20) continue
    if (stock.code.startsWith("8") || stock.code.startsWith("4") || stock.code.startsWith("920")) continue
    var qs = quickScore(stock)
    if (qs >= 25) candidates.push({ stock: stock, quickScore: qs })
  }
  candidates.sort(function(a, b) { return b.quickScore - a.quickScore })
  candidates = candidates.slice(0, 80)
  console.log("粗筛候选: " + candidates.length + " 只")

  // 只对Top80获取K线
  var klineCodes = candidates.map(function(c) { return c.stock.code })
  var klinesMap = {}
  startTime = Date.now()
  try {
    klinesMap = await http.fetchKlinesConcurrent(klineCodes, 30)
    console.log("K线获取: " + Object.keys(klinesMap).length + " 只, 耗时 " + (Date.now() - startTime) + "ms")
  } catch(e) { console.warn("K线获取失败:", e.message) }

  // 腾讯补全ROE等
  var tencentData = {}
  startTime = Date.now()
  try {
    tencentData = await http.fetchTencentBatch(klineCodes, 80)
    console.log("腾讯补全: " + Object.keys(tencentData).length + " 只, 耗时 " + (Date.now() - startTime) + "ms")
  } catch(e) { console.warn("腾讯补全失败:", e.message) }

  // 批量获取行业板块
  var industryMap = {}
  startTime = Date.now()
  try {
    industryMap = await http.fetchIndustryBatch(klineCodes)
    console.log("行业获取: " + Object.keys(industryMap).length + " 只, 耗时 " + (Date.now() - startTime) + "ms")
  } catch(e) { console.warn("行业获取失败:", e.message) }

  var now = new Date(Date.now() + 8 * 3600 * 1000)
  var isAfterHours = now.getHours() >= 15
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
    var change5d = tech ? tech.momentum5d : 0

    var volumeRatio = stock.volumeRatio || 0
    if (volumeRatio <= 0.5) volumeRatio = calcVolumeRatioFallback(stock.turnover || 0)

    var techScore = calcTechScore(stock, rsi, goldenCross, volumeRatio, bollPosition, stock.code, isAfterHours, change5d)

    var v5Score = 50
    var v5Reasons = ""
    try {
      var er = evaluateStock({
        code: stock.code, name: stock.name, price: stock.price,
        pe: stock.pe || 0, pb: stock.pb || 0, roe: stock.roe || 0,
        marketCap: stock.circCap || 0,
        turnover: stock.turnover || 0, volumeRatio: volumeRatio,
        amount: stock.amount || 0, changePct: stock.changePct || 0,
        grossMargin: stock.grossMargin || 0, debtRatio: stock.debtRatio || 0,
      }, { rsi: rsi, macdSignal: tech ? tech.macd : 0, maSignal: maSignal })
      if (er) { v5Score = er.v5Score || 50; v5Reasons = (er.v5Reasons || []).join(" | ") }
    } catch(e) {}

    var blendedScore = Math.round(techScore * 0.6 + v5Score * 0.4)
    if (blendedScore < 30) continue

    // V28b4最优策略: 温和因子加权排名
    var mildScore = calcMildScore(stock, volumeRatio, rsi)
// V32b: V31评分×0.75 + V10评分×0.25 + ADX/VP/BOLL过滤
    var v31Score = calcTechScoreV31(stock, rsi, goldenCross, volumeRatio, bollPosition, stock.code, change5d, tech)
    var v10Score = blendedScore
    var rankingScore = v31Score * 0.75 + v10Score * 0.25
    // ADX过滤: ADX>=20且+DI>-DI
    var adxFiltered = false
    if (tech && tech.adx !== undefined && (tech.adx < 20 || tech.plusDI <= tech.minusDI)) adxFiltered = true
    // 量价背离过滤
    var vpFiltered = false
    if (tech && tech.vpCoord && tech.vpCoord.trend === "bearish_divergence") vpFiltered = true
    // BOLL位置过滤: bollPosition>0.85
    var bollFiltered = false
    if (bollPosition > 0.85) bollFiltered = true
    // 过滤标记(不直接排除，降低评分)
    if (adxFiltered) rankingScore *= 0.7
    if (vpFiltered) rankingScore *= 0.6
    if (bollFiltered) rankingScore *= 0.8
    rankingScore = Math.round(rankingScore)

    var pullbackStable = checkPullbackStable(maSignal, stock.low || 0, stock.price, stock.high || 0, stock.changePct || 0)
    var hasLimitUp = (stock.changePct || 0) >= getLimitPct(stock.code)
    var gentleVolume = volumeRatio >= 1.0 && volumeRatio <= 2.0
    var moderateVolume = volumeRatio > 2.0 && volumeRatio <= 4.0
    var extremeVolume = volumeRatio > 4.0

    var positionPct = Math.round(bollPosition * 100)
    var breakthroughPct = -1
    if (tech && tech.ma20 && stock.price > 0) breakthroughPct = Math.round((stock.price / tech.ma20 - 1) * 100)
    var turnover = stock.turnover || 0
    var roe = stock.roe || 0

    var reasons = genReasons(stock, v5Reasons, goldenCross, volumeRatio, rsi, pullbackStable, stock.pe, roe)

    var buySell = null
    try {
      buySell = calculateBuySell({
        code: stock.code, name: stock.name, price: stock.price,
        pe: stock.pe || 0, pb: stock.pb || 0, roe: roe,
        marketCap: stock.circCap || 0,
        turnover: turnover, changePct: stock.changePct || 0,
      }, blendedScore, null)
    } catch(e) {}

    var industry = http.guessIndustry(stock.name, stock.code, stock.industry, industryMap[stock.code])

    results.push({
      code: stock.code, name: stock.name,
      price: Math.round(stock.price * 100) / 100,
      industry: industry,
      changePct: Math.round((stock.changePct || 0) * 100) / 100,
      change5d: Math.round(change5d * 100) / 100,
      marketCap: Math.round((stock.circCap || 0) * 100) / 100,
      score: blendedScore,
      totalScore: blendedScore,
      mildScore: mildScore,
      v31Score: v31Score || 0,
      rankingScore: rankingScore,
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
      signals: buildSignalTags({
        goldenCross: goldenCross, pullbackStable: pullbackStable,
        gentleVolume: gentleVolume, moderateVolume: moderateVolume, extremeVolume: extremeVolume,
        breakthroughPct: breakthroughPct, change5d: change5d, positionPct: positionPct,
        changePct: stock.changePct || 0, rsi: rsi, pe: stock.pe || 0, roe: roe,
        mildScore: mildScore,
      }),
    })
  }

  // V28b4: 用rankingScore排序(温和因子加权)，score保留展示用
  results.sort(function(a, b) { return b.rankingScore - a.rankingScore })

  var finalResults
  try {
    var limited = industryConcentrationLimit(results, 2, Math.min(topN, results.length))
    finalResults = limited.slice(0, Math.min(topN, limited.length))
  } catch(e) { finalResults = results.slice(0, Math.min(topN, results.length)) }
  console.log("短线强势股选出: " + finalResults.length + " 只")

  try {
    var doc = { type: "strong", date: today, stocks: finalResults, marketEnv: marketEnv, cachedAt: Date.now() }
    var oldCache = await db.collection("pick_cache").where({ type: "strong", date: today }).orderBy("cachedAt", "desc").limit(1).get()
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

