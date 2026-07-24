const fs = require('fs');
let scoring = fs.readFileSync('scoring.js', 'utf8');

const v14Code = `
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
`;

// 在module.exports前插入V14
const moduleIdx = scoring.indexOf('module.exports');
if (moduleIdx === -1) throw new Error('module.exports not found');
scoring = scoring.substring(0, moduleIdx) + v14Code + '\n' + scoring.substring(moduleIdx);
fs.writeFileSync('scoring.js', scoring, 'utf8');
console.log('V14 added to scoring.js');
