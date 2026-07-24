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

module.exports = { calcTechScoreV13 }
