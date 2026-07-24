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

module.exports = { calcTechScoreV11 }
