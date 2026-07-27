function detectAscendingChannelBreakout(klines, dateIdx) {
  if (dateIdx < 25 || dateIdx >= klines.length) return { detected: false, score: 0 }
  // 取20天: 前10天(通道前半段) + 中9天(通道后半段,不含今天) + 今天(突破确认)
  var recent = klines.slice(dateIdx - 19, dateIdx + 1)
  if (recent.length < 20) return { detected: false, score: 0 }

  var firstHalf = recent.slice(0, 10)   // bar 0-9: 通道前半段
  var secondHalf = recent.slice(10, 19)  // bar 10-18: 通道后半段(不含今天)
  var today = recent[recent.length - 1]  // bar 19: 突破确认日

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

  // 今日收盘突破后半段最高点(今天不参与secondHigh计算,所以可以突破)
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

// 信号2: 多头排列加速 (Bull Alignment Acceleration)
// 逻辑: MA5>MA10>MA20多头排列 + MA5斜率加速上扬 + 量能放大
// V88: 加强门槛 - MA5斜率>=1.0(原0.5), 加速比>=0.6(原0.45), 量能>=1.5(原1.3)
function detectBullAlignAccel(klines, dateIdx) {
  if (dateIdx < 25 || dateIdx >= klines.length) return { detected: false, score: 0 }
  var closes = []
  for (var i = 0; i <= dateIdx; i++) closes.push(klines[i].close)
  if (closes.length < 25) return { detected: false, score: 0 }

  var ma5 = calcMA(closes, 5)
  var ma10 = calcMA(closes, 10)
  var ma20 = calcMA(closes, 20)
  // 多头排列
  if (!(ma5 > ma10 && ma10 > ma20)) return { detected: false, score: 0 }

  // MA5斜率: 今日MA5 vs 3天前MA5
  var ma5_3ago = calcMA(closes.slice(0, closes.length - 3), 5)
  if (ma5_3ago <= 0) return { detected: false, score: 0 }
  var ma5SlopePct = (ma5 - ma5_3ago) / ma5_3ago * 100
  // V88: 斜率需>=1.0(原0.5), 更强趋势确认
  if (ma5SlopePct < 1.0) return { detected: false, score: 0 }

  var ma5_6ago = calcMA(closes.slice(0, closes.length - 6), 5)
  if (ma5_6ago <= 0) return { detected: false, score: 0 }
  var ma5Slope6 = (ma5 - ma5_6ago) / ma5_6ago * 100
  // V88: 加速比>=0.6(原0.45)
  if (ma5SlopePct < ma5Slope6 * 0.6) return { detected: false, score: 0 }

  var today = klines[dateIdx]
  // 今日收盘在MA5上方
  if (today.close < ma5) return { detected: false, score: 0 }

  // 量能放大
  var avgVol5 = 0
  for (var i = dateIdx - 4; i < dateIdx; i++) avgVol5 += klines[i].volume
  avgVol5 /= 5
  var volRatio = avgVol5 > 0 ? today.volume / avgVol5 : 0

  // V88: 量能需>=1.5(原1.3才加分)
  if (volRatio < 1.5) return { detected: false, score: 0 }

  var score = 18 // V88: 基础分提高(原15), 通过更严格门槛的信号更可靠
  // 斜率强度加分
  if (ma5SlopePct >= 1.5 && ma5SlopePct <= 4) score += 5
  else if (ma5SlopePct > 4) score += 3
  // 加速程度加分
  var accelRatio = ma5Slope6 > 0 ? ma5SlopePct / ma5Slope6 : 0
  if (accelRatio >= 0.8 && accelRatio <= 2.0) score += 4
  // 量能确认
  if (volRatio >= 2.0) score += 3
  else if (volRatio >= 1.5) score += 1
  // MA20上方距离加分 (不远不近最优)
  var distFromMA20 = (today.close - ma20) / ma20 * 100
  if (distFromMA20 >= 2 && distFromMA20 <= 8) score += 3

  return { detected: true, score: score }
}

// 信号3: 量价齐升加速 (Volume-Price Acceleration)
// 逻辑: 连续3日上涨且量能递增 + 今日涨幅扩大 + 突破近10日高点
// V88: 加强门槛 - 今日涨幅>3%(原仅>昨日涨幅), 量能递增比>=1.3(原>1), 量比>=1.5
function detectVolPriceAccel(klines, dateIdx) {
  if (dateIdx < 12 || dateIdx >= klines.length) return { detected: false, score: 0 }
  var recent = klines.slice(dateIdx - 11, dateIdx + 1)
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

  // 今日涨幅扩大 + V88: 今日涨幅必须>=3%
  var todayChg = (today.close - today.open) / today.open * 100
  var yestChg = (last3[1].close - last3[1].open) / last3[1].open * 100
  if (todayChg <= yestChg) return { detected: false, score: 0 }
  if (todayChg < 3) return { detected: false, score: 0 }  // V88: 涨幅门槛

  // 突破近10日高点
  var high10 = -Infinity
  for (var i = 0; i < recent.length - 1; i++) {
    if (recent[i].high > high10) high10 = recent[i].high
  }
  if (today.close <= high10) return { detected: false, score: 0 }

  // V88: 量能递增比>=1.3 (3天总量/首天量>=1.3)
  var volRatio3 = last3[0].volume > 0 ? last3[2].volume / last3[0].volume : 0
  if (volRatio3 < 1.3) return { detected: false, score: 0 }  // V88: 量能门槛

  // V88: 近5日均量对比>=1.5
  var avgVol5 = 0
  for (var i = recent.length - 6; i < recent.length - 1; i++) avgVol5 += recent[i].volume
  avgVol5 /= 5
  if (avgVol5 <= 0 || today.volume / avgVol5 < 1.5) return { detected: false, score: 0 }  // V88: 量比门槛

  var score = 18 // V88: 基础分提高(原15), 通过更严格门槛的信号更可靠
  // 涨幅梯度加分
  if (todayChg >= 3 && todayChg <= 6) score += 4
  else if (todayChg > 6) score += 2
  // 量能递增幅度
  if (volRatio3 >= 1.5) score += 4
  else if (volRatio3 >= 1.3) score += 2
  // 突破幅度
  if (today.close > high10 * 1.02) score += 3
  // 近5日均量对比
  if (today.volume / avgVol5 >= 2.0) score += 3

  return { detected: true, score: score }
}

// V87形态评分: V84形态 + V87新形态竞争
function calcPatternScoreV87(stock, klines, dateIdx, tech, volumeRatio, bollWidthMax) {
  var base = calcPatternScoreV84(stock, klines, dateIdx, tech, volumeRatio, bollWidthMax)
  var bestPattern = base.pattern, bestScore = base.score

  // V87新增形态参与竞争
  var ac = detectAscendingChannelBreakout(klines, dateIdx)
  if (ac.detected && ac.score > bestScore) { bestPattern = 'asc_channel_break'; bestScore = ac.score }
  var ba = detectBullAlignAccel(klines, dateIdx)
  if (ba.detected && ba.score > bestScore) { bestPattern = 'bull_align_accel'; bestScore = ba.score }
  var vp = detectVolPriceAccel(klines, dateIdx)
  if (vp.detected && vp.score > bestScore) { bestPattern = 'vol_price_accel'; bestScore = vp.score }

  return { pattern: bestPattern, score: bestScore, isGapUp: base.isGapUp }
}

// V87形态评分(门槛模式): 新形态score需高于V84形态至少5分才胜出
// 避免边缘新形态拉低整体WR，保持V84形态高WR同时引入高质量新信号
function calcPatternScoreV87Threshold(stock, klines, dateIdx, tech, volumeRatio, bollWidthMax) {
  var base = calcPatternScoreV84(stock, klines, dateIdx, tech, volumeRatio, bollWidthMax)
  var bestPattern = base.pattern, bestScore = base.score

  // V87新增形态: 需要比V84形态高5分才胜出(质量门槛)
  var ac = detectAscendingChannelBreakout(klines, dateIdx)
  if (ac.detected && ac.score > bestScore + 5) { bestPattern = 'asc_channel_break'; bestScore = ac.score }
  var ba = detectBullAlignAccel(klines, dateIdx)
  if (ba.detected && ba.score > bestScore + 5) { bestPattern = 'bull_align_accel'; bestScore = ba.score }
  var vp = detectVolPriceAccel(klines, dateIdx)
  if (vp.detected && vp.score > bestScore + 5) { bestPattern = 'vol_price_accel'; bestScore = vp.score }

  return { pattern: bestPattern, score: bestScore, isGapUp: base.isGapUp }
}

// V87形态评分(补充模式): V84形态为主 + 新形态作为bonus加分(5分)
// 新形态不替代V84形态，仅作为额外确认加分
function calcPatternScoreV87Supp(stock, klines, dateIdx, tech, volumeRatio, bollWidthMax) {
  var base = calcPatternScoreV84(stock, klines, dateIdx, tech, volumeRatio, bollWidthMax)
  var bonus = 0

  // 新形态作为bonus确认(不竞争，叠加加分)
  var ac = detectAscendingChannelBreakout(klines, dateIdx)
  if (ac.detected) bonus += 5
  var ba = detectBullAlignAccel(klines, dateIdx)
  if (ba.detected) bonus += 5
  var vp = detectVolPriceAccel(klines, dateIdx)
  if (vp.detected) bonus += 5

  return { pattern: base.pattern, score: base.score, bonus: bonus, isGapUp: base.isGapUp }
}

// V87形态评分(bonus模式): V84 + V87新形态叠加加分
function calcPatternScoreV87Bonus(stock, klines, dateIdx, tech, volumeRatio, bollWidthMax) {
  var base = calcPatternScoreV84(stock, klines, dateIdx, tech, volumeRatio, bollWidthMax)
  var bonus = 0
  var ac = detectAscendingChannelBreakout(klines, dateIdx)
  if (ac.detected) bonus += 8
  var ba = detectBullAlignAccel(klines, dateIdx)
  if (ba.detected) bonus += 7
  var vp = detectVolPriceAccel(klines, dateIdx)
  if (vp.detected) bonus += 7
  return { baseP: base.pattern, baseS: base.score, bonus: bonus, total: base.score + bonus, isGapUp: base.isGapUp }
}

// ===== V87混合退出: 阶梯止盈 + ATR追踪止损 =====
// 逻辑: 盈利达3%锁定1%利润, 达5%锁定3%, 达8%用ATR追踪止损; 同时保留ATR止盈上限
function calcHybridExitV87(buyPrice, klines, buyIdx, maxDays, atrVal, atrMult, atrTrailMult) {
  var holdDays = 0, exitPrice = buyPrice, exitReason = 'max_hold'
  var maxReturn = 0, highestPrice = buyPrice
  var atrProfit = atrVal * atrMult        // ATR止盈目标
  var atrTrailing = atrVal * atrTrailMult  // ATR追踪距离
  var trailingActive = false
  var lockStop = buyPrice * 0.92           // 初始8%止损

  for (var d = 1; d <= maxDays && buyIdx + d < klines.length; d++) {
    var day = klines[buyIdx + d]
    if (day.high > highestPrice) highestPrice = day.high
    var profitPct = (highestPrice - buyPrice) / buyPrice * 100

    // 阶梯利润锁定 (宽松版: 让利润有发展空间, 优先级高于ATR追踪)
    if (profitPct >= 12) {
      // 盈利12%+: 锁定5%利润 + ATR追踪
      var lock12 = Math.max(buyPrice * 1.05, highestPrice - atrTrailing)
      if (lock12 > lockStop) lockStop = lock12
      trailingActive = true
    } else if (profitPct >= 8) {
      // 盈利8-12%: 锁定3%利润 + ATR追踪
      var lock8 = Math.max(buyPrice * 1.03, highestPrice - atrTrailing)
      if (lock8 > lockStop) lockStop = lock8
      trailingActive = true
    } else if (profitPct >= 5) {
      // 盈利5-8%: 锁定1%利润 + ATR追踪
      var lock5 = Math.max(buyPrice * 1.01, highestPrice - atrTrailing * 1.5)
      if (lock5 > lockStop) lockStop = lock5
      trailingActive = true
    } else if (profitPct >= 3) {
      // 盈利3-5%: 仅ATR追踪 (1.5倍距离, 给回调空间)
      var atrStop = highestPrice - atrTrailing * 1.5
      if (atrStop > lockStop) lockStop = atrStop
      trailingActive = true
    }

    // 止损
    if (day.low <= lockStop) {
      exitPrice = lockStop
      exitReason = trailingActive ? (profitPct >= 5 ? 'profit_lock' : 'atr_trailing_stop') : 'stop_loss'
      holdDays = d
      break
    }

    // ATR止盈上限
    if (day.high >= buyPrice + atrProfit) {
      exitPrice = Math.min(day.high, buyPrice + atrProfit)
      exitReason = 'atr_profit'
      holdDays = d
      break
    }

    exitPrice = day.close
    holdDays = d
  }

  var finalReturn = (exitPrice - buyPrice) / buyPrice * 100
  var hReturn = (highestPrice - buyPrice) / buyPrice * 100
  if (hReturn > maxReturn) maxReturn = hReturn
  return {
    exitPrice: exitPrice, exitDay: holdDays,
    finalReturn: Math.round(finalReturn * 100) / 100,
    exitReason: exitReason, maxReturn: Math.round(maxReturn * 100) / 100
  }
}

// ===== V87选股函数 =====
function simulatePickV87(dayQuotes, klineMap, dateIdxMap, topN, marketEnv, strategy) {
  var params = V43B_PARAMS
  var minScore = strategy.minScore || 55
  var scored = []
  var adxThreshold = 20, bollThreshold = 0.85, maxConsecUp = strategy.maxConsecUp || 5
  if (params.adaptiveMarket && marketEnv) {
    if (marketEnv.trend === "bear") {
      adxThreshold = Math.max(20, adxThreshold + 8)
      bollThreshold = Math.max(0.70, bollThreshold - 0.15)
      if (params.dynamicConsec && !strategy.maxConsecUp) maxConsecUp = params.consecBear || 3
    } else if (marketEnv.trend === "bull") {
      bollThreshold = Math.min(0.92, bollThreshold + 0.05)
      if (params.dynamicConsec && !strategy.maxConsecUp) maxConsecUp = params.consecBull || 6
    } else { if (params.dynamicConsec && !strategy.maxConsecUp) maxConsecUp = params.consecNeutral || 5 }
  }

  for (var i = 0; i < dayQuotes.length; i++) {
    var stock = dayQuotes[i]
    if (!preFilter(stock)) continue
    var code = stock.code
    var klines = klineMap[code]
    var dateIdx = dateIdxMap[code]
    if (!klines || dateIdx === undefined || dateIdx < 20) continue

    var volumeRatio = stock.volumeRatio || 0
    if (volumeRatio <= 0) volumeRatio = calcVolumeRatioFromKlines(klines, dateIdx)
    if (volumeRatio <= 0) continue

    var techSlice = klines.slice(0, dateIdx + 1)
    var tech = calcTechFromKlines(techSlice)
    if (!tech) continue

    if (strategy.ma5Min !== undefined && tech.ma5Slope < strategy.ma5Min) continue
    if (strategy.ma10Min !== undefined && tech.ma10Slope < strategy.ma10Min) continue
    if (strategy.vrMin && volumeRatio < strategy.vrMin) continue
    if (strategy.rsiMax && tech.rsi > strategy.rsiMax) continue
    if (strategy.chgMax && stock.changePct > strategy.chgMax) continue
    if (strategy.chgMin && stock.changePct < strategy.chgMin) continue

    var pricePos = calcPricePositionVsHigh(klines, dateIdx)
    if (pricePos > (strategy.pricePosThreshold || 0.95)) continue

    var v31Score = calcTechScoreV31(stock, tech.rsi, tech.goldenCross, volumeRatio, tech.bollPosition, code, tech.maSignal, tech.change5d || 0)
    var v10Score = calcTechScoreV10(stock, tech.rsi, tech.goldenCross, volumeRatio, tech.bollPosition, code, tech.maSignal, tech.change5d || 0)
    var techScore = v31Score * 0.75 + v10Score * 0.25

    var patternResult
    var patternMode = strategy.patternMode || 'v84_all'
    if (patternMode === 'v87') {
      patternResult = calcPatternScoreV87(stock, klines, dateIdx, tech, volumeRatio, strategy.bollWidthMax)
    } else if (patternMode === 'v87_threshold') {
      patternResult = calcPatternScoreV87Threshold(stock, klines, dateIdx, tech, volumeRatio, strategy.bollWidthMax)
    } else if (patternMode === 'v87_supp') {
      patternResult = calcPatternScoreV87Supp(stock, klines, dateIdx, tech, volumeRatio, strategy.bollWidthMax)
    } else if (patternMode === 'v87_bonus') {
      patternResult = calcPatternScoreV87Bonus(stock, klines, dateIdx, tech, volumeRatio, strategy.bollWidthMax)
    } else if (patternMode === 'v84_all') {
      patternResult = calcPatternScoreV84(stock, klines, dateIdx, tech, volumeRatio, strategy.bollWidthMax)
    } else {
      patternResult = calcPatternScoreV81(stock, klines, dateIdx, tech, volumeRatio, strategy.bollWidthMax)
    }

    // requirePattern支持数组匹配
    if (strategy.requirePattern) {
      if (Array.isArray(strategy.requirePattern)) {
        if (strategy.requirePattern.indexOf(patternResult.pattern) < 0) continue
      } else {
        if (patternResult.pattern !== strategy.requirePattern) continue
      }
    }

    if (strategy.confirmMACD && !confirmMACDGolden(tech)) continue
    if (strategy.confirmAboveMA20 && !confirmAboveMA20(klines, dateIdx, tech)) continue

    var consecUp = calcConsecutiveUpDays(klines, dateIdx)
    if (consecUp > maxConsecUp) continue

    // 形态基础分 (对齐V84: patternResult.score * patternWeight)
    var patternWeight = strategy.patternWeight || 1.0
    var mb = Math.round(patternResult.score * patternWeight)
    // 额外加分仅在strategy.extraBonus开启时生效 (避免改变V84基线排序)
    if (strategy.extraBonus) {
      if (patternResult.isGapUp) mb += 3
      if (tech.rsi >= 40 && tech.rsi <= 70) mb += 2
    }
    // bonus模式叠加 (v87_bonus模式下patternResult.bonus存在)
    var bonusScore = 0
    if (patternResult.bonus) bonusScore = Math.round(patternResult.bonus * patternWeight)
    // 量价配合分
    var vps = 0
    if (strategy.useVolPriceScore) vps = calcVolPriceScoreV84(klines, dateIdx)
    // MACD递增加分
    var macdB = 0
    if (strategy.macdIncrBonus && checkMACDHistogramIncreasingV2(klines, dateIdx)) macdB = strategy.macdIncrBonus

    var totalScore = Math.round(techScore + mb + bonusScore + vps + macdB)
    // 温和涨幅加分 (对齐V84, 始终生效)
    var chg = stock.changePct || 0
    if (chg >= 1 && chg < 3 && volumeRatio >= 1 && volumeRatio < 2) totalScore += 8
    else if (chg >= 0.5 && chg < 1 && volumeRatio >= 1 && volumeRatio < 1.5) totalScore += 4

    if (tech.bollPosition > bollThreshold) totalScore = Math.round(totalScore * (params.volPenalty || 0.9))
    if (tech.obvTrend > 0) totalScore += 3
    if (tech.adx >= adxThreshold) totalScore += 2
    if (totalScore < minScore) continue

    scored.push({
      code: code, name: stock.name, price: stock.price || klines[dateIdx].close,
      changePct: stock.changePct || 0, totalScore: totalScore,
      patternName: patternResult.pattern, volumeRatio: volumeRatio,
      rsi: tech.rsi, isGapUp: patternResult.isGapUp
    })
  }

  scored.sort(function(a, b) { return b.totalScore - a.totalScore })
  var maxIndCount = strategy.maxIndustryCount || 3
  var industryCount = {}
  var result = []
  for (var i = 0; i < scored.length && result.length < topN; i++) {
    var ind = scored[i].patternName || 'other'
    industryCount[ind] = (industryCount[ind] || 0) + 1
    if (industryCount[ind] <= maxIndCount) result.push(scored[i])
  }
  return result
}

