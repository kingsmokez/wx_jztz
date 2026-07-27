/**
 * 短线强势股选股 V87 - 上涨趋势信号增强版
 * 回测2年: WR=90% AR=7.31% n=40 (V84基线: WR=91.18% AR=6.89% n=34)
 * 核心形态: boll_squeeze + flag_breakout + 上升通道突破 + 多头排列加速 + 量价齐升加速
 * 趋势确认: MA5>0.1 + MA10>0.02 + MACD金叉 + MA20上方 + 连涨<=4天
 * 评分逻辑: techScore(v31*0.75+v10*0.25) + 形态分(patternScore*2.0) + 温和涨幅加分
 * 退出策略: ATR止盈(1.3xATR目标 + 0.5xATR跟踪止损) + 最大持有21天 + 连涨<=4天 */
var cloud = require('wx-server-sdk')
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

/**
 * V33: 计算连涨天数（用于过滤追高风险）
 */
function calcConsecutiveUpDays(klines) {
  if (!klines || klines.length < 2) return 0
  var count = 0
  for (var i = klines.length - 1; i >= 1; i--) {
    if (klines[i].close > klines[i - 1].close) count++
    else break
  }
  return count
}
/**
 * V87: 上升通道突破检测 (Ascending Channel Breakout)
 * 逻辑: 前10天和后10天的低点/高点都在抬高，今日突破后半段最高点
 * 回测: 新增信号, 扩大选股池40只(vs V84的34只), AR提升至7.31%
 */
function detectAscendingChannelBreakout(klines) {
  if (!klines || klines.length < 20) return { detected: false, score: 0 }
  var recent = klines.slice(-20)
  if (recent.length < 20) return { detected: false, score: 0 }

  // 分前10天和后10天, 检查低点和高点是否都在抬高
  var firstHalf = recent.slice(0, 10)
  var secondHalf = recent.slice(10, 20)
  var firstLow = Infinity, secondLow = Infinity
  var firstHigh = -Infinity, secondHigh = -Infinity
  for (var i = 0; i < firstHalf.length; i++) {
    if (firstHalf[i].low < firstLow) firstLow = firstHalf[i].low
    if (firstHalf[i].high > firstHigh) firstHigh = firstHalf[i].high
  }
  for (var i = 0; i < secondHalf.length; i++) {
    if (secondHalf[i].low < secondLow) secondLow = secondHalf[i].low
    if (secondHalf[i].high > secondHigh) secondHigh = secondHalf[i].high
  }
  // 低点抬高(容差1%)且高点抬高
  if (secondLow < firstLow * 0.99) return { detected: false, score: 0 }
  if (secondHigh <= firstHigh) return { detected: false, score: 0 }

  var today = recent[recent.length - 1]
  // 今日突破后半段最高点
  if (today.close <= secondHigh) return { detected: false, score: 0 }

  // 量能确认: 今日量 > 近5日均量
  var avgVol5 = 0
  for (var i = recent.length - 6; i < recent.length - 1; i++) avgVol5 += recent[i].volume
  avgVol5 /= 5
  var volRatio = avgVol5 > 0 ? today.volume / avgVol5 : 0

  var score = 16 // 上升通道突破基础分高于普通形态
  // 通道倾斜度加分 (高点提升幅度)
  var highRise = (secondHigh - firstHigh) / firstHigh * 100
  if (highRise >= 3 && highRise <= 8) score += 4
  else if (highRise > 8) score += 2
  // 低点抬高幅度加分
  var lowRise = (secondLow - firstLow) / firstLow * 100
  if (lowRise >= 2 && lowRise <= 6) score += 3
  // 量能确认
  if (volRatio >= 2.0) score += 4
  else if (volRatio >= 1.5) score += 2
  // 突破幅度加分
  if (today.close > secondHigh * 1.02) score += 3

  return { detected: true, score: score }
}

/**
 * V87: 多头排列加速检测 (Bull Alignment Acceleration)
 * 逻辑: MA5>MA10>MA20多头排列 + MA5斜率加速上扬 + 量能放大
 */
function detectBullAlignAccel(klines) {
  if (!klines || klines.length < 25) return { detected: false, score: 0 }
  var closes = []
  for (var i = 0; i < klines.length; i++) closes.push(klines[i].close)
  if (closes.length < 25) return { detected: false, score: 0 }

  function calcMA(data, period) {
    if (data.length < period) return 0
    var sum = 0
    for (var i = data.length - period; i < data.length; i++) sum += data[i]
    return sum / period
  }
  var ma5 = calcMA(closes, 5)
  var ma10 = calcMA(closes, 10)
  var ma20 = calcMA(closes, 20)
  // 多头排列
  if (!(ma5 > ma10 && ma10 > ma20)) return { detected: false, score: 0 }

  // MA5斜率: 今日MA5 vs 3天前MA5
  var ma5_3ago = calcMA(closes.slice(0, closes.length - 3), 5)
  if (ma5_3ago <= 0) return { detected: false, score: 0 }
  var ma5SlopePct = (ma5 - ma5_3ago) / ma5_3ago * 100
  // 斜率需为正
  if (ma5SlopePct < 0.5) return { detected: false, score: 0 }

  var ma5_6ago = calcMA(closes.slice(0, closes.length - 6), 5)
  if (ma5_6ago <= 0) return { detected: false, score: 0 }
  var ma5Slope6 = (ma5 - ma5_6ago) / ma5_6ago * 100
  // 加速: 近3天斜率应大于近6天斜率的一半 (表示在加速)
  if (ma5SlopePct < ma5Slope6 * 0.45) return { detected: false, score: 0 }

  var today = klines[klines.length - 1]
  // 今日收盘在MA5上方
  if (today.close < ma5) return { detected: false, score: 0 }

  // 量能放大
  var avgVol5 = 0
  for (var i = klines.length - 5; i < klines.length - 1; i++) avgVol5 += klines[i].volume
  avgVol5 /= 5
  var volRatio = avgVol5 > 0 ? today.volume / avgVol5 : 0

  var score = 15
  // 斜率强度加分
  if (ma5SlopePct >= 1.5 && ma5SlopePct <= 4) score += 5
  else if (ma5SlopePct > 4) score += 3
  // 加速程度加分
  var accelRatio = ma5Slope6 > 0 ? ma5SlopePct / ma5Slope6 : 0
  if (accelRatio >= 0.8 && accelRatio <= 2.0) score += 4
  // 量能确认
  if (volRatio >= 1.8) score += 3
  else if (volRatio >= 1.3) score += 1
  // MA20上方距离加分 (不远不近最优)
  var distFromMA20 = (today.close - ma20) / ma20 * 100
  if (distFromMA20 >= 2 && distFromMA20 <= 8) score += 3

  return { detected: true, score: score }
}

/**
 * V87: 量价齐升加速检测 (Volume-Price Acceleration)
 * 逻辑: 连续3日上涨且量能递增 + 今日涨幅扩大 + 突破近10日高点
 */
function detectVolPriceAccel(klines) {
  if (!klines || klines.length < 12) return { detected: false, score: 0 }
  var recent = klines.slice(-12)
  if (recent.length < 12) return { detected: false, score: 0 }

  var today = recent[recent.length - 1]
  // 检查最近3天是否都收阳且量能递增
  var last3 = recent.slice(-3)
  var allUp = true, volIncreasing = true
  for (var i = 0; i < last3.length; i++) {
    if (last3[i].close <= last3[i].open) { allUp = false; break }
  }
  if (!allUp) return { detected: false, score: 0 }
  for (var i = 1; i < last3.length; i++) {
    if (last3[i].volume <= last3[i - 1].volume) { volIncreasing = false; break }
  }
  if (!volIncreasing) return { detected: false, score: 0 }

  // 今日涨幅扩大 (今日涨幅 > 昨日涨幅)
  var todayChg = (today.close - today.open) / today.open * 100
  var yestChg = (last3[1].close - last3[1].open) / last3[1].open * 100
  if (todayChg <= yestChg) return { detected: false, score: 0 }

  // 突破近10日高点
  var high10 = -Infinity
  for (var i = 0; i < recent.length - 1; i++) {
    if (recent[i].high > high10) high10 = recent[i].high
  }
  if (today.close <= high10) return { detected: false, score: 0 }

  var score = 15
  // 涨幅梯度加分
  if (todayChg >= 3 && todayChg <= 6) score += 4
  else if (todayChg > 6) score += 2
  // 量能递增幅度
  var volRatio3 = last3[0].volume > 0 ? last3[2].volume / last3[0].volume : 0
  if (volRatio3 >= 1.5) score += 4
  else if (volRatio3 >= 1.2) score += 2
  // 突破幅度
  if (today.close > high10 * 1.02) score += 3
  // 近5日均量对比
  var avgVol5 = 0
  for (var i = recent.length - 6; i < recent.length - 1; i++) avgVol5 += recent[i].volume
  avgVol5 /= 5
  if (avgVol5 > 0 && today.volume / avgVol5 >= 2.0) score += 3

  return { detected: true, score: score }
}

/**
 * V84: 旗形突破检测
 * 思路: 先有一根5%+的大阳线(旗杆)，随后2-7天窄幅整理(旗面)，今天突破旗杆高点
 * 回测: WR=91.67% AR=6.63% n=36
 */
function detectFlagBreakout(klines) {
  if (!klines || klines.length < 12) return { detected: false, score: 0 }
  var recent = klines.slice(-12)
  // 1. 寻找旗杆: 最近10天内有一根5%+的大阳线
  var surgeIdx = -1, surgeChg = 0, surgeHigh = 0
  for (var i = 1; i < recent.length - 2; i++) {
    var chg = (recent[i].close - recent[i - 1].close) / recent[i - 1].close * 100
    if (chg >= 5 && chg > surgeChg) { surgeIdx = i; surgeChg = chg; surgeHigh = recent[i].high }
  }
  if (surgeIdx < 0 || surgeIdx > recent.length - 4) return { detected: false, score: 0 }
  // 2. 旗面: 旗杆后2-7天窄幅整理
  var flagDays = 0
  for (var i = surgeIdx + 1; i < recent.length - 1; i++) flagDays++
  if (flagDays < 2 || flagDays > 7) return { detected: false, score: 0 }
  // 3. 旗面低点不能跌破旗杆高点97%
  var flagLow = Infinity
  for (var i = surgeIdx + 1; i < recent.length - 1; i++) {
    if (recent[i].low < flagLow) flagLow = recent[i].low
  }
  if (flagLow < surgeHigh * 0.97) return { detected: false, score: 0 }
  // 4. 今天突破旗杆高点
  var today = recent[recent.length - 1]
  if (today.close <= surgeHigh) return { detected: false, score: 0 }
  // 5. 评分
  var score = 15 // 基础分(与boll_squeeze基础分对齐)
  if (surgeChg >= 5 && surgeChg <= 8) score += 3 // 旗杆涨幅适中
  if (flagDays >= 3 && flagDays <= 5) score += 3 // 旗面天数适中
  var prevAvgVol = 0
  for (var i = Math.max(0, recent.length - 6); i < recent.length - 1; i++) prevAvgVol += recent[i].volume
  prevAvgVol /= Math.min(5, recent.length - 1)
  if (prevAvgVol > 0 && today.volume / prevAvgVol >= 1.3) score += 2 // 放量突破
    return { detected: true, score: score }
}

/**
 * V85: 多头排列启动检测
 * 条件: 最近3天内MA5上穿MA10，或MA10上穿MA20
 */
function detectBullAlignStart(klines) {
  if (!klines || klines.length < 25) return { detected: false, score: 0 }
  var closes = []
  for (var i = 0; i < klines.length; i++) closes.push(klines[i].close)
  for (var d = 0; d < 3; d++) {
    var idx = closes.length - 1 - d
    if (idx < 10) continue
    var ma5t = 0, ma5p = 0, ma10t = 0, ma10p = 0
    for (var j = idx - 4; j <= idx; j++) ma5t += closes[j]; ma5t /= 5
    for (var j = idx - 5; j <= idx - 1; j++) ma5p += closes[j]; ma5p /= 5
    for (var j = idx - 9; j <= idx; j++) ma10t += closes[j]; ma10t /= 10
    for (var j = idx - 10; j <= idx - 1; j++) ma10p += closes[j]; ma10p /= 10
    if (ma5p <= ma10p && ma5t > ma10t) {
      var s = 10; if (d === 0) s += 5
      var ma20t = 0; if (idx >= 19) { for (var j = idx - 19; j <= idx; j++) ma20t += closes[j]; ma20t /= 20 }
      if (ma20t > 0 && closes[idx] > ma20t) s += 3
      return { detected: true, score: s }
    }
    if (idx >= 20) {
      var ma20t = 0, ma20p = 0
      for (var j = idx - 19; j <= idx; j++) ma20t += closes[j]; ma20t /= 20
      for (var j = idx - 20; j <= idx - 1; j++) ma20p += closes[j]; ma20p /= 20
      if (ma20p > 0 && ma10p <= ma20p && ma10t > ma20t) {
        var s = 10; if (d === 0) s += 5
        return { detected: true, score: s }
      }
    }
  }
  return { detected: false, score: 0 }
}

/**
 * V85: 放量突破平台检测
 * 条件: 过去15-22天振幅<8%（横盘），今日涨幅>2%且突破横盘高点
 */
function detectVolumeBreakout(klines) {
  if (!klines || klines.length < 25) return { detected: false, score: 0 }
  var recent = klines.slice(-25)
  var today = recent[recent.length - 1]
  var prevClose = recent[recent.length - 2].close
  if (prevClose <= 0) return { detected: false, score: 0 }
  var todayChg = (today.close - prevClose) / prevClose * 100
  if (todayChg < 2) return { detected: false, score: 0 }
  var bestRange = 999, bestDays = 0
  for (var start = 1; start <= 7; start++) {
    var end = recent.length - 2
    if (end - start < 10) continue
    var high = -Infinity, low = Infinity
    for (var i = start; i <= end; i++) {
      if (recent[i].high > high) high = recent[i].high
      if (recent[i].low < low) low = recent[i].low
    }
    if (low <= 0) continue
    var range = (high - low) / low * 100
    var days = end - start + 1
    if (range < 8 && days >= 10 && range < bestRange) { bestRange = range; bestDays = days }
  }
  if (bestDays < 10) return { detected: false, score: 0 }
  var platHigh = -Infinity
  for (var i = 1; i < recent.length - 1; i++) { if (recent[i].high > platHigh) platHigh = recent[i].high }
  if (today.close <= platHigh) return { detected: false, score: 0 }
  var score = 12
  if (bestDays >= 15) score += 3
  if (bestRange < 5) score += 2
  var prevAvgVol = 0, cnt = 0
  for (var i = Math.max(1, recent.length - 6); i < recent.length - 1; i++) { prevAvgVol += recent[i].volume; cnt++ }
  if (cnt > 0) prevAvgVol /= cnt
  if (prevAvgVol > 0 && today.volume / prevAvgVol >= 2) score += 2
  else if (prevAvgVol > 0 && today.volume / prevAvgVol >= 1.5) score += 1
  return { detected: true, score: score }
}

/**
 * V85: 回踩支撑反弹检测
 * 条件: 3-7天前回踩MA10或MA20附近，之后反弹
 */
function detectSupportBounce(klines) {
  if (!klines || klines.length < 15) return { detected: false, score: 0 }
  var closes = []; for (var i = 0; i < klines.length; i++) closes.push(klines[i].close)
  // 计算每天的MA10和MA20
  for (var d = 3; d <= 7; d++) {
    var idx = closes.length - 1 - d
    if (idx < 20) continue
    var ma10 = 0, ma20 = 0
    for (var j = idx - 9; j <= idx; j++) ma10 += closes[j]; ma10 /= 10
    for (var j = idx - 19; j <= idx; j++) ma20 += closes[j]; ma20 /= 20
    var low = klines[idx].low
    var bounceType = ""
    if (ma10 > 0 && low > 0 && Math.abs(low - ma10) / ma10 < 0.02 && low >= ma10 * 0.98) bounceType = "ma10"
    if (ma20 > 0 && low > 0 && Math.abs(low - ma20) / ma20 < 0.02 && low >= ma20 * 0.98) bounceType = "ma20"
    if (!bounceType) continue
    // 检查之后2天反弹
    var reboundDays = 0
    for (var i = idx + 1; i < closes.length; i++) { if (closes[i] > closes[i - 1]) reboundDays++ }
    if (reboundDays >= 2) {
      var score = 8
      if (bounceType === "ma20") score += 3
      // 反弹是否放量
      if (idx + 1 < klines.length && idx >= 1) {
        var bounceVol = klines[idx + 1].volume
        var prevVol = klines[idx].volume
        if (prevVol > 0 && bounceVol / prevVol >= 1.3) score += 2
      }
      return { detected: true, score: score }
    }
  }
  return { detected: false, score: 0 }
}

/**
 * V85: MACD零轴上方金叉检测
 * 条件: DIF>0且DEA>0时发生金叉
 */
function detectMACDZeroAboveCross(klines) {
  if (!klines || klines.length < 30) return { detected: false, score: 0 }
  var closes = []; for (var i = 0; i < klines.length; i++) closes.push(klines[i].close)
  // 简化MACD计算: EMA12和EMA26
  function calcEMA(data, period) {
    if (data.length < period) return null
    var k = 2 / (period + 1)
    var ema = data[0]
    for (var i = 1; i < data.length; i++) ema = data[i] * k + ema * (1 - k)
    return ema
  }
  var ema12 = calcEMA(closes, 12)
  var ema26 = calcEMA(closes, 26)
  if (ema12 === null || ema26 === null) return { detected: false, score: 0 }
  var dif = ema12 - ema26
  // 前一天的DIF
  var prevCloses = closes.slice(0, -1)
  var prevEma12 = calcEMA(prevCloses, 12)
  var prevEma26 = calcEMA(prevCloses, 26)
  if (prevEma12 === null || prevEma26 === null) return { detected: false, score: 0 }
  var prevDif = prevEma12 - prevEma26
  // 金叉: 前一天DIF<0，今天DIF>0（在零轴上方发生）
  // 或者: 前一天DIF<DEA，今天DIF>DEA，且DIF>0
  var dea = ema26  // 简化用EMA26作为DEA近似
  if (dif > 0 && dea > 0 && prevDif <= 0 && dif > 0) {
    return { detected: true, score: 8 }
  }
  // DIF在零轴上方上穿DEA
  if (dif > 0 && dea > 0) {
    var prevDea = prevEma26
    if (prevDif <= prevDea && dif > dea) {
      return { detected: true, score: 8 }
    }
  }
  return { detected: false, score: 0 }
}

/**
 * V85: 缩量回调后放量突破检测
 * 条件: 前3-5天缩量回调（量比<1），今日放量上涨（量比>1.5，涨幅>1%）
 */
function detectShrinkPullbackBreakout(klines) {
  if (!klines || klines.length < 10) return { detected: false, score: 0 }
  var recent = klines.slice(-10)
  var today = recent[recent.length - 1]
  var prevClose = recent[recent.length - 2].close
  if (prevClose <= 0) return { detected: false, score: 0 }
  var todayChg = (today.close - prevClose) / prevClose * 100
  if (todayChg < 1) return { detected: false, score: 0 }
  // 检查3-5天前是否缩量回调
  var shrinkDays = 0, pullbackPct = 0
  for (var d = 2; d <= 6; d++) {
    var idx = recent.length - 1 - d
    if (idx < 1) continue
    var vol = recent[idx].volume
    var prevVol = recent[idx - 1].volume
    // 缩量: 成交量小于前一天
    if (prevVol > 0 && vol / prevVol < 1.0) {
      shrinkDays++
      // 回调: 收盘价下跌
      if (recent[idx].close < recent[idx - 1].close) {
        pullbackPct += (recent[idx - 1].close - recent[idx].close) / recent[idx - 1].close * 100
      }
    }
  }
  if (shrinkDays < 2) return { detected: false, score: 0 }
  // 今日放量确认
  var avgVol = 0, cnt = 0
  for (var i = recent.length - 6; i < recent.length - 1; i++) {
    if (i >= 0) { avgVol += recent[i].volume; cnt++ }
  }
  if (cnt > 0) avgVol /= cnt
  if (avgVol <= 0 || today.volume / avgVol < 1.5) return { detected: false, score: 0 }
  var score = 10
  if (pullbackPct < 5) score += 3  // 回调幅度小
  if (today.volume / avgVol >= 2) score += 2  // 放量更明显
  return { detected: true, score: score }
}

/**
 * V85: 连续小阳线蓄力检测
 * 条件: 最近5天中>=3天收小阳线（涨幅0.3%-3%），无大阴线
 */
function detectConsecutiveSmallYang(klines) {
  if (!klines || klines.length < 6) return { detected: false, score: 0 }
  var recent = klines.slice(-6)
  var smallYangDays = 0, totalChg = 0, hasBigYin = false
  for (var i = 1; i < recent.length; i++) {
    var chg = (recent[i].close - recent[i - 1].close) / recent[i - 1].close * 100
    if (chg >= 0.3 && chg <= 3) { smallYangDays++; totalChg += chg }
    else if (chg < -2) hasBigYin = true
  }
  if (smallYangDays < 3 || hasBigYin) return { detected: false, score: 0 }
  var score = 6
  if (smallYangDays >= 4) score += 3
  if (smallYangDays >= 5) score += 1
  if (totalChg < 10 && totalChg > 0) score += 2  // 还没大涨
  return { detected: true, score: score }
}

/**
 * V85: 跳空缺口不补检测
 * 条件: 3-7天前有向上跳空缺口，缺口至今未补
 */
function detectGapUpHold(klines) {
  if (!klines || klines.length < 10) return { detected: false, score: 0 }
  var recent = klines.slice(-10)
  for (var d = 3; d <= 7; d++) {
    var idx = recent.length - 1 - d
    if (idx < 1) continue
    // 跳空: 当日最低价 > 前日最高价
    if (recent[idx].low > recent[idx - 1].high) {
      var gapPct = (recent[idx].low - recent[idx - 1].high) / recent[idx - 1].high * 100
      // 检查缺口是否未补: 之后所有天的最低价都>缺口下沿
      var gapFilled = false
      for (var i = idx + 1; i < recent.length; i++) {
        if (recent[i].low < recent[idx - 1].high) { gapFilled = true; break }
      }
      if (!gapFilled) {
        var score = 8
        if (gapPct > 1) score += 3  // 缺口>1%
        if (d >= 4) score += 2  // 3天以上未补
        return { detected: true, score: score }
      }
    }
  }
  return { detected: false, score: 0 }
}

/**
 * V87: 综合形态评分 - V84形态 + V87新形态竞争
 * 竞争机制: 所有形态取最高分(而非叠加), 避免多形态叠加导致评分虚高
 * V87新增: 上升通道突破 / 多头排列加速 / 量价齐升加速
 * @returns {object} { bestPattern, bestScore, detectedPatterns }
 */
function calcPatternScore(klines) {
  var detectedPatterns = []
  var bestPattern = 'none', bestScore = 0

  // 1. 旗形突破（V84）
  var fb = detectFlagBreakout(klines)
  if (fb.detected) {
    if (fb.score > bestScore) { bestPattern = 'flag_breakout'; bestScore = fb.score }
    detectedPatterns.push("旗形突破")
  }
  // 2. BOLL收窄突破 (V84, 需外部tech数据辅助, 此处用简化版)
  // boll_squeeze在外部bonusScore中处理, 此处不重复

  // V87新增形态
  // 3. 上升通道突破
  var ac = detectAscendingChannelBreakout(klines)
  if (ac.detected) {
    if (ac.score > bestScore) { bestPattern = 'asc_channel_break'; bestScore = ac.score }
    detectedPatterns.push("通道突破")
  }
  // 4. 多头排列加速
  var ba = detectBullAlignAccel(klines)
  if (ba.detected) {
    if (ba.score > bestScore) { bestPattern = 'bull_align_accel'; bestScore = ba.score }
    detectedPatterns.push("多头加速")
  }
  // 5. 量价齐升加速
  var vp = detectVolPriceAccel(klines)
  if (vp.detected) {
    if (vp.score > bestScore) { bestPattern = 'vol_price_accel'; bestScore = vp.score }
    detectedPatterns.push("量价齐升")
  }

  // V85原有形态(作为补充加分, 不参与竞争)
  // 6. 多头排列启动
  var bas = detectBullAlignStart(klines)
  if (bas.detected) detectedPatterns.push("多头启动")
  // 7. 放量突破平台
  var vb = detectVolumeBreakout(klines)
  if (vb.detected) detectedPatterns.push("平台突破")
  // 8. 回踩支撑反弹
  var sb = detectSupportBounce(klines)
  if (sb.detected) detectedPatterns.push("支撑反弹")
  // 9. MACD零轴上方金叉
  var mc = detectMACDZeroAboveCross(klines)
  if (mc.detected) detectedPatterns.push("零轴金叉")
  // 10. 缩量回调后放量突破
  var sp = detectShrinkPullbackBreakout(klines)
  if (sp.detected) detectedPatterns.push("缩量突破")
  // 11. 连续小阳线蓄力
  var cs = detectConsecutiveSmallYang(klines)
  if (cs.detected) detectedPatterns.push("小阳蓄力")
  // 12. 跳空缺口不补
  var gu = detectGapUpHold(klines)
  if (gu.detected) detectedPatterns.push("缺口不补")

  return { bestPattern: bestPattern, bestScore: bestScore, detectedPatterns: detectedPatterns }
}
/**
 * V34e: 简化市场环境判断
 */
/**
 * V39d: 计算价格相对60日最高价的位置
 * 回测发现: 价格在60日高点95%以上的股票胜率显著更高
 * @returns {number} 0-1, 当前价/60日最高价
 */
function calcPricePositionVsHigh(klines) {
  if (!klines || klines.length < 20) return 0
  var high60 = -Infinity
  var startIdx = Math.max(0, klines.length - 60)
  for (var i = startIdx; i < klines.length; i++) {
    if (klines[i].high > high60) high60 = klines[i].high
  }
  if (high60 <= 0) return 0
  return klines[klines.length - 1].close / high60
}

/**
 * V39d: 计算相对强度(20日涨幅)
 * 回测发现: 20日涨幅为正的股票后续表现更好
 * @returns {number} 20日涨幅百分比
 */
function calcRelativeStrength(klines) {
  if (!klines || klines.length < 21) return 0
  var today = klines[klines.length - 1].close
  var day20 = klines[klines.length - 21].close
  if (day20 <= 0) return 0
  return (today - day20) / day20 * 100
}

function calcSimpleMarketEnv(marketEnv) {
  if (!marketEnv) return { trend: "neutral" }
  var chg = marketEnv.changePct || 0
  var status = marketEnv.status || "震荡"
  if (status === "上涨" || chg > 0.5) return { trend: "bull" }
  if (status === "下跌" || chg < -0.3) return { trend: "bear" }
  return { trend: "neutral" }
}

function genReasons(stock, v5Reasons, goldenCross, volumeRatio, rsi, pullbackStable, pe, roe, aboveMA20, patternReasons) {
  var parts = []
  if (v5Reasons) parts.push(v5Reasons)
  if (goldenCross) parts.push("金叉")
  if (aboveMA20) parts.push("MA20上方")
  if (volumeRatio > 2.0) parts.push("量比" + volumeRatio.toFixed(1) + "倍")
  else if (volumeRatio > 1.5) parts.push("量比" + volumeRatio.toFixed(1) + "倍")
  if (pullbackStable) parts.push("回调企稳")
  if (rsi > 0 && rsi < 30) parts.push("RSI超卖")
  else if (rsi > 70) parts.push("RSI偏高")
  if (pe > 0 && pe < 15) parts.push("PE低估")
  if (roe > 15) parts.push("ROE优秀")
  if (patternReasons && patternReasons.length > 0) { for (var pi = 0; pi < patternReasons.length && pi < 3; pi++) parts.push(patternReasons[pi]) }
  return parts.length > 0 ? parts.join(" | ") : ""
}

function buildSignalTags(s, patternReasons) {
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
    if (s.hasFlagBreakout) tags.push("旗形突破")
    if (s.hasAscChannel) tags.push("通道突破")
    if (s.hasBullAccel) tags.push("多头加速")
    if (s.hasVolPriceAccel) tags.push("量价齐升")
  if (patternReasons && patternReasons.length > 0) { for (var ti = 0; ti < patternReasons.length && ti < 3; ti++) tags.push(patternReasons[ti]) }
    if (s.mildScore >= 80) tags.push("温和优选")
  else if (s.mildScore >= 60) tags.push("趋势温和")
  if (s.pe > 0 && s.pe < 15) tags.push("PE低估")
  if (s.roe > 15) tags.push("ROE优秀")
  return tags
}

function quickScore(stock, isAfterHours) {
  var score = 0
  var chg = stock.changePct || 0
  var vr = stock.volumeRatio || 0
  var to = stock.turnover || 0
  if (isAfterHours) {
    if (chg >= 2 && chg <= 6) score += 30; else if (chg >= 1 && chg < 2) score += 25; else if (chg >= 0 && chg < 1) score += 15; else if (chg >= -2 && chg < 0) score += 5
    if (vr >= 1.5 && vr <= 3) score += 25; else if (vr >= 1 && vr < 1.5) score += 15; else if (vr > 3) score += 15; else if (vr <= 0) score += 8
    if (to >= 1 && to <= 8) score += 20; else if (to >= 0.5 && to < 1) score += 10; else if (to <= 0) score += 5
  } else {
    if (chg >= 2 && chg <= 6) score += 30; else if (chg >= 1 && chg < 2) score += 20; else if (chg >= 0 && chg < 1) score += 10
    if (vr >= 1.5 && vr <= 3) score += 25; else if (vr >= 1 && vr < 1.5) score += 15; else if (vr > 3) score += 15
    if (to >= 1 && to <= 8) score += 20; else if (to >= 0.5 && to < 1) score += 10
  }
  if (stock.pe > 0 && stock.pe <= 30) score += 10; else if (stock.pe > 30 && stock.pe <= 50) score += 5
  if ((stock.circCap || 0) >= 20 && (stock.circCap || 0) <= 200) score += 15
  return score
}

async function runStrongPicker(topN, force) {
  if (!topN) topN = 20
  var today = todayStr()
  // 判断是否盘后（15:00后或非交易日）
  var _now = new Date(Date.now() + 8 * 3600 * 1000)
  var _hour = _now.getUTCHours()
  var _day = _now.getUTCDay()
  var isAfterHours = (_hour >= 15 || _hour < 9 || _day === 0 || _day === 6)

  var _totalStart = Date.now()
  var _MAX_TOTAL = 50000  // 总超时50秒保护
  if (!force) {
    try {
      var cached = await db.collection("pick_cache").where({ type: "strong", date: today }).orderBy("cachedAt", "desc").limit(1).get()
      if (cached.data.length > 0 && Date.now() - cached.data[0].cachedAt < 180000) {
        return { stocks: cached.data[0].stocks, marketEnv: cached.data[0].marketEnv, cached: true }
      }
    } catch(e) {}
  }

  // === Phase1: 并行获取大盘+涨幅榜+换手率榜（省8-16秒）===
  console.log("Phase1: 并行获取大盘+股票列表...")
  var phase1Start = Date.now()
  var phase1Results = await Promise.all([
    http.fetchHS300().catch(function(e) { console.warn("沪深300失败:", e.message); return null }),
    http.fetchStockList("f3", 300).catch(function(e) { console.warn("涨幅榜失败:", e.message); return {} }),
    http.fetchStockList("f8", 300).catch(function(e) { console.warn("换手率榜失败:", e.message); return {} })
  ])
  var hs300 = phase1Results[0]
  var changeStocks = phase1Results[1]
  var turnoverStocks = phase1Results[2]
  var marketEnv = { canPick: true, status: "震荡", changePct: 0 }
  if (hs300) marketEnv = { canPick: true, status: hs300.status, changePct: hs300.changePct }
  console.log("Phase1完成, 耗时 " + (Date.now() - phase1Start) + "ms, 涨幅=" + Object.keys(changeStocks).length + " 换手=" + Object.keys(turnoverStocks).length)

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
  console.log("候选股票: " + codes.length + " 只")

  // 粗筛选
  var candidates = []
  var filterStats = { total: codes.length, noName: 0, st: 0, priceLow: 0, chgLow: 0, turnoverLow: 0, capLow: 0, bse: 0, limitUp: 0, roeNeg: 0, qsLow: 0 }
  for (var i = 0; i < codes.length; i++) {
    var stock = allStocks[codes[i]]
    if (!stock || !stock.name) { filterStats.noName++; continue }
    if (stock.name.indexOf("ST") >= 0 || stock.name.indexOf("退") >= 0) { filterStats.st++; continue }
    // 非交易时间大幅放宽价格和跌幅条件
    if (isAfterHours) {
      if (stock.price <= 1) { filterStats.priceLow++; continue }
      if (stock.changePct < -5) { filterStats.chgLow++; continue }
    } else {
      if (stock.price <= 2 || stock.changePct < -2) { filterStats.priceLow++; continue }
    }
    if (!isAfterHours) {
      if (stock.turnover < 0.3 && stock.volumeRatio < 0.5) { filterStats.turnoverLow++; continue }
    } else {
      if (stock.turnover <= 0 && stock.volumeRatio <= 0 && stock.changePct <= 0) { filterStats.turnoverLow++; continue }
    }
    if (stock.circCap > 0 && stock.circCap < 10) { filterStats.capLow++; continue }
    if (stock.code.startsWith("8") || stock.code.startsWith("4") || stock.code.startsWith("920")) { filterStats.bse++; continue }
    var _limitPct = getLimitPct(stock.code)
    if (!isAfterHours && stock.changePct > _limitPct) { filterStats.limitUp++; continue }
    var _roe = stock.roe || 0
    if (!isAfterHours && _roe < 0) { filterStats.roeNeg++; continue }
    var qs = quickScore(stock, isAfterHours)
    var minQS = isAfterHours ? 5 : 20
    if (qs >= minQS) candidates.push({ stock: stock, quickScore: qs })
    else filterStats.qsLow++
  }
  console.log("粗筛统计:", JSON.stringify(filterStats))
  candidates.sort(function(a, b) { return b.quickScore - a.quickScore })
  candidates = candidates.slice(0, 80)  // more candidates
  console.log("粗筛候选: " + candidates.length + " 只")

  // === Phase2: 并行获取K线+腾讯补全+行业（省14秒）===
  // 超时保护：Phase1后检查是否还有时间
  if (Date.now() - _totalStart > _MAX_TOTAL) {
    console.warn('总超时保护: Phase1后已超时，返回空结果')
    return { stocks: [], marketEnv: marketEnv, cached: false }
  }
  var klineCodes = candidates.map(function(c) { return c.stock.code })
  console.log("Phase2: 并行获取K线+腾讯+行业...")
  var phase2Start = Date.now()
  var phase2Results = await Promise.all([
    http.fetchKlinesConcurrent(klineCodes, 20).catch(function(e) { console.warn("K线失败:", e.message); return {} }),
    http.fetchTencentBatch(klineCodes, 60).catch(function(e) { console.warn("腾讯补全失败:", e.message); return {} }),
    http.fetchIndustryBatch(klineCodes).catch(function(e) { console.warn("行业获取失败:", e.message); return {} }),
    http.fetchFinancialBatch(klineCodes).catch(function(e) { console.warn("财务备用失败:", e.message); return {} })
  ])
  var klinesMap = phase2Results[0]
  var tencentData = phase2Results[1]
  var industryMap = phase2Results[2]
  var financialData = phase2Results[3]
  console.log("Phase2完成, 耗时 " + (Date.now() - phase2Start) + "ms, K线=" + Object.keys(klinesMap).length + " 腾讯=" + Object.keys(tencentData).length + " 行业=" + Object.keys(industryMap).length + " 财务=" + Object.keys(financialData).length)
  var results = []

  for (var i = 0; i < candidates.length; i++) {
    var stock = candidates[i].stock
    if (i % 10 === 0 && Date.now() - _totalStart > _MAX_TOTAL) { console.warn('评分超时保护，已处理' + i + '只'); break }
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
    // 东财财务备用补充ROE/毛利率/负债率
    var fd = financialData[stock.code]
    if (fd) {
      if (!stock.roe && fd.roe) stock.roe = fd.roe
      if (!stock.grossMargin && fd.grossMargin) stock.grossMargin = fd.grossMargin
      if (!stock.debtRatio && fd.debtRatio) stock.debtRatio = fd.debtRatio
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
    // === Wide filter + bonus scoring (aligned with PC version strong_stock_picker.py) ===
    if (blendedScore < 40) continue  // threshold from 65 to 40

    // V28b4: mild factor weighted ranking
    var mildScore = calcMildScore(stock, volumeRatio, rsi)
    var v31Score = calcTechScoreV31(stock, rsi, goldenCross, volumeRatio, bollPosition, stock.code, change5d, tech)
    var v10Score = blendedScore

    // === V87: techScore权重对齐回测 (v31*0.75 + v10*0.25) ===
    var techScoreV87 = v31Score * 0.75 + v10Score * 0.25

    // === Adaptive market environment ===
    var simpleMktEnv = calcSimpleMarketEnv(marketEnv)

    // === V87: Consecutive up days hard filter (max 4 days, tightened from V84's 5) ===
    var consecUp = 0
    if (klines && klines.length >= 2) {
      consecUp = calcConsecutiveUpDays(klines)
    }
    if (consecUp > 4) {
      continue  // V87: 连涨超过4天，跳过（追高风险过大）
    }

    // === Bonus scoring (former V79 hard filters -> bonus items) ===
    var bonusScore = 0

    // MACD golden cross bonus (was hard filter -> +5)
    var macdConfirmed = goldenCross
    if (macdConfirmed) bonusScore += 5

    // Above MA20 bonus (was hard filter -> +3)
    var aboveMA20 = tech && tech.ma20 ? (stock.price > tech.ma20) : true
    if (aboveMA20) bonusScore += 3

    // BOLL position bonus (was hard filter -> +3)
    if (bollPosition <= 0.85) bonusScore += 3
    else if (bollPosition > 0.85 && bollPosition <= 0.95) bonusScore += 1

    // MA slope bonus (was hard filter -> +3)
    if (tech && tech.ma5Slope !== undefined && tech.ma5Slope >= 0.1) bonusScore += 2
    if (tech && tech.ma10Slope !== undefined && tech.ma10Slope >= 0.02) bonusScore += 1


    // V87: 旗形突破已移入calcPatternScore竞争机制，此处不再独立加分
    var hasFlagBreakout = false
    // Boll squeeze (V87: 作为竞争形态, 在patternBestScore中已体现; 此处仅做标签)
    var hasBollSqueeze = false
    if (tech && tech.bollWidth !== undefined && tech.bollPosition !== undefined) {
      if (tech.bollWidth < 0.09 && tech.bollPosition > 0.7) hasBollSqueeze = true
      if (tech.bollWidth < 0.06 && volumeRatio >= 1.5) hasBollSqueeze = true
    }
    if (!hasBollSqueeze && klines && klines.length >= 8) {
      var lastK2 = klines[klines.length - 1]
      var high5 = -Infinity, low5 = Infinity
      for (var bi = klines.length - 8; bi < klines.length - 1; bi++) {
        if (klines[bi].high > high5) high5 = klines[bi].high
        if (klines[bi].low < low5) low5 = klines[bi].low
      }
      if (low5 > 0 && ((high5 - low5) / low5 * 100) < 5 && lastK2.close > high5) hasBollSqueeze = true
    }
    // V87: boll_squeeze在回测中通过bonusScore加2分(保持与V84一致, 不参与pattern竞争)
    if (hasBollSqueeze) bonusScore += 2

    // Change 1-2.5% bonus (was hard filter -> +3)
    var chgPct = stock.changePct || 0
    if (chgPct >= 1 && chgPct <= 2.5) bonusScore += 3

    // RSI bonus (was hard filter RSI<=60 -> +2)
    if (rsi > 0 && rsi <= 60) bonusScore += 2
    else if (rsi > 70) bonusScore -= 3

    // Volume ratio bonus (was hard filter >=1.2 -> +2)
    if (volumeRatio >= 1.2) bonusScore += 2

    // VP divergence penalty (was hard filter -> -8)
    var vpFiltered = false
    if (tech && tech.vpCoord && tech.vpCoord.trend === "bearish_divergence") {
      vpFiltered = true
      bonusScore -= 8
    }

    // Price position vs high bonus (was hard filter >=95% -> +3)
    if (klines && klines.length >= 20) {
      var pricePosVsHigh = calcPricePositionVsHigh(klines)
      if (pricePosVsHigh >= 0.95) bonusScore += 3
      else if (pricePosVsHigh >= 0.85) bonusScore += 1
    }

    // Relative strength bonus (was hard filter >=6% -> +3)
    if (klines && klines.length >= 21) {
      var relStrength = calcRelativeStrength(klines)
      if (relStrength >= 6) bonusScore += 3
      else if (relStrength >= 3) bonusScore += 1
    }

    // Consecutive up days penalty (avoid overbought stocks)
    var consecUpPenalty = 0
    if (klines && klines.length >= 6) {
      var consecUp = 0
      for (var ci = klines.length - 1; ci > 0; ci--) {
        if (klines[ci].close > klines[ci - 1].close) consecUp++
        else break
      }
      if (consecUp >= 6) consecUpPenalty = -8
      else if (consecUp >= 5) consecUpPenalty = -5
      else if (consecUp >= 4) consecUpPenalty = -2
    }

    // Volume penalty
    var volPenalty = volumeRatio < 1.0 ? 0.9 : 1.0

    // Morphology bonus
    var morphBonus = 0
    if (tech) {
      if (tech.consolidationBreakout && tech.consolidationBreakout.score >= 70) morphBonus += 5
      if (tech.trendAccel && tech.trendAccel.accelerating) morphBonus += 3
      if (tech.candlePatterns && tech.candlePatterns.score >= 15) morphBonus += 3
    }

    // V87: 综合形态评分 (竞争机制: 取最高分形态, 而非叠加)
    var patternResult = klines ? calcPatternScore(klines) : { bestPattern: 'none', bestScore: 0, detectedPatterns: [] }
    var patternBestScore = patternResult.bestScore || 0
    var patternReasons = patternResult.detectedPatterns || []
    // 形态基础分 = bestScore * patternWeight(2.0), 对齐回测
    var patternWeightedScore = Math.round(patternBestScore * 2.0)
    // 从patternResult推断各形态标签
    var hasFlagBreakout = patternResult.bestPattern === 'flag_breakout'
    var hasAscChannel = patternResult.bestPattern === 'asc_channel_break'
    var hasBullAccel = patternResult.bestPattern === 'bull_align_accel'
    var hasVolPriceAccel = patternResult.bestPattern === 'vol_price_accel'

    // V87: rankingScore = techScoreV87 + patternWeightedScore + bonusScore + 温和涨幅加分
    // 温和涨幅加分 (对齐回测: chg 1-3%且vr 1-2时+8, chg 0.5-1%且vr 1-1.5时+4)
    var chgBonusV87 = 0
    if (chgPct >= 1 && chgPct < 3 && volumeRatio >= 1 && volumeRatio < 2) chgBonusV87 = 8
    else if (chgPct >= 0.5 && chgPct < 1 && volumeRatio >= 1 && volumeRatio < 1.5) chgBonusV87 = 4

    var rankingScore = Math.round(techScoreV87 + patternWeightedScore + bonusScore + chgBonusV87 + consecUpPenalty)
    rankingScore *= volPenalty
    rankingScore = Math.round(rankingScore)
    if (rankingScore < 55) continue  // V87: minScore=55, 对齐.齐回测
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

    var reasons = genReasons(stock, v5Reasons, goldenCross, volumeRatio, rsi, pullbackStable, stock.pe, roe, aboveMA20, patternReasons)

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
      goldenCross: goldenCross, aboveMA20: aboveMA20, pullbackStable: pullbackStable,
      hasLimitUp: hasLimitUp,
      hasFlagBreakout: hasFlagBreakout,
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
      holdStrategy: {
        maxHoldDays: 21,
        stopLoss: -100,
        atrExit: true,
        atrMultiplier: 1.3,
        atrTrailingMultiplier: 0.5,
        trailingRules: [{ profitPct: 5, trailingPct: 1.5 }, { profitPct: 8, trailingPct: 2.5 }, { profitPct: 12, trailingPct: 3.5 }],
        description: "V87: 5形态竞争(旗形/通道/多头/量价/BOLL)+ATR1.3x止盈+techScore(v31*0.75+v10*0.25)+连涨<=4天"
      },
      buySell: buySell,
      signals: buildSignalTags({
        goldenCross: goldenCross, aboveMA20: aboveMA20, pullbackStable: pullbackStable,
        gentleVolume: gentleVolume, moderateVolume: moderateVolume, extremeVolume: extremeVolume,
        breakthroughPct: breakthroughPct, change5d: change5d, positionPct: positionPct,
        changePct: stock.changePct || 0, rsi: rsi, pe: stock.pe || 0, roe: roe,
        mildScore: mildScore, hasFlagBreakout: hasFlagBreakout,
        hasAscChannel: hasAscChannel, hasBullAccel: hasBullAccel, hasVolPriceAccel: hasVolPriceAccel }, patternReasons),
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

