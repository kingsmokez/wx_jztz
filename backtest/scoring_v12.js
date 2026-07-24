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

module.exports = { calcTechScoreV12 }
