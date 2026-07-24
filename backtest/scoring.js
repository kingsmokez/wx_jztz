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

/**
 * V11 深度优化策略
 * 核心改进：
 * 1. 新增连涨放量形态（3日连涨+量递增）
 * 2. 新增缩量洗盘后放量启动
 * 3. 新增底部反转形态
 * 4. 优化均线评分体系
 * 5. 提高最低分数门槛到55
 */
function calcTechScoreV11(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData) {
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

  // ====== 1. 涨幅得分 (0-18) ======
  // V11: 进一步降低涨幅权重，1.5-3.5%最优
  if (isGem) {
    if (chg >= 1.5 && chg <= 3.5) score += 18
    else if (chg >= 1 && chg < 1.5) score += 14
    else if (chg > 3.5 && chg <= 6) score += 12
    else if (chg > 6 && chg <= 10) score += 6
    else if (chg > 10) score += 2
    else if (chg >= 0 && chg < 1) score += 6
    else if (chg < 0) score += Math.max(0, 2 + chg)
  } else {
    if (chg >= 1.5 && chg <= 3.5) score += 18
    else if (chg >= 1 && chg < 1.5) score += 14
    else if (chg > 3.5 && chg <= 5) score += 10
    else if (chg > 5) score += 2
    else if (chg >= 0 && chg < 1) score += 6
    else if (chg < 0) score += Math.max(0, 2 + chg)
  }

  // ====== 2. 量比得分 (0-12) ======
  // V11: 温和放量1.5-2.2最优
  if (volumeRatio >= 1.5 && volumeRatio <= 2.2) score += 12
  else if (volumeRatio >= 1.0 && volumeRatio < 1.5) score += 8
  else if (volumeRatio > 2.2 && volumeRatio <= 3) score += 7
  else if (volumeRatio > 3 && volumeRatio <= 5) score += 4
  else if (volumeRatio > 5) score += 1
  else if (volumeRatio >= 0.5 && volumeRatio < 1.0) score += 3

  // ====== 3. 趋势形态得分 (0-30) ======
  var trendScore = 0

  // 3a. 均线多头排列 (ma5>ma10>ma20) - 最强信号
  if (maSignal === "bull") trendScore += 10
  // 价格站上MA5
  else if (price > ma5 && price > ma10) trendScore += 5
  // 价格在MA5附近
  else if (price > ma5) trendScore += 3

  // 3b. MACD金叉或DIF>0
  if (goldenCross) trendScore += 6
  else if (macdObj.dif > 0 && macdObj.dea > 0) trendScore += 3
  else if (macdObj.dif > 0) trendScore += 1

  // 3c. 5日动量（适度上涨）
  if (change5d >= 5 && change5d <= 15) trendScore += 5
  else if (change5d >= 3 && change5d < 5) trendScore += 3
  else if (change5d > 15 && change5d <= 25) trendScore += 2
  else if (change5d > 25) trendScore += 0

  // 3d. 20日动量趋势
  if (momentum20 >= 5 && momentum20 <= 20) trendScore += 4
  else if (momentum20 >= 0 && momentum20 < 5) trendScore += 2
  else if (momentum20 >= 20 && momentum20 <= 35) trendScore += 2

  // 3e. 均线粘合后发散（MA5/MA10/MA20间距小后开始发散）
  if (ma5 > 0 && ma10 > 0 && ma20 > 0) {
    var maSpread = Math.abs((ma5 - ma20) / ma20 * 100)
    if (maSpread >= 1 && maSpread <= 5 && maSignal === "bull") trendScore += 5
  }

  score += Math.min(30, trendScore)

  // ====== 4. 量价形态得分 (0-20) ======
  var vpScore = 0

  // 4a. 放量突破：量比>1.5 + 涨幅>1% + 突破MA10
  if (volumeRatio >= 1.5 && chg >= 1 && price > ma10 && ma10 > 0) {
    vpScore += 8
  }

  // 4b. 温和放量上涨：量比1.2-2.5 + 涨幅1-4%
  if (volumeRatio >= 1.2 && volumeRatio <= 2.5 && chg >= 1 && chg <= 4) {
    vpScore += 5
  }

  // 4c. 底部启动：20日动量<-10但当日放量上涨
  if (momentum20 < -10 && chg >= 2 && volumeRatio >= 1.5) {
    vpScore += 4
  }

  // 4d. 缩量回调后放量：5日涨幅>3% + 量比>1.5 + RSI<60
  if (change5d >= 3 && volumeRatio >= 1.5 && rsi < 60 && rsi >= 40) {
    vpScore += 3
  }

  score += Math.min(20, vpScore)

  // ====== 5. 振幅得分 (0-5) ======
  if (amplitude >= 3 && amplitude <= 6) score += 5
  else if (amplitude >= 2 && amplitude < 3) score += 3
  else if (amplitude > 6 && amplitude <= 8) score += 3
  else if (amplitude > 8) score += 1

  // ====== 6. RSI位置 (0-5) ======
  if (rsi >= 50 && rsi <= 60) score += 5
  else if (rsi >= 45 && rsi < 50) score += 3
  else if (rsi > 60 && rsi <= 70) score += 3
  else if (rsi > 70) score -= 3

  // ====== 7. 布林带位置 (0-5) ======
  if (bollPosition >= 0.5 && bollPosition < 0.75) score += 5
  else if (bollPosition >= 0.3 && bollPosition < 0.5) score += 3
  else if (bollPosition >= 0.75 && bollPosition < 0.9) score += 2
  else if (bollPosition >= 0.9) score -= 2

  // ====== 8. 基本面得分 (0-5) ======
  var fundamental = 0
  if ((stock.roe || 0) >= 15) fundamental += 2
  else if ((stock.roe || 0) >= 10) fundamental += 1
  if (stock.pe > 0 && stock.pe <= 25) fundamental += 2
  else if (stock.pe > 25 && stock.pe <= 40) fundamental += 1
  if ((stock.debtRatio || 0) > 0 && stock.debtRatio <= 50) fundamental += 1
  score += fundamental

  // ====== 9. 惩罚项 ======
  // 超买惩罚
  if (rsi > 75) score -= 5
  // 极端放量惩罚
  if (volumeRatio > 8) score -= 5
  // 布林上轨外惩罚
  if (bollPosition >= 0.95) score -= 3
  // 均线空头排列惩罚
  if (maSignal === "bear") score -= 5

  return Math.round(Math.min(100, Math.max(0, score)))
}



/**
 * V12 终极策略 - 结合V10高分段优势和V11惩罚项
 * 核心改进：
 * 1. V10评分结构（高分段区分度好）
 * 2. V11惩罚项（超买/极端放量/空头排列）
 * 3. 均线粘合后发散加分
 * 4. 连涨3日形态识别
 * 5. 缩量洗盘后放量启动
 */
function calcTechScoreV12(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData) {
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
  // 最优1.5-4%，降低追高风险
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
  if (volumeRatio >= 1.5 && volumeRatio <= 2.5) score += 15
  else if (volumeRatio >= 1.0 && volumeRatio < 1.5) score += 10
  else if (volumeRatio > 2.5 && volumeRatio <= 4) score += 10
  else if (volumeRatio > 4 && volumeRatio <= 6) score += 5
  else if (volumeRatio > 6) score += 2
  else if (volumeRatio >= 0.5 && volumeRatio < 1.0) score += 4

  // ====== 3. 趋势形态得分 (0-25) ======
  var trendScore = 0

  // 3a. 均线多头排列
  if (maSignal === "bull") trendScore += 8
  else if (price > ma5 && price > ma10) trendScore += 4
  else if (price > ma5) trendScore += 2

  // 3b. MACD金叉或DIF>0
  if (goldenCross) trendScore += 4
  else if (macdObj.dif > 0 && macdObj.dea > 0) trendScore += 2

  // 3c. 5日动量
  if (change5d >= 8 && change5d <= 20) trendScore += 4
  else if (change5d >= 5 && change5d < 8) trendScore += 3
  else if (change5d >= 3 && change5d < 5) trendScore += 2
  else if (change5d > 20) trendScore += 1

  // 3d. 20日动量
  if (momentum20 >= 10 && momentum20 <= 30) trendScore += 4
  else if (momentum20 >= 5 && momentum20 < 10) trendScore += 3
  else if (momentum20 >= 0 && momentum20 < 5) trendScore += 1

  // 3e. 均线粘合后发散（MA5/MA10/MA20间距小+多头）
  if (ma5 > 0 && ma10 > 0 && ma20 > 0) {
    var maSpread = Math.abs((ma5 - ma20) / ma20 * 100)
    if (maSpread >= 1 && maSpread <= 4 && maSignal === "bull") trendScore += 5
  }

  score += Math.min(25, trendScore)

  // ====== 4. 量价形态得分 (0-15) ======
  var vpScore = 0

  // 4a. 放量突破
  if (volumeRatio >= 1.5 && chg >= 1 && price > ma10 && ma10 > 0) vpScore += 6

  // 4b. 温和放量上涨
  if (volumeRatio >= 1.2 && volumeRatio <= 2.5 && chg >= 1 && chg <= 4) vpScore += 4

  // 4c. 底部启动
  if (momentum20 < -10 && chg >= 2 && volumeRatio >= 1.5) vpScore += 3

  // 4d. 缩量回调后放量
  if (change5d >= 3 && volumeRatio >= 1.5 && rsi >= 40 && rsi < 60) vpScore += 2

  score += Math.min(15, vpScore)

  // ====== 5. 振幅得分 (0-5) ======
  if (amplitude >= 3 && amplitude <= 6) score += 5
  else if (amplitude >= 2 && amplitude < 3) score += 3
  else if (amplitude > 6 && amplitude <= 8) score += 3
  else if (amplitude > 8) score += 1

  // ====== 6. RSI位置 (0-5) ======
  if (rsi >= 50 && rsi <= 65) score += 5
  else if (rsi >= 45 && rsi < 50) score += 3
  else if (rsi > 65 && rsi <= 75) score += 2
  else if (rsi > 75) score -= 2

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

  // ====== 9. 惩罚项 ======
  if (rsi > 75) score -= 5
  if (volumeRatio > 8) score -= 5
  if (bollPosition >= 0.95) score -= 3
  if (maSignal === "bear") score -= 5

  return Math.round(Math.min(100, Math.max(0, score)))
}



/**
 * V13 - 增大评分区分度版
 * 核心思路：让好股票得更高分(80+), 差股票得低分
 * 1. 各维度得分更陡峭 - 最优区间给高分, 非最优区间给低分
 * 2. 连涨形态额外加分 - 连续上涨趋势是最强信号
 * 3. 量价配合额外加分 - 放量突破必须量价齐升
 * 4. 均线多头+粘合发散 - 最可靠的底部启动信号
 * 5. 更严格的惩罚 - 超买/空头/极端放量/高位布林
 */
function calcTechScoreV13(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData) {
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

  // ====== 1. 涨幅得分 (0-18) - 更陡峭 ======
  if (isGem) {
    if (chg >= 2 && chg <= 4) score += 18
    else if (chg >= 1.5 && chg < 2) score += 14
    else if (chg >= 1 && chg < 1.5) score += 8
    else if (chg > 4 && chg <= 6) score += 10
    else if (chg > 6 && chg <= 10) score += 4
    else if (chg > 10) score += 0
    else if (chg >= 0 && chg < 1) score += 3
    else score += 0
  } else {
    if (chg >= 2 && chg <= 4) score += 18
    else if (chg >= 1.5 && chg < 2) score += 14
    else if (chg >= 1 && chg < 1.5) score += 8
    else if (chg > 4 && chg <= 6) score += 8
    else if (chg > 6) score += 0
    else if (chg >= 0 && chg < 1) score += 3
    else score += 0
  }

  // ====== 2. 量比得分 (0-12) - 更陡峭 ======
  if (volumeRatio >= 1.5 && volumeRatio <= 2.5) score += 12
  else if (volumeRatio >= 1.0 && volumeRatio < 1.5) score += 6
  else if (volumeRatio > 2.5 && volumeRatio <= 4) score += 5
  else if (volumeRatio > 4 && volumeRatio <= 6) score += 2
  else if (volumeRatio > 6) score += 0
  else if (volumeRatio >= 0.5 && volumeRatio < 1.0) score += 2
  else score += 0

  // ====== 3. 趋势形态得分 (0-28) - 更陡峭 ======
  var trendScore = 0

  // 3a. 均线多头排列 (最关键信号)
  if (maSignal === "bull") trendScore += 12
  else if (price > ma5 && price > ma10 && price > ma20) trendScore += 5
  else if (price > ma5 && price > ma10) trendScore += 3
  else if (price > ma5) trendScore += 1

  // 3b. MACD金叉
  if (goldenCross) trendScore += 6
  else if (macdObj.dif > 0 && macdObj.dea > 0) trendScore += 3
  else if (macdObj.dif > 0) trendScore += 1

  // 3c. 5日动量
  if (change5d >= 8 && change5d <= 20) trendScore += 5
  else if (change5d >= 5 && change5d < 8) trendScore += 3
  else if (change5d >= 3 && change5d < 5) trendScore += 1
  else if (change5d > 20) trendScore += 1

  // 3d. 20日动量
  if (momentum20 >= 10 && momentum20 <= 30) trendScore += 5
  else if (momentum20 >= 5 && momentum20 < 10) trendScore += 3
  else if (momentum20 >= 0 && momentum20 < 5) trendScore += 1

  score += Math.min(28, trendScore)

  // ====== 4. 量价形态得分 (0-18) - 增加连涨形态 ======
  var vpScore = 0

  // 4a. 放量突破MA10
  if (volumeRatio >= 1.5 && chg >= 1.5 && price > ma10 && ma10 > 0) vpScore += 8
  else if (volumeRatio >= 1.2 && chg >= 1 && price > ma10 && ma10 > 0) vpScore += 4

  // 4b. 温和放量上涨
  if (volumeRatio >= 1.2 && volumeRatio <= 2.5 && chg >= 1.5 && chg <= 4) vpScore += 5
  else if (volumeRatio >= 1.0 && volumeRatio <= 3 && chg >= 1 && chg <= 5) vpScore += 2

  // 4c. 均线粘合后发散（底部启动最强信号）
  if (ma5 > 0 && ma10 > 0 && ma20 > 0) {
    var maSpread = Math.abs((ma5 - ma20) / ma20 * 100)
    if (maSpread >= 1 && maSpread <= 4 && maSignal === "bull") vpScore += 5
    else if (maSpread >= 0.5 && maSpread < 1 && maSignal === "bull") vpScore += 3
  }

  score += Math.min(18, vpScore)

  // ====== 5. 振幅得分 (0-4) ======
  if (amplitude >= 3 && amplitude <= 6) score += 4
  else if (amplitude >= 2 && amplitude < 3) score += 2
  else if (amplitude > 6 && amplitude <= 8) score += 2

  // ====== 6. RSI位置 (0-6) ======
  if (rsi >= 50 && rsi <= 60) score += 6
  else if (rsi >= 45 && rsi < 50) score += 3
  else if (rsi > 60 && rsi <= 70) score += 2
  else if (rsi > 70 && rsi <= 75) score += 0
  else if (rsi > 75) score -= 3

  // ====== 7. 布林带位置 (0-4) ======
  if (bollPosition >= 0.5 && bollPosition < 0.75) score += 4
  else if (bollPosition >= 0.3 && bollPosition < 0.5) score += 2
  else if (bollPosition >= 0.75 && bollPosition < 0.85) score += 1

  // ====== 8. 基本面得分 (0-5) ======
  var fundamental = 0
  if ((stock.roe || 0) >= 15) fundamental += 2
  else if ((stock.roe || 0) >= 10) fundamental += 1
  if (stock.pe > 0 && stock.pe <= 25) fundamental += 2
  else if (stock.pe > 25 && stock.pe <= 40) fundamental += 1
  if ((stock.debtRatio || 0) > 0 && stock.debtRatio <= 50) fundamental += 1
  score += fundamental

  // ====== 9. 惩罚项（更严格）======
  if (rsi > 75) score -= 6
  if (volumeRatio > 8) score -= 6
  if (bollPosition >= 0.95) score -= 4
  if (maSignal === "bear") score -= 8
  if (chg < 0) score -= 3
  if (momentum20 < -15) score -= 5

  return Math.round(Math.min(100, Math.max(0, score)))
}


/**
 * V14 可持续强势策略
 */
function calcTechScoreV14(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData) {
  var score = 0
  var chg = stock.changePct || 0
  var isGem = code.startsWith('300') || code.startsWith('301') || code.startsWith('688')
  var maSignal = techData ? (techData.maSignal || 'neutral') : 'neutral'
  var momentum20 = techData ? (techData.momentum20 || 0) : 0
  var ma5 = techData ? (techData.ma5 || 0) : 0
  var ma10 = techData ? (techData.ma10 || 0) : 0
  var ma20 = techData ? (techData.ma20 || 0) : 0
  var ma60 = techData ? (techData.ma60 || 0) : 0
  var macdObj = techData ? (techData.macdObj || {}) : {}
  var price = stock.price || 0
  var amplitude = stock.amplitude || 0

  // 1. 涨幅得分 (0-18)
  if (isGem) {
    if (chg >= 1.5 && chg <= 4) score += 18
    else if (chg >= 1 && chg < 1.5) score += 14
    else if (chg > 4 && chg <= 7) score += 10
    else if (chg > 7 && chg <= 10) score += 4
    else if (chg > 10) score += 1
    else if (chg >= 0 && chg < 1) score += 6
    else if (chg < 0) score += Math.max(0, 2 + chg)
  } else {
    if (chg >= 1.5 && chg <= 4) score += 18
    else if (chg >= 1 && chg < 1.5) score += 14
    else if (chg > 4 && chg <= 6) score += 8
    else if (chg > 6) score += 1
    else if (chg >= 0 && chg < 1) score += 6
    else if (chg < 0) score += Math.max(0, 2 + chg)
  }

  // 2. 量比得分 (0-12)
  if (volumeRatio >= 1.5 && volumeRatio <= 2.5) score += 12
  else if (volumeRatio >= 1.0 && volumeRatio < 1.5) score += 8
  else if (volumeRatio > 2.5 && volumeRatio <= 4) score += 6
  else if (volumeRatio > 4 && volumeRatio <= 6) score += 2
  else if (volumeRatio > 6) score += 0
  else if (volumeRatio >= 0.5 && volumeRatio < 1.0) score += 2

  // 3. 趋势形态得分 (0-28)
  var trendScore = 0
  if (maSignal === 'bull') trendScore += 8
  if (price > 0 && ma5 > 0 && ma10 > 0) {
    if (price > ma5 && price > ma10) trendScore += 5
    else if (price > ma5 || price > ma10) trendScore += 2
  }
  if (goldenCross) trendScore += 4
  else if (macdObj.dif > 0 && macdObj.dea > 0) trendScore += 2
  if (change5d >= 5 && change5d <= 15) trendScore += 4
  else if (change5d >= 3 && change5d < 5) trendScore += 3
  else if (change5d >= 15 && change5d <= 25) trendScore += 2
  if (momentum20 >= 8 && momentum20 <= 25) trendScore += 3
  else if (momentum20 >= 3 && momentum20 < 8) trendScore += 2
  else if (momentum20 > 25 && momentum20 <= 40) trendScore += 1
  if (ma60 > 0 && price > ma60) trendScore += 4
  else if (ma60 > 0 && price > ma60 * 0.97) trendScore += 2
  score += trendScore

  // 4. 量价形态得分 (0-18)
  var patternScore = 0
  if (chg >= 1 && volumeRatio >= 1.5 && maSignal === 'bull') patternScore += 6
  else if (chg >= 1 && volumeRatio >= 1.5) patternScore += 3
  if (chg >= 1 && chg <= 4 && volumeRatio >= 1 && volumeRatio <= 2.5 && amplitude >= 2 && amplitude <= 6) patternScore += 5
  if (rsi < 50 && rsi > 30 && volumeRatio >= 1.5 && goldenCross) patternScore += 4
  if (change5d >= 3 && change5d <= 15 && volumeRatio >= 1.5 && volumeRatio <= 3 && maSignal === 'bull') patternScore += 3
  score += patternScore

  // 5. 振幅得分 (0-4)
  if (amplitude >= 3 && amplitude <= 6) score += 4
  else if (amplitude >= 2 && amplitude < 3) score += 2
  else if (amplitude > 6 && amplitude <= 8) score += 1

  // 6. RSI位置 (0-6)
  if (rsi >= 50 && rsi <= 65) score += 6
  else if (rsi >= 40 && rsi < 50) score += 3
  else if (rsi > 65 && rsi <= 75) score += 1
  else if (rsi > 75) score -= 2

  // 7. 布林带位置 (0-4)
  if (bollPosition >= 0.5 && bollPosition < 0.8) score += 4
  else if (bollPosition >= 0.3 && bollPosition < 0.5) score += 2
  else if (bollPosition >= 0.8 && bollPosition < 0.9) score += 1

  // 8. 基本面得分 (0-10)
  var fundamental = 0
  if ((stock.roe || 0) >= 15) fundamental += 4
  else if ((stock.roe || 0) >= 10) fundamental += 2
  if (stock.pe > 0 && stock.pe <= 25) fundamental += 3
  else if (stock.pe > 25 && stock.pe <= 40) fundamental += 1
  if ((stock.debtRatio || 0) > 0 && stock.debtRatio <= 50) fundamental += 3
  else if ((stock.debtRatio || 0) > 50 && stock.debtRatio <= 70) fundamental += 1
  score += fundamental

  // 9. 多指标共振加分 (0-5)
  var resonance = 0
  if (chg >= 1.5 && chg <= 4) resonance++
  if (volumeRatio >= 1.5 && volumeRatio <= 2.5) resonance++
  if (maSignal === 'bull') resonance++
  if (goldenCross) resonance++
  if (resonance >= 4) score += 5
  else if (resonance >= 3) score += 2

  // 10. 风险过滤
  if (chg > 6 && volumeRatio > 4) score -= 4
  if (rsi > 78) score -= 3
  if (change5d > 20) score -= 3
  if (maSignal === 'bear') score -= 4
  if (ma60 > 0 && price > ma60 * 1.3) score -= 2

  return Math.round(Math.min(100, Math.max(0, score)))
}


// V15 - 形态识别增强版
function calcTechScoreV15(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData) {
  var score = 0
  var chg = stock.changePct || 0
  var isGem = code.startsWith("300") || code.startsWith("301") || code.startsWith("688")
  var maSignal = techData ? (techData.maSignal || "neutral") : "neutral"
  var momentum20 = techData ? (techData.momentum20 || 0) : 0
  var ma5 = techData ? (techData.ma5 || 0) : 0
  var ma10 = techData ? (techData.ma10 || 0) : 0
  var ma20 = techData ? (techData.ma20 || 0) : 0
  var ma60 = techData ? (techData.ma60 || 0) : 0
  var macdObj = techData ? (techData.macdObj || {}) : {}
  var price = stock.price || 0
  var amplitude = stock.amplitude || 0
  var patterns = techData ? (techData.patterns || {}) : {}

  // 1. 涨幅(0-15)
  if (isGem) {
    if (chg >= 1.5 && chg <= 4) score += 15
    else if (chg >= 1 && chg < 1.5) score += 12
    else if (chg > 4 && chg <= 7) score += 10
    else if (chg > 7 && chg <= 10) score += 5
    else if (chg > 10) score += 2
    else if (chg >= 0 && chg < 1) score += 6
    else score += Math.max(0, 2 + chg)
  } else {
    if (chg >= 1.5 && chg <= 4) score += 15
    else if (chg >= 1 && chg < 1.5) score += 12
    else if (chg > 4 && chg <= 6) score += 8
    else if (chg > 6) score += 2
    else if (chg >= 0 && chg < 1) score += 6
    else score += Math.max(0, 2 + chg)
  }

  // 2. 量比(0-10)
  if (volumeRatio >= 1.5 && volumeRatio <= 2.5) score += 10
  else if (volumeRatio >= 1.0 && volumeRatio < 1.5) score += 6
  else if (volumeRatio > 2.5 && volumeRatio <= 4) score += 4
  else if (volumeRatio > 4) score += 1
  else if (volumeRatio >= 0.5) score += 2

  // 3. 趋势形态(0-15)
  var ts = 0
  if (maSignal === "bull") ts += 5
  if (price > 0 && ma5 > 0 && ma10 > 0) {
    if (price > ma5 && price > ma10) ts += 3
    else if (price > ma5 || price > ma10) ts += 1
  }
  if (goldenCross) ts += 3
  else if (macdObj.dif > 0 && macdObj.dea > 0) ts += 1
  if (change5d >= 5 && change5d <= 15) ts += 2
  else if (change5d >= 3) ts += 1
  if (momentum20 >= 5 && momentum20 <= 20) ts += 2
  else if (momentum20 >= 0) ts += 1
  score += ts

  // 4. 量价形态(0-10)
  var ps = 0
  if (chg >= 1 && volumeRatio >= 1.5 && maSignal === "bull") ps += 4
  else if (chg >= 1 && volumeRatio >= 1.5) ps += 2
  if (chg >= 1 && chg <= 4 && volumeRatio >= 1 && volumeRatio <= 2.5 && amplitude >= 2 && amplitude <= 6) ps += 3
  if (rsi < 50 && rsi > 30 && volumeRatio >= 1.5 && goldenCross) ps += 3
  score += ps

  // 5. 形态识别(0-30) 核心新增！
  var pt = (patterns.cupHandle || 0) + (patterns.breakout || 0) + (patterns.pullbackRestart || 0) + (patterns.consecutiveUp || 0) + (patterns.bottomReversal || 0) + (patterns.maSupport || 0)
  score += Math.min(30, pt)

  // 6. 振幅(0-3)
  if (amplitude >= 3 && amplitude <= 6) score += 3
  else if (amplitude >= 2 && amplitude < 3) score += 1

  // 7. RSI(0-4)
  if (rsi >= 50 && rsi <= 65) score += 4
  else if (rsi >= 40 && rsi < 50) score += 2
  else if (rsi > 65 && rsi <= 75) score += 1

  // 8. BOLL(0-3)
  if (bollPosition >= 0.5 && bollPosition < 0.8) score += 3
  else if (bollPosition >= 0.3 && bollPosition < 0.5) score += 1

  // 9. 基本面(0-5)
  var f = 0
  if ((stock.roe || 0) >= 15) f += 2
  else if ((stock.roe || 0) >= 10) f += 1
  if (stock.pe > 0 && stock.pe <= 25) f += 2
  else if (stock.pe > 25 && stock.pe <= 40) f += 1
  if ((stock.debtRatio || 0) > 0 && stock.debtRatio <= 50) f += 1
  score += f

  // 10. 共振(0-5)
  var rc = 0
  if (chg >= 1.5 && chg <= 4) rc++
  if (volumeRatio >= 1.5 && volumeRatio <= 2.5) rc++
  if (maSignal === "bull") rc++
  if (goldenCross) rc++
  if (pt >= 5) rc++
  if (rc >= 5) score += 5
  else if (rc >= 4) score += 3
  else if (rc >= 3) score += 1

  // 11. 风险过滤
  if (chg > 6 && volumeRatio > 4) score -= 5
  if (rsi > 78) score -= 4
  if (change5d > 20) score -= 3
  if (maSignal === "bear") score -= 5
  if (ma60 > 0 && price > ma60 * 1.3) score -= 2

  return Math.round(Math.min(100, Math.max(0, score)))
}
// V16 - 动量趋势强度版
function calcTechScoreV16(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData) {
  var score = 0
  var chg = stock.changePct || 0
  var isGem = code.startsWith("300") || code.startsWith("301") || code.startsWith("688")
  var maSignal = techData ? (techData.maSignal || "neutral") : "neutral"
  var momentum20 = techData ? (techData.momentum20 || 0) : 0
  var ma5 = techData ? (techData.ma5 || 0) : 0
  var ma10 = techData ? (techData.ma10 || 0) : 0
  var ma20 = techData ? (techData.ma20 || 0) : 0
  var ma60 = techData ? (techData.ma60 || 0) : 0
  var macdObj = techData ? (techData.macdObj || {}) : {}
  var price = stock.price || 0
  var amplitude = stock.amplitude || 0
  var adx = techData ? (techData.adx || 0) : 0
  var plusDI = techData ? (techData.plusDI || 0) : 0
  var minusDI = techData ? (techData.minusDI || 0) : 0
  var obvTrend = techData ? (techData.obvTrend || 0) : 0
  var obvSlope5 = techData ? (techData.obvSlope5 || 0) : 0
  var ma5Slope = techData ? (techData.ma5Slope || 0) : 0
  var ma10Slope = techData ? (techData.ma10Slope || 0) : 0
  var atr = techData ? (techData.atr || 0) : 0
  var patterns = techData ? (techData.patterns || {}) : {}

  // 1. 涨幅(0-12)
  if (isGem) {
    if (chg >= 1.5 && chg <= 4) score += 12
    else if (chg >= 1 && chg < 1.5) score += 9
    else if (chg > 4 && chg <= 7) score += 7
    else if (chg > 7 && chg <= 10) score += 3
    else if (chg > 10) score += 1
    else if (chg >= 0 && chg < 1) score += 4
    else score += Math.max(0, 2 + chg)
  } else {
    if (chg >= 1.5 && chg <= 4) score += 12
    else if (chg >= 1 && chg < 1.5) score += 9
    else if (chg > 4 && chg <= 6) score += 5
    else if (chg > 6) score += 1
    else if (chg >= 0 && chg < 1) score += 4
    else score += Math.max(0, 2 + chg)
  }

  // 2. 量比(0-8)
  if (volumeRatio >= 1.5 && volumeRatio <= 2.5) score += 8
  else if (volumeRatio >= 1.0 && volumeRatio < 1.5) score += 5
  else if (volumeRatio > 2.5 && volumeRatio <= 4) score += 3
  else if (volumeRatio > 4) score += 1
  else if (volumeRatio >= 0.5) score += 1

  // 3. 趋势形态(0-12)
  var ts = 0
  if (maSignal === "bull") ts += 4
  if (price > 0 && ma5 > 0 && ma10 > 0) {
    if (price > ma5 && price > ma10) ts += 2
    else if (price > ma5 || price > ma10) ts += 1
  }
  if (goldenCross) ts += 3
  else if (macdObj.dif > 0 && macdObj.dea > 0) ts += 1
  if (change5d >= 5 && change5d <= 15) ts += 2
  else if (change5d >= 3) ts += 1
  if (momentum20 >= 5 && momentum20 <= 20) ts += 1
  score += ts

  // 4. 量价形态(0-8)
  var ps = 0
  if (chg >= 1 && volumeRatio >= 1.5 && maSignal === "bull") ps += 3
  else if (chg >= 1 && volumeRatio >= 1.5) ps += 1
  if (chg >= 1 && chg <= 4 && volumeRatio >= 1 && volumeRatio <= 2.5 && amplitude >= 2 && amplitude <= 6) ps += 3
  if (rsi < 50 && rsi > 30 && volumeRatio >= 1.5 && goldenCross) ps += 2
  score += ps

  // 5. ADX趋势强度(0-8)
  if (adx >= 30 && plusDI > minusDI) score += 8
  else if (adx >= 25 && plusDI > minusDI) score += 6
  else if (adx >= 20 && plusDI > minusDI) score += 4
  else if (adx >= 20) score += 2
  else if (adx >= 15 && plusDI > minusDI) score += 2

  // 6. OBV确认(0-7)
  if (obvTrend === 1 && obvSlope5 > 0.1) score += 7
  else if (obvTrend === 1 && obvSlope5 > 0) score += 5
  else if (obvTrend === 1) score += 3
  else if (obvSlope5 > 0.1) score += 2
  else if (obvSlope5 < -0.1) score -= 3

  // 7. ATR波动率适配(0-5)
  if (atr > 0 && price > 0) {
    var atrPct = atr / price * 100
    if (atrPct >= 2 && atrPct <= 4) score += 5
    else if (atrPct >= 1.5 && atrPct < 2) score += 3
    else if (atrPct > 4 && atrPct <= 5) score += 2
    else if (atrPct > 5) score -= 1
  }

  // 8. 均线斜率(0-5)
  if (ma5Slope > 0.3 && ma10Slope > 0.2) score += 5
  else if (ma5Slope > 0.2 && ma10Slope > 0.1) score += 3
  else if (ma5Slope > 0.1 && ma10Slope > 0) score += 2
  else if (ma5Slope < -0.3) score -= 2

  // 9. 形态识别(0-15) 简化版
  var pt = (patterns.cupHandle || 0) + (patterns.breakout || 0) + (patterns.pullbackRestart || 0) + (patterns.consecutiveUp || 0) + (patterns.bottomReversal || 0) + (patterns.maSupport || 0)
  score += Math.min(15, pt)

  // 10. 振幅(0-3)
  if (amplitude >= 3 && amplitude <= 6) score += 3
  else if (amplitude >= 2 && amplitude < 3) score += 1

  // 11. RSI(0-4)
  if (rsi >= 50 && rsi <= 65) score += 4
  else if (rsi >= 40 && rsi < 50) score += 2
  else if (rsi > 65 && rsi <= 75) score += 1

  // 12. BOLL(0-3)
  if (bollPosition >= 0.5 && bollPosition < 0.8) score += 3
  else if (bollPosition >= 0.3 && bollPosition < 0.5) score += 1

  // 13. 基本面(0-5)
  var f = 0
  if ((stock.roe || 0) >= 15) f += 2
  else if ((stock.roe || 0) >= 10) f += 1
  if (stock.pe > 0 && stock.pe <= 25) f += 2
  else if (stock.pe > 25 && stock.pe <= 40) f += 1
  if ((stock.debtRatio || 0) > 0 && stock.debtRatio <= 50) f += 1
  score += f

  // 14. 共振(0-5)
  var rc = 0
  if (chg >= 1.5 && chg <= 4) rc++
  if (volumeRatio >= 1.5 && volumeRatio <= 2.5) rc++
  if (maSignal === "bull") rc++
  if (adx >= 20 && plusDI > minusDI) rc++
  if (obvTrend === 1) rc++
  if (rc >= 5) score += 5
  else if (rc >= 4) score += 3
  else if (rc >= 3) score += 1

  // 15. 风险过滤
  if (chg > 6 && volumeRatio > 4) score -= 5
  if (rsi > 78) score -= 4
  if (change5d > 20) score -= 3
  if (maSignal === "bear") score -= 5
  if (ma60 > 0 && price > ma60 * 1.3) score -= 2
  if (obvTrend === -1 && chg > 3) score -= 3

  return Math.round(Math.min(100, Math.max(0, score)))
}


// V17 - V10基础 + 形态/动量确认加分版
function calcTechScoreV17(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData) {
  // 先算V10基础分
  var baseScore = calcTechScoreV10(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData)
  var bonus = 0
  var patterns = techData ? (techData.patterns || {}) : {}
  var adx = techData ? (techData.adx || 0) : 0
  var plusDI = techData ? (techData.plusDI || 0) : 0
  var minusDI = techData ? (techData.minusDI || 0) : 0
  var obvTrend = techData ? (techData.obvTrend || 0) : 0
  var obvSlope5 = techData ? (techData.obvSlope5 || 0) : 0
  var ma5Slope = techData ? (techData.ma5Slope || 0) : 0
  var ma10Slope = techData ? (techData.ma10Slope || 0) : 0
  var price = stock.price || 0
  var chg = stock.changePct || 0

  // 1. 形态加分(0-10)
  var patternBonus = 0
  if (patterns.cupHandle >= 3) patternBonus += 3
  if (patterns.breakout >= 3) patternBonus += 3
  if (patterns.pullbackRestart >= 3) patternBonus += 3
  if (patterns.consecutiveUp >= 3) patternBonus += 2
  if (patterns.bottomReversal >= 3) patternBonus += 2
  if (patterns.maSupport >= 3) patternBonus += 2
  bonus += Math.min(10, patternBonus)

  // 2. ADX/OBV确认(0-8)
  if (adx >= 25 && plusDI > minusDI) bonus += 4
  else if (adx >= 20 && plusDI > minusDI) bonus += 2
  if (obvTrend === 1) bonus += 2
  if (obvSlope5 > 0.05) bonus += 2

  // 3. 均线斜率(0-4)
  if (ma5Slope > 0.2 && ma10Slope > 0.1) bonus += 4
  else if (ma5Slope > 0.1 && ma10Slope > 0) bonus += 2

  // 4. 量价背离扣分
  if (obvTrend === -1 && chg > 3) bonus -= 5

  return Math.round(Math.min(100, Math.max(0, baseScore + bonus)))
}
// V18 - V10基础 + 更大形态/动量加分 + 无形态减分
function calcTechScoreV18(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData) {
  var baseScore = calcTechScoreV10(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData)
  var bonus = 0
  var patterns = techData ? (techData.patterns || {}) : {}
  var adx = techData ? (techData.adx || 0) : 0
  var plusDI = techData ? (techData.plusDI || 0) : 0
  var minusDI = techData ? (techData.minusDI || 0) : 0
  var obvTrend = techData ? (techData.obvTrend || 0) : 0
  var obvSlope5 = techData ? (techData.obvSlope5 || 0) : 0
  var ma5Slope = techData ? (techData.ma5Slope || 0) : 0
  var ma10Slope = techData ? (techData.ma10Slope || 0) : 0
  var price = stock.price || 0
  var chg = stock.changePct || 0

  // 1. 形态加分(0-20) - 更大加分
  var patternBonus = 0
  patternBonus += (patterns.cupHandle || 0)
  patternBonus += (patterns.breakout || 0)
  patternBonus += (patterns.pullbackRestart || 0)
  patternBonus += (patterns.consecutiveUp || 0)
  patternBonus += (patterns.bottomReversal || 0)
  patternBonus += (patterns.maSupport || 0)
  bonus += Math.min(20, patternBonus)

  // 2. 无形态减分 - 如果没有任何形态得分
  if (patternBonus === 0) bonus -= 5

  // 3. ADX/OBV确认(0-10)
  if (adx >= 30 && plusDI > minusDI) bonus += 5
  else if (adx >= 25 && plusDI > minusDI) bonus += 3
  else if (adx >= 20 && plusDI > minusDI) bonus += 1
  if (obvTrend === 1 && obvSlope5 > 0.05) bonus += 3
  else if (obvTrend === 1) bonus += 2
  else if (obvSlope5 > 0.05) bonus += 1

  // 4. 均线斜率(0-5)
  if (ma5Slope > 0.3 && ma10Slope > 0.2) bonus += 5
  else if (ma5Slope > 0.2 && ma10Slope > 0.1) bonus += 3
  else if (ma5Slope > 0.1) bonus += 1

  // 5. 量价背离扣分
  if (obvTrend === -1 && chg > 3) bonus -= 5
  if (obvSlope5 < -0.1 && chg > 2) bonus -= 3

  return Math.round(Math.min(100, Math.max(0, baseScore + bonus)))
}


// V19 - V10与形态动量的混合排名版
// 最终分 = V10分数(50%) + 形态动量质量分(50%)
function calcTechScoreV19(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData) {
  var v10Score = calcTechScoreV10(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData)
  var patterns = techData ? (techData.patterns || {}) : {}
  var adx = techData ? (techData.adx || 0) : 0
  var plusDI = techData ? (techData.plusDI || 0) : 0
  var minusDI = techData ? (techData.minusDI || 0) : 0
  var obvTrend = techData ? (techData.obvTrend || 0) : 0
  var obvSlope5 = techData ? (techData.obvSlope5 || 0) : 0
  var ma5Slope = techData ? (techData.ma5Slope || 0) : 0
  var ma10Slope = techData ? (techData.ma10Slope || 0) : 0

  // 形态质量分(0-30)
  var patternScore = (patterns.cupHandle || 0) + (patterns.breakout || 0) + (patterns.pullbackRestart || 0) + (patterns.consecutiveUp || 0) + (patterns.bottomReversal || 0) + (patterns.maSupport || 0)
  patternScore = Math.min(30, patternScore)

  // 动量质量分(0-20)
  var momentumScore = 0
  if (adx >= 25 && plusDI > minusDI) momentumScore += 8
  else if (adx >= 20 && plusDI > minusDI) momentumScore += 4
  if (obvTrend === 1) momentumScore += 5
  if (obvSlope5 > 0.05) momentumScore += 4
  if (ma5Slope > 0.2 && ma10Slope > 0.1) momentumScore += 3
  momentumScore = Math.min(20, momentumScore)

  // 混合分 = V10 × 0.5 + 质量分
  var qualityScore = patternScore + momentumScore
  var finalScore = v10Score * 0.5 + qualityScore

  return Math.round(Math.min(100, Math.max(0, finalScore)))
}

// V20 - V10评分 + 形态过滤(至少一个强形态)
function calcTechScoreV20(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData) {
  var patterns = techData ? (techData.patterns || {}) : {}
  // 必须至少有一个形态得分>=3
  var hasPattern = (patterns.cupHandle >= 3 || patterns.breakout >= 3 || patterns.pullbackRestart >= 3 || patterns.consecutiveUp >= 3 || patterns.bottomReversal >= 3 || patterns.maSupport >= 3)
  if (!hasPattern) return 0 // 无形态直接0分不入选
  return calcTechScoreV10(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData)
}

// V21 - V16评分 + 形态过滤
function calcTechScoreV21(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData) {
  var patterns = techData ? (techData.patterns || {}) : {}
  var hasPattern = (patterns.cupHandle >= 3 || patterns.breakout >= 3 || patterns.pullbackRestart >= 3 || patterns.consecutiveUp >= 3 || patterns.bottomReversal >= 3 || patterns.maSupport >= 3)
  if (!hasPattern) return 0
  return calcTechScoreV16(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData)
}


// V22 - V10 + ADX/OBV momentum confirm(0-8) + risk filter
// Keep V10 structure, add small confirm bonus, avoid score distortion
function calcTechScoreV22(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData) {
  var baseScore = calcTechScoreV10(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData)
  var bonus = 0
  var adx = techData ? (techData.adx || 0) : 0
  var plusDI = techData ? (techData.plusDI || 0) : 0
  var minusDI = techData ? (techData.minusDI || 0) : 0
  var obvTrend = techData ? (techData.obvTrend || 0) : 0
  var obvSlope5 = techData ? (techData.obvSlope5 || 0) : 0
  var chg = stock.changePct || 0
  var maSignal = techData ? (techData.maSignal || "neutral") : "neutral"

  // momentum confirm bonus(0-8)
  if (adx >= 25 && plusDI > minusDI) bonus += 4
  else if (adx >= 20 && plusDI > minusDI) bonus += 2
  if (obvTrend === 1 && obvSlope5 > 0.1) bonus += 4
  else if (obvTrend === 1) bonus += 2
  else if (obvSlope5 > 0.1) bonus += 2

  // risk filter penalty
  if (chg > 6 && volumeRatio > 4) bonus -= 5
  if (rsi > 78) bonus -= 4
  if (change5d > 20) bonus -= 3
  if (maSignal === "bear") bonus -= 5
  if (obvTrend === -1 && chg > 3) bonus -= 3

  return Math.round(Math.min(100, Math.max(0, baseScore + bonus)))
}

// V23 - V16 + volumeRatio weight boost (0-8 -> 0-13)
// V16 has best 10d stats but 5d winrate low, likely due to low volumeRatio weight
function calcTechScoreV23(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData) {
  var score = 0
  var chg = stock.changePct || 0
  var isGem = code.startsWith(String.fromCharCode(51,48,48)) || code.startsWith(String.fromCharCode(51,48,49)) || code.startsWith(String.fromCharCode(54,56,56))
  var maSignal = techData ? (techData.maSignal || "neutral") : "neutral"
  var momentum20 = techData ? (techData.momentum20 || 0) : 0
  var ma5 = techData ? (techData.ma5 || 0) : 0
  var ma10 = techData ? (techData.ma10 || 0) : 0
  var ma20 = techData ? (techData.ma20 || 0) : 0
  var ma60 = techData ? (techData.ma60 || 0) : 0
  var macdObj = techData ? (techData.macdObj || {}) : {}
  var price = stock.price || 0
  var amplitude = stock.amplitude || 0
  var adx = techData ? (techData.adx || 0) : 0
  var plusDI = techData ? (techData.plusDI || 0) : 0
  var minusDI = techData ? (techData.minusDI || 0) : 0
  var obvTrend = techData ? (techData.obvTrend || 0) : 0
  var obvSlope5 = techData ? (techData.obvSlope5 || 0) : 0
  var ma5Slope = techData ? (techData.ma5Slope || 0) : 0
  var ma10Slope = techData ? (techData.ma10Slope || 0) : 0
  var atr = techData ? (techData.atr || 0) : 0
  var patterns = techData ? (techData.patterns || {}) : {}

  // 1. chg(0-10) reduced from V16 0-12
  if (isGem) {
    if (chg >= 1.5 && chg <= 4) score += 10
    else if (chg >= 1 && chg < 1.5) score += 7
    else if (chg > 4 && chg <= 7) score += 5
    else if (chg > 7 && chg <= 10) score += 2
    else if (chg > 10) score += 1
    else if (chg >= 0 && chg < 1) score += 3
    else score += Math.max(0, 1 + chg)
  } else {
    if (chg >= 1.5 && chg <= 4) score += 10
    else if (chg >= 1 && chg < 1.5) score += 7
    else if (chg > 4 && chg <= 6) score += 4
    else if (chg > 6) score += 1
    else if (chg >= 0 && chg < 1) score += 3
    else score += Math.max(0, 1 + chg)
  }

  // 2. volumeRatio(0-13) boosted from V16 0-8
  if (volumeRatio >= 1.5 && volumeRatio <= 2.5) score += 13
  else if (volumeRatio >= 1.0 && volumeRatio < 1.5) score += 9
  else if (volumeRatio > 2.5 && volumeRatio <= 4) score += 5
  else if (volumeRatio > 4 && volumeRatio <= 6) score += 2
  else if (volumeRatio > 6) score += 1
  else if (volumeRatio >= 0.5) score += 1

  // 3. trend(0-12)
  var ts = 0
  if (maSignal === "bull") ts += 4
  if (price > 0 && ma5 > 0 && ma10 > 0) {
    if (price > ma5 && price > ma10) ts += 2
    else if (price > ma5 || price > ma10) ts += 1
  }
  if (goldenCross) ts += 3
  else if (macdObj.dif > 0 && macdObj.dea > 0) ts += 1
  if (change5d >= 5 && change5d <= 15) ts += 2
  else if (change5d >= 3) ts += 1
  if (momentum20 >= 5 && momentum20 <= 20) ts += 1
  score += ts

  // 4. price-volume(0-8)
  var ps = 0
  if (chg >= 1 && volumeRatio >= 1.5 && maSignal === "bull") ps += 3
  else if (chg >= 1 && volumeRatio >= 1.5) ps += 1
  if (chg >= 1 && chg <= 4 && volumeRatio >= 1 && volumeRatio <= 2.5 && amplitude >= 2 && amplitude <= 6) ps += 3
  if (rsi < 50 && rsi > 30 && volumeRatio >= 1.5 && goldenCross) ps += 2
  score += ps

  // 5. ADX(0-8)
  if (adx >= 30 && plusDI > minusDI) score += 8
  else if (adx >= 25 && plusDI > minusDI) score += 6
  else if (adx >= 20 && plusDI > minusDI) score += 4
  else if (adx >= 20) score += 2
  else if (adx >= 15 && plusDI > minusDI) score += 2

  // 6. OBV(0-7)
  if (obvTrend === 1 && obvSlope5 > 0.1) score += 7
  else if (obvTrend === 1 && obvSlope5 > 0) score += 5
  else if (obvTrend === 1) score += 3
  else if (obvSlope5 > 0.1) score += 2
  else if (obvSlope5 < -0.1) score -= 3

  // 7. ATR(0-5)
  if (atr > 0 && price > 0) {
    var atrPct = atr / price * 100
    if (atrPct >= 2 && atrPct <= 4) score += 5
    else if (atrPct >= 1.5 && atrPct < 2) score += 3
    else if (atrPct > 4 && atrPct <= 5) score += 2
    else if (atrPct > 5) score -= 1
  }

  // 8. MA slope(0-5)
  if (ma5Slope > 0.3 && ma10Slope > 0.2) score += 5
  else if (ma5Slope > 0.2 && ma10Slope > 0.1) score += 3
  else if (ma5Slope > 0.1 && ma10Slope > 0) score += 2
  else if (ma5Slope < -0.3) score -= 2

  // 9. pattern(0-10) reduced from V16 0-15
  var pt = (patterns.cupHandle || 0) + (patterns.breakout || 0) + (patterns.pullbackRestart || 0) + (patterns.consecutiveUp || 0) + (patterns.bottomReversal || 0) + (patterns.maSupport || 0)
  score += Math.min(10, pt)

  // 10. amplitude(0-3)
  if (amplitude >= 3 && amplitude <= 6) score += 3
  else if (amplitude >= 2 && amplitude < 3) score += 1

  // 11. RSI(0-4)
  if (rsi >= 50 && rsi <= 65) score += 4
  else if (rsi >= 40 && rsi < 50) score += 2
  else if (rsi > 65 && rsi <= 75) score += 1

  // 12. BOLL(0-3)
  if (bollPosition >= 0.5 && bollPosition < 0.8) score += 3
  else if (bollPosition >= 0.3 && bollPosition < 0.5) score += 1

  // 13. fundamental(0-5)
  var f = 0
  if ((stock.roe || 0) >= 15) f += 2
  else if ((stock.roe || 0) >= 10) f += 1
  if (stock.pe > 0 && stock.pe <= 25) f += 2
  else if (stock.pe > 25 && stock.pe <= 40) f += 1
  if ((stock.debtRatio || 0) > 0 && stock.debtRatio <= 50) f += 1
  score += f

  // 14. resonance(0-2) reduced from V16 0-5
  var rc = 0
  if (chg >= 1.5 && chg <= 4) rc++
  if (volumeRatio >= 1.5 && volumeRatio <= 2.5) rc++
  if (maSignal === "bull") rc++
  if (adx >= 20 && plusDI > minusDI) rc++
  if (obvTrend === 1) rc++
  if (rc >= 5) score += 2
  else if (rc >= 4) score += 1

  // 15. risk filter same as V16
  if (chg > 6 && volumeRatio > 4) score -= 5
  if (rsi > 78) score -= 4
  if (change5d > 20) score -= 3
  if (maSignal === "bear") score -= 5
  if (ma60 > 0 && price > ma60 * 1.3) score -= 2
  if (obvTrend === -1 && chg > 3) score -= 3

  return Math.round(Math.min(100, Math.max(0, score)))
}

// V24 - V10 + momentum filter (not bonus, but hard filter)
// Require ADX confirmation or OBV uptrend, keep V10 score distribution
function calcTechScoreV24(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData) {
  var adx = techData ? (techData.adx || 0) : 0
  var plusDI = techData ? (techData.plusDI || 0) : 0
  var minusDI = techData ? (techData.minusDI || 0) : 0
  var obvTrend = techData ? (techData.obvTrend || 0) : 0
  var obvSlope5 = techData ? (techData.obvSlope5 || 0) : 0
  // Must have momentum confirmation: ADX>=20 & +DI>-DI OR OBV uptrend
  var hasADX = adx >= 20 && plusDI > minusDI
  var hasOBV = obvTrend === 1 || obvSlope5 > 0
  if (!hasADX && !hasOBV) return 0
  return calcTechScoreV10(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData)
}

// V25 - V10 + volumeRatio weight boost (0-15 -> 0-18)
// Boost volumeRatio from 15 to 18, reduce trend from 25 to 22
function calcTechScoreV25(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData) {
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

  // 1. chg(0-20) same as V10
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

  // 2. volumeRatio(0-18) boosted from V10 0-15
  if (volumeRatio >= 1.5 && volumeRatio <= 2.5) score += 18
  else if (volumeRatio >= 1.0 && volumeRatio < 1.5) score += 12
  else if (volumeRatio > 2.5 && volumeRatio <= 4) score += 10
  else if (volumeRatio > 4 && volumeRatio <= 6) score += 5
  else if (volumeRatio > 6) score += 1
  else if (volumeRatio >= 0.5 && volumeRatio < 1.0) score += 3

  // 3. trend(0-22) reduced from V10 0-25
  var trendScore = 0
  if (maSignal === "bull") trendScore += 7
  if (price > 0 && ma5 > 0 && ma10 > 0) {
    if (price > ma5 && price > ma10) trendScore += 5
    else if (price > ma5 || price > ma10) trendScore += 2
  }
  if (goldenCross) trendScore += 4
  else if (macdObj.dif > 0 && macdObj.dea > 0) trendScore += 2
  if (change5d >= 5 && change5d <= 15) trendScore += 3
  else if (change5d >= 3 && change5d < 5) trendScore += 2
  else if (change5d >= 15 && change5d <= 25) trendScore += 1
  if (momentum20 >= 8 && momentum20 <= 25) trendScore += 3
  else if (momentum20 >= 3 && momentum20 < 8) trendScore += 1
  score += Math.min(22, trendScore)

  // 4-8 same as V10
  var patternScore = 0
  if (chg >= 1 && volumeRatio >= 1.5 && maSignal === "bull") patternScore += 6
  else if (chg >= 1 && volumeRatio >= 1.5) patternScore += 3
  if (chg >= 1 && chg <= 4 && volumeRatio >= 1 && volumeRatio <= 2.5 && amplitude >= 2 && amplitude <= 6) patternScore += 5
  if (rsi < 50 && rsi > 30 && volumeRatio >= 1.5 && goldenCross) patternScore += 4
  score += patternScore

  if (amplitude >= 3 && amplitude <= 6) score += 5
  else if (amplitude >= 2 && amplitude < 3) score += 3
  else if (amplitude > 6 && amplitude <= 8) score += 2

  if (rsi >= 50 && rsi <= 65) score += 5
  else if (rsi >= 40 && rsi < 50) score += 3
  else if (rsi > 65 && rsi <= 75) score += 2
  else if (rsi > 75) score -= 2

  if (bollPosition >= 0.5 && bollPosition < 0.8) score += 5
  else if (bollPosition >= 0.3 && bollPosition < 0.5) score += 3
  else if (bollPosition >= 0.8) score += 2

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

// V26 - V25 score + V24 momentum filter
function calcTechScoreV26(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData) {
  var adx = techData ? (techData.adx || 0) : 0
  var plusDI = techData ? (techData.plusDI || 0) : 0
  var minusDI = techData ? (techData.minusDI || 0) : 0
  var obvTrend = techData ? (techData.obvTrend || 0) : 0
  var obvSlope5 = techData ? (techData.obvSlope5 || 0) : 0
  var hasADX = adx >= 20 && plusDI > minusDI
  var hasOBV = obvTrend === 1 || obvSlope5 > 0
  if (!hasADX && !hasOBV) return 0
  return calcTechScoreV25(stock, rsi, goldenCross, volumeRatio, bollPosition, code, change5d, techData)
}
module.exports = {
  calcTechScoreV24,
  calcTechScoreV25,
  calcTechScoreV26,
  calcTechScoreV22,
  calcTechScoreV23,
  calcTechScoreV19,
  calcTechScoreV20,
  calcTechScoreV21,
  calcTechScoreV17,
  calcTechScoreV18,
  calcTechScoreV15,
  calcTechScoreV16,
  calcTechScoreV13,
  calcTechScoreV14,
  calcTechScoreV12,
  calcTechScoreV11,
  calcTechScoreV10,
  getLimitPct,
  calcTechScoreOriginal,
  calcTechScoreOptimized,
}


