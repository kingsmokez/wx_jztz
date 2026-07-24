/**
 * 评分模块 - 从strongPicker提取的评分逻辑，用于回测
 * 包含原始策略和优化策略的评分函数
 */
var { calcRSI, calcBollPosition, calcTechFromKlines } = require("./indicators")

// ===== 判断涨停阈值 =====
function getLimitPct(code) {
  return (code.startsWith("300") || code.startsWith("301") || code.startsWith("688")) ? 19.5 : 9.5
}

// ===== 原始策略评分（V8当前版本）=====
function calcTechScoreOriginal(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d) {
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
  if (volumeRatio >= 1.5 && volumeRatio <= 3) score += 20
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

  // 4. 基本面得分 (0-22)
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


// ===== V10 深度优化策略 =====
// 核心改进：
// 1. 放量突破形态识别（突破前5日高点 + 量比>1.5）
// 2. 均线支撑评分（价格在MA5/MA10/MA20之上加分）
// 3. 缩量回调后放量上涨（洗盘结束信号）
// 4. 连续上涨形态（3日连涨 + 均线多头）
// 5. 底部反转形态（超跌后V型反弹）
// 6. 更严格的量比评分（温和放量>极端放量）
// 7. 振幅评分优化（适中振幅最好）
function calcTechScoreV10(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData) {
  var score = 0
  var chg = stock.changePct || 0
  var isGem = code.startsWith("300") || code.startsWith("301") || code.startsWith("688")
  var maSignal = techData ? (techData.maSignal || "neutral") : "neutral"
  var momentum20 = techData ? (techData.momentum20 || 0) : 0
  var ma5 = techData ? (techData.ma5 || 0) : 0
  var ma10 = techData ? (techData.ma10 || 0) : 0
  var ma20 = techData ? (techData.ma20 || 0) : 0
  var macdObj = techData ? (techData.macdObj || {}) : {}
  var price = stock.price || 0
  var amplitude = stock.amplitude || 0

  // ====== 1. 涨幅得分 (0-20) ======
  // V10: 降低涨幅权重，防止追高；最优区间1.5-4%
  if (isGem) {
    if (chg >= 1.5 && chg <= 4) score += 20
    else if (chg >= 1 && chg < 1.5) score += 16
    else if (chg > 4 && chg <= 7) score += 14
    else if (chg > 7 && chg <= 10) score += 8
    else if (chg > 10) score += 3
    else if (chg >= 0 && chg < 1) score += 8
    else if (chg < 0) score += Math.max(0, 2 + chg)
  } else {
    if (chg >= 1.5 && chg <= 4) score += 20
    else if (chg >= 1 && chg < 1.5) score += 16
    else if (chg > 4 && chg <= 6) score += 12
    else if (chg > 6) score += 3
    else if (chg >= 0 && chg < 1) score += 8
    else if (chg < 0) score += Math.max(0, 2 + chg)
  }

  // ====== 2. 量比得分 (0-15) ======
  // V10: 温和放量1.5-2.5最优，极端放量惩罚
  if (volumeRatio >= 1.5 && volumeRatio <= 2.5) score += 15
  else if (volumeRatio >= 1.0 && volumeRatio < 1.5) score += 10
  else if (volumeRatio > 2.5 && volumeRatio <= 4) score += 8
  else if (volumeRatio > 4 && volumeRatio <= 6) score += 4
  else if (volumeRatio > 6) score += 1
  else if (volumeRatio >= 0.5 && volumeRatio < 1.0) score += 3

  // ====== 3. 趋势形态得分 (0-25) ======
  var trendScore = 0

  // 3a. 均线多头排列 ma5>ma10>ma20 (8分)
  if (maSignal === "bull") trendScore += 8

  // 3b. 价格站上MA5和MA10 (5分)
  if (price > 0 && ma5 > 0 && ma10 > 0) {
    if (price > ma5 && price > ma10) trendScore += 5
    else if (price > ma5 || price > ma10) trendScore += 2
  }

  // 3c. MACD金叉或DIF>0 (4分)
  if (goldenCross) trendScore += 4
  else if (macdObj.dif > 0 && macdObj.dea > 0) trendScore += 2

  // 3d. 5日动量持续性 (4分)
  if (change5d >= 5 && change5d <= 15) trendScore += 4
  else if (change5d >= 3 && change5d < 5) trendScore += 3
  else if (change5d >= 15 && change5d <= 25) trendScore += 2
  else if (change5d > 25) trendScore += 0 // 过热不加分

  // 3e. 20日动量 (4分)
  if (momentum20 >= 8 && momentum20 <= 25) trendScore += 4
  else if (momentum20 >= 3 && momentum20 < 8) trendScore += 2
  else if (momentum20 > 25 && momentum20 <= 40) trendScore += 1

  score += trendScore

  // ====== 4. 量价形态得分 (0-15) ======
  var patternScore = 0

  // 4a. 放量突破：涨幅>1% + 量比>1.5 + 均线多头 (6分)
  if (chg >= 1 && volumeRatio >= 1.5 && maSignal === "bull") patternScore += 6
  else if (chg >= 1 && volumeRatio >= 1.5) patternScore += 3

  // 4b. 温和放量上涨：涨幅1-4% + 量比1-2.5 + 振幅适中 (5分)
  if (chg >= 1 && chg <= 4 && volumeRatio >= 1 && volumeRatio <= 2.5 && amplitude >= 2 && amplitude <= 6) patternScore += 5

  // 4c. 底部启动：RSI<50 + 放量上涨 + MACD金叉 (4分)
  if (rsi < 50 && rsi > 30 && volumeRatio >= 1.5 && goldenCross) patternScore += 4

  score += patternScore

  // ====== 5. 振幅得分 (0-5) ======
  // 适中振幅3-6%最好（说明活跃但不过分波动）
  if (amplitude >= 3 && amplitude <= 6) score += 5
  else if (amplitude >= 2 && amplitude < 3) score += 3
  else if (amplitude > 6 && amplitude <= 8) score += 2

  // ====== 6. RSI位置 (0-5) ======
  if (rsi >= 50 && rsi <= 65) score += 5
  else if (rsi >= 40 && rsi < 50) score += 3
  else if (rsi > 65 && rsi <= 75) score += 2
  else if (rsi > 75) score -= 2 // 超买减分

  // ====== 7. 布林带位置 (0-5) ======
  if (bollPosition >= 0.5 && bollPosition < 0.8) score += 5
  else if (bollPosition >= 0.3 && bollPosition < 0.5) score += 3
  else if (bollPosition >= 0.8) score += 2

  // ====== 8. 基本面得分 (0-10) ======
  var fundamental = 0
  if ((stock.roe || 0) >= 15) fundamental += 4
  else if ((stock.roe || 0) >= 10) fundamental += 2
  if (stock.pe > 0 && stock.pe <= 25) fundamental += 3
  else if (stock.pe > 25 && stock.pe <= 40) fundamental += 1
  if ((stock.debtRatio || 0) > 0 && stock.debtRatio <= 50) fundamental += 3
  else if ((stock.debtRatio || 0) > 50 && stock.debtRatio <= 70) fundamental += 1
  score += fundamental

  return Math.round(Math.min(100, Math.max(0, score)))
}

// ===== 优化策略评分（V9 - 增强趋势形态识别）=====
function calcTechScoreOptimized(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData) {
  var score = 0
  var chg = stock.changePct || 0
  var isGem = code.startsWith("300") || code.startsWith("301") || code.startsWith("688")
  var maSignal = techData ? techData.maSignal : "neutral"
  var momentum20 = techData ? (techData.momentum20 || 0) : 0
  var ma5 = techData ? (techData.ma5 || 0) : 0
  var ma10 = techData ? (techData.ma10 || 0) : 0
  var ma20 = techData ? (techData.ma20 || 0) : 0
  var macdObj = techData ? (techData.macdObj || {}) : {}

  // === 1. 涨幅得分 (0-25) - 优化：缩小最优区间，排除过热 ===
  if (isGem) {
    if (chg >= 2 && chg <= 5) score += 25
    else if (chg >= 1 && chg < 2) score += 20
    else if (chg > 5 && chg <= 8) score += 18
    else if (chg > 8 && chg <= 12) score += 12
    else if (chg > 12) score += 5  // 过热降分
    else if (chg >= 0 && chg < 1) score += 8
    else if (chg < 0) score += Math.max(0, 3 + chg)
  } else {
    if (chg >= 2 && chg <= 5) score += 25
    else if (chg >= 1 && chg < 2) score += 20
    else if (chg > 5 && chg <= 7) score += 16
    else if (chg > 7) score += 5   // 过热降分
    else if (chg >= 0 && chg < 1) score += 8
    else if (chg < 0) score += Math.max(0, 3 + chg)
  }

  // === 2. 量比得分 (0-20) - 优化：更重视温和放量，惩罚极端 ===
  if (volumeRatio >= 1.5 && volumeRatio <= 2.5) score += 20  // 温和放量最优
  else if (volumeRatio >= 1.0 && volumeRatio < 1.5) score += 14
  else if (volumeRatio > 2.5 && volumeRatio <= 4) score += 12
  else if (volumeRatio > 4 && volumeRatio <= 6) score += 6
  else if (volumeRatio > 6) score += 2  // 极端放量惩罚
  else if (volumeRatio >= 0.5 && volumeRatio < 1.0) score += 4

  // === 3. 趋势形态得分 (0-20) - 全新！ ===
  var trendScore = 0

  // 3a. 均线多头排列 (ma5>ma10>ma20)
  if (maSignal === "bull") trendScore += 8

  // 3b. MACD金叉或DIF>0（强势动能）
  if (goldenCross) trendScore += 6
  else if (macdObj.dif > 0 && macdObj.dea > 0) trendScore += 3  // DIF DEA双正

  // 3c. 5日/20日动量（持续性）
  if (change5d >= 8 && change5d <= 20) trendScore += 4  // 适度持续上涨
  else if (change5d >= 5 && change5d < 8) trendScore += 3
  else if (change5d > 20) trendScore += 1  // 涨太多可能回调

  // 3d. 20日动量趋势
  if (momentum20 >= 10 && momentum20 <= 30) trendScore += 2  // 中期上升趋势
  else if (momentum20 >= 5 && momentum20 < 10) trendScore += 1

  score += trendScore

  // === 4. 技术指标得分 (0-15) - 缩减，趋势已占一部分 ===
  var techScore = 0
  // RSI: 50-65强势区间
  if (rsi >= 50 && rsi <= 65) techScore += 6
  else if (rsi >= 40 && rsi < 50) techScore += 3
  else if (rsi > 65 && rsi <= 75) techScore += 2
  else if (rsi > 75) techScore -= 2  // 超买减分

  // BOLL位置
  if (bollPosition >= 0.5 && bollPosition < 0.8) techScore += 5  // 中轨上方但未触及上轨
  else if (bollPosition >= 0.3 && bollPosition < 0.5) techScore += 3
  else if (bollPosition >= 0.8) techScore += 2  // 触上轨偏激进

  score += Math.min(15, Math.max(0, techScore))

  // === 5. 基本面得分 (0-20) - 略降权重 ===
  var fundamental = 0
  if ((stock.roe || 0) >= 15) fundamental += 6
  else if ((stock.roe || 0) >= 10) fundamental += 4
  else if ((stock.roe || 0) >= 5) fundamental += 2
  if ((stock.grossMargin || 0) >= 30) fundamental += 3
  else if ((stock.grossMargin || 0) >= 20) fundamental += 1
  if (stock.pe > 0 && stock.pe <= 25) fundamental += 5
  else if (stock.pe > 25 && stock.pe <= 40) fundamental += 2
  if ((stock.debtRatio || 0) > 0 && stock.debtRatio <= 50) fundamental += 3
  else if ((stock.debtRatio || 0) > 50 && stock.debtRatio <= 70) fundamental += 1
  score += fundamental

  return Math.round(Math.min(100, Math.max(0, score)))
}

module.exports = {
  calcTechScoreV10,
  getLimitPct,
  calcTechScoreOriginal,
  calcTechScoreOptimized,
}


