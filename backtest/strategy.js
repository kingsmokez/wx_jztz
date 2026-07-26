/**
 * 策略模块 - V73当前策略 + V74优化策略
 * 提供策略筛选函数，返回是否通过以及rankingScore
 */
var tech = require('./tech')

// V73当前策略(基准)
function strategyV73(stock, klines, config) {
  if (!klines || klines.length < 30) return { pass: false, score: 0 }
  var t = tech.calcTech(klines)
  if (!t) return { pass: false, score: 0 }
  var changePct = stock.changePct || 0
  var volumeRatio = stock.volumeRatio || 0
  if (volumeRatio <= 0.5) {
    var to = stock.turnover || 0
    if (to > 0) volumeRatio = to < 0.5 ? 0.5 : to < 2 ? 1.0 + to * 0.3 : 1.5 + (to - 2) * 0.2
    else volumeRatio = 1.0
  }

  // boll_squeeze检测
  var hasBollSqueeze = false
  if (t.bollWidth < config.bollSqueezeWidth && t.bollPosition > config.bollPositionMin) hasBollSqueeze = true
  if (t.bollWidth < config.bollSqueezeWidthAlt && volumeRatio >= 1.5) hasBollSqueeze = true
  if (!hasBollSqueeze && klines.length >= 8) {
    var lastK = klines[klines.length - 1]
    var high5 = -Infinity, low5 = Infinity
    for (var bi = klines.length - 8; bi < klines.length - 1; bi++) {
      if (klines[bi].high > high5) high5 = klines[bi].high
      if (klines[bi].low < low5) low5 = klines[bi].low
    }
    if (low5 > 0 && ((high5 - low5) / low5 * 100) < 5 && lastK.close > high5) hasBollSqueeze = true
  }
  if (!hasBollSqueeze) return { pass: false, score: 0 }

  // 硬过滤
  if (changePct < config.changePctMin || changePct > config.changePctMax) return { pass: false, score: 0 }
  if (t.rsi > config.rsiMax) return { pass: false, score: 0 }
  if (volumeRatio < config.volumeRatioMin) return { pass: false, score: 0 }
  if (t.adx < config.adxMin || t.plusDI <= t.minusDI) return { pass: false, score: 0 }
  if (t.bollPosition > config.bollPositionMax) return { pass: false, score: 0 }
  if (t.ma5Slope < config.ma5SlopeMin) return { pass: false, score: 0 }
  if (t.ma10Slope < config.ma10SlopeMin) return { pass: false, score: 0 }
  var consecUp = tech.calcConsecutiveUpDays(klines)
  if (consecUp > config.maxConsecUp) return { pass: false, score: 0 }
  var pricePosVsHigh = tech.calcPricePositionVsHigh(klines)
  if (pricePosVsHigh < config.pricePosVsHighMin) return { pass: false, score: 0 }
  if (volumeRatio < 1.5) return { pass: false, score: 0 }
  var relStrength = tech.calcRelativeStrength(klines)
  if (relStrength < config.relativeStrengthMin) return { pass: false, score: 0 }

  // 简化评分
  var score = 60
  if (changePct >= 1.5 && changePct <= 2.2) score += 10
  if (volumeRatio >= 1.8 && volumeRatio <= 3) score += 10
  if (t.rsi >= 45 && t.rsi <= 55) score += 8
  if (t.goldenCross) score += 5
  if (t.bollPosition >= 0.75 && t.bollPosition <= 0.85) score += 5
  score = Math.min(100, score)

  if (score < config.rankingScoreMin) return { pass: false, score: 0 }
  return { pass: true, score: score, tech: t, volumeRatio: volumeRatio }
}

// V74优化策略: 放宽条件+新增形态+动态权重
function strategyV74(stock, klines, config) {
  if (!klines || klines.length < 30) return { pass: false, score: 0 }
  var t = tech.calcTech(klines)
  if (!t) return { pass: false, score: 0 }
  var changePct = stock.changePct || 0
  var volumeRatio = stock.volumeRatio || 0
  if (volumeRatio <= 0.5) {
    var to = stock.turnover || 0
    if (to > 0) volumeRatio = to < 0.5 ? 0.5 : to < 2 ? 1.0 + to * 0.3 : 1.5 + (to - 2) * 0.2
    else volumeRatio = 1.0
  }

  // === 新形态1: boll_squeeze(放宽) ===
  var hasBollSqueeze = false
  if (t.bollWidth < 0.10 && t.bollPosition > 0.65) hasBollSqueeze = true
  if (t.bollWidth < 0.08 && volumeRatio >= 1.3) hasBollSqueeze = true
  if (!hasBollSqueeze && klines.length >= 8) {
    var lastK = klines[klines.length - 1]
    var high5 = -Infinity, low5 = Infinity
    for (var bi = klines.length - 8; bi < klines.length - 1; bi++) {
      if (klines[bi].high > high5) high5 = klines[bi].high
      if (klines[bi].low < low5) low5 = klines[bi].low
    }
    if (low5 > 0 && ((high5 - low5) / low5 * 100) < 6 && lastK.close > high5) hasBollSqueeze = true
  }

  // === 新形态2: 均线多头排列+缩量回踩(MA支撑反弹) ===
  var hasMASupport = false
  if (t.maSignal === 'bull' && t.ma5Slope > 0.1 && t.ma10Slope > 0.02) {
    var price = klines[klines.length - 1].close
    var prevLow = klines[klines.length - 2].low
    if (prevLow <= t.ma5 * 1.02 && price > t.ma5) hasMASupport = true
    if (prevLow <= t.ma10 * 1.02 && price > t.ma10) hasMASupport = true
  }

  // === 新形态3: 放量突破20日新高(趋势启动) ===
  var hasBreakout20d = false
  if (klines.length >= 21 && volumeRatio >= 1.5) {
    var high20 = -Infinity
    for (var bi = klines.length - 21; bi < klines.length - 1; bi++) {
      if (klines[bi].high > high20) high20 = klines[bi].high
    }
    if (klines[klines.length - 1].close > high20) hasBreakout20d = true
  }

  // === 新形态4: MACD金叉+放量(MACD复苏) ===
  var hasMACDRevival = false
  if (t.goldenCross && t.macd > 0 && volumeRatio >= 1.2) hasMACDRevival = true

  // 必须满足至少一个形态
  if (!hasBollSqueeze && !hasMASupport && !hasBreakout20d && !hasMACDRevival) {
    return { pass: false, score: 0 }
  }

  // === 放宽硬过滤 ===
  if (changePct < 0.5 || changePct > 4) return { pass: false, score: 0 }
  if (t.rsi > 68) return { pass: false, score: 0 }
  if (volumeRatio < 1.2) return { pass: false, score: 0 }
  if (t.adx < 20 || t.plusDI <= t.minusDI) return { pass: false, score: 0 }
  if (t.bollPosition > 0.92) return { pass: false, score: 0 }
  if (t.ma5Slope < 0) return { pass: false, score: 0 }
  if (t.ma10Slope < -0.5) return { pass: false, score: 0 }
  var consecUp = tech.calcConsecutiveUpDays(klines)
  if (consecUp > 6) return { pass: false, score: 0 }
  var pricePosVsHigh = tech.calcPricePositionVsHigh(klines)
  if (pricePosVsHigh < 0.90) return { pass: false, score: 0 }
  var relStrength = tech.calcRelativeStrength(klines)
  if (relStrength < 3) return { pass: false, score: 0 }

  // === 动态评分(多形态加权) ===
  var score = 50
  // 形态加分
  if (hasBollSqueeze) score += 12
  if (hasMASupport) score += 10
  if (hasBreakout20d) score += 15
  if (hasMACDRevival) score += 8
  // 涨幅最优区间
  if (changePct >= 1 && changePct <= 3) score += 10
  else if (changePct >= 0.5 && changePct < 1) score += 5
  // 量比最优区间
  if (volumeRatio >= 1.5 && volumeRatio <= 3) score += 10
  else if (volumeRatio >= 1.2 && volumeRatio < 1.5) score += 6
  // RSI最优区间
  if (t.rsi >= 45 && t.rsi <= 60) score += 8
  else if (t.rsi >= 35 && t.rsi < 45) score += 5
  // ADX强趋势
  if (t.adx >= 30) score += 8
  else if (t.adx >= 25) score += 5
  // 金叉
  if (t.goldenCross) score += 5
  // 布林位置
  if (t.bollPosition >= 0.7 && t.bollPosition <= 0.85) score += 5
  // 5日动量
  if (t.momentum5d >= 5 && t.momentum5d <= 15) score += 5
  // 相对强度
  if (relStrength >= 8) score += 5
  score = Math.min(100, score)

  if (score < 60) return { pass: false, score: 0 }
  return { pass: true, score: score, tech: t, volumeRatio: volumeRatio,
    patterns: { bollSqueeze: hasBollSqueeze, maSupport: hasMASupport, breakout20d: hasBreakout20d, macdRevival: hasMACDRevival }
  }
}

module.exports = { strategyV73: strategyV73, strategyV74: strategyV74 }
