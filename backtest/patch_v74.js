const fs = require('fs');
const path = 'D:/wx_jztz/backtest/run_v74.js';
let code = fs.readFileSync(path, 'utf8');

// 1. 替换标题
code = code.replace(
  "V73 Strategy Backtest: RSI阈值精细搜索",
  "V74 Strategy Backtest: 多形态融合+放宽参数+扩大选股"
);

// 2. 替换calcPatternScore函数为calcPatternScoreV74（增加新形态）
const oldPatternFunc = code.indexOf('function calcPatternScore(stock, klines, dateIdx, tech, volumeRatio)');
const oldPatternEnd = code.indexOf('function calcConsecutiveUpDays(');

if (oldPatternFunc > 0 && oldPatternEnd > 0) {
  const newPatternFunc = `function calcPatternScore(stock, klines, dateIdx, tech, volumeRatio) {
  if (!klines || dateIdx < 20 || !tech) return { pattern: 'none', score: 0 }
  var closes = []
  for (var i = 0; i <= dateIdx; i++) closes.push(klines[i].close)
  var chg = stock.changePct || 0
  var bestScore = 0, bestPattern = 'none'
  var ma5 = tech.ma5 || 0, ma10 = tech.ma10 || 0, ma20 = tech.ma20 || 0
  var ma5Slope = tech.ma5Slope || 0, ma10Slope = tech.ma10Slope || 0
  var rsi = tech.rsi || 50, bollPos = tech.bollPosition || 0.5
  var price = stock.price || klines[dateIdx].close

  // === 形态1: boll_squeeze(放宽: 宽度<0.10, 位置>0.65) ===
  var bollWidth = calcBollWidth(closes)
  if (bollWidth < 0.10 && chg >= 1 && volumeRatio >= 1.2 && ma5Slope > 0) {
    var s = 15
    if (bollPos > 0.75) s += 6
    else if (bollPos > 0.65) s += 4
    if (bollWidth < 0.06) s += 5
    else if (bollWidth < 0.08) s += 3
    if (volumeRatio >= 2) s += 3
    else if (volumeRatio >= 1.5) s += 1
    if (rsi >= 50 && rsi <= 65) s += 3
    if (s > bestScore) { bestScore = s; bestPattern = 'boll_squeeze' }
  }

  // === 形态2: MA支撑反弹(均线多头+缩量回踩+放量反弹) ===
  if (ma5 > 0 && ma10 > 0 && ma20 > 0 && ma5 > ma10 && ma10 > ma20) {
    var touchedMA5 = false, touchedMA10 = false
    for (var i = Math.max(1, dateIdx - 3); i < dateIdx; i++) {
      if (klines[i].low <= ma5 * 1.01 && klines[i].low >= ma5 * 0.98) touchedMA5 = true
      if (klines[i].low <= ma10 * 1.02 && klines[i].low >= ma10 * 0.98) touchedMA10 = true
    }
    if ((touchedMA5 || touchedMA10) && chg >= 1 && volumeRatio >= 1.2) {
      var s = 14
      if (touchedMA5) s += 4
      if (touchedMA10) s += 3
      if (chg >= 2) s += 3
      else if (chg >= 1.5) s += 2
      if (volumeRatio >= 2) s += 3
      else if (volumeRatio >= 1.5) s += 1
      if (rsi >= 45 && rsi <= 65) s += 3
      if (tech.adx >= 20) s += 2
      if (s > bestScore) { bestScore = s; bestPattern = 'ma_support_bounce' }
    }
  }

  // === 形态3: 放量突破20日新高 ===
  if (dateIdx >= 20) {
    var high20 = -Infinity
    for (var i = dateIdx - 20; i < dateIdx; i++) { if (klines[i].high > high20) high20 = klines[i].high }
    if (high20 > 0 && price > high20 && chg >= 1 && volumeRatio >= 1.5) {
      var s = 13
      if (price > high20 * 1.02) s += 3
      if (volumeRatio >= 2.5) s += 4
      else if (volumeRatio >= 2) s += 2
      if (rsi >= 50 && rsi <= 70) s += 3
      if (tech.adx >= 20) s += 2
      if (bollPos >= 0.7) s += 2
      if (s > bestScore) { bestScore = s; bestPattern = 'breakout_20d_high' }
    }
  }

  // === 形态4: MACD金叉+放量 ===
  if (tech.goldenCross && chg >= 0.5 && volumeRatio >= 1.5) {
    var s = 12
    if (chg >= 2) s += 3
    else if (chg >= 1) s += 2
    if (volumeRatio >= 2) s += 3
    else if (volumeRatio >= 1.8) s += 1
    if (rsi >= 45 && rsi <= 65) s += 3
    else if (rsi >= 40 && rsi <= 70) s += 1
    if (ma5Slope > 0) s += 2
    if (tech.adx >= 20) s += 2
    if (bollPos >= 0.6) s += 1
    if (s > bestScore) { bestScore = s; bestPattern = 'macd_golden_vol' }
  }

  // === 形态5: 平台突破 ===
  var narrow5 = detectNarrowRange(klines, dateIdx, 5, 5)
  var narrow8 = detectNarrowRange(klines, dateIdx, 8, 6)
  if ((narrow5 || narrow8) && chg >= 2 && volumeRatio >= 1.5) {
    var s = 14
    if (narrow5) s += 4
    if (chg >= 3) s += 3
    if (volumeRatio >= 2) s += 3
    if (ma5Slope > 0) s += 2
    if (price > ma20) s += 2
    if (s > bestScore) { bestScore = s; bestPattern = 'platform_break' }
  }

  // === 形态6: 缩量回踩再启动 ===
  var pullback = detectShrinkPullback(klines, dateIdx, 6)
  if (pullback.detected && chg >= 1 && volumeRatio >= 1.5) {
    var s = 13
    if (price > ma10 && price < ma10 * 1.05) s += 4
    if (rsi >= 40 && rsi <= 65) s += 3
    if (chg >= 2) s += 3
    if (volumeRatio >= 2) s += 2
    if (s > bestScore) { bestScore = s; bestPattern = 'pullback_restart' }
  }

  return { pattern: bestPattern, score: bestScore, isGapUp: false }
}

`;
  code = code.substring(0, oldPatternFunc) + newPatternFunc + code.substring(oldPatternEnd);
  console.log('Pattern function replaced');
}

fs.writeFileSync(path, code, 'utf8');
console.log('V74 file updated');
