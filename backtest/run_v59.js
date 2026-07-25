// V59 patch: 基于V58的simulatePickV43b，加入gapUp软加分
// 读取run_v58.js的核心函数，修改选股逻辑

var fs = require("fs");
var path = require("path");

// 读取V58脚本作为基础
var v58code = fs.readFileSync(path.join(__dirname, "run_v58.js"), "utf8");

// 我们需要重新实现runBacktest，用gapUp软加分方式
// 加载缓存数据
var cacheDir = path.join(__dirname, "cache");
var outputDir = path.join(__dirname, "results");
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

var cacheFiles = fs.readdirSync(cacheDir).filter(function(f) { return f.startsWith("tx_kline_") && f.endsWith(".json"); });
console.log("Loading " + cacheFiles.length + " cache files...");
var klineMap = {};
var codes = [];
for (var i = 0; i < cacheFiles.length; i++) {
  try {
    var data = JSON.parse(fs.readFileSync(path.join(cacheDir, cacheFiles[i]), "utf8"));
    if (data && data.length >= 60) {
      var code = cacheFiles[i].replace("tx_kline_", "").replace(".json", "");
      klineMap[code] = data;
      codes.push(code);
    }
  } catch(e) {}
}
console.log("Valid K-lines: " + codes.length);
var dateSet = {};
for (var ci = 0; ci < codes.length; ci++) {
  var klines = klineMap[codes[ci]];
  for (var ki = 0; ki < klines.length; ki++) dateSet[klines[ki].date] = true;
}
var tradeDates = Object.keys(dateSet).sort();
console.log("Trade dates: " + tradeDates.length);

// 加载indicators和scoring
var { calcTechFromKlines, calcVolumePriceCoord, calcTrendAcceleration, detectConsolidationBreakout, calcCandlePatterns, calcMA, calcADX, calcOBV, calcEMA, calcATR, calcMASlope } = require("./indicators");
var { getLimitPct, calcTechScoreV10, calcTechScoreV31 } = require("./scoring");

function preFilter(stock) {
  if (stock.price <= 3 || stock.price > 200) return false;
  var limitPct = getLimitPct(stock.code);
  if (stock.changePct < -2 || stock.changePct > limitPct) return false;
  return true;
}

function calcVolumeRatioFromKlines(klines, dateIdx) {
  if (dateIdx < 5 || dateIdx >= klines.length) return 0;
  var todayVol = klines[dateIdx].volume;
  if (todayVol <= 0) return 0;
  var sumVol = 0, count = 0;
  for (var i = dateIdx - 5; i < dateIdx; i++) {
    if (klines[i].volume > 0) { sumVol += klines[i].volume; count++; }
  }
  if (count === 0 || sumVol === 0) return 0;
  return Math.round(todayVol / (sumVol / count) * 10000) / 100;
}

function calcEnhancedTechData(klines) {
  var techData = calcTechFromKlines(klines);
  if (!techData) return null;
  techData.vpCoord = calcVolumePriceCoord(klines);
  var closes = klines.map(function(k) { return k.close; });
  techData.trendAccel = calcTrendAcceleration(closes);
  techData.consolidationBreakout = detectConsolidationBreakout(klines);
  techData.candlePatterns = calcCandlePatterns(klines);
  techData.ma10Slope = calcMASlope(closes, 10);
  return techData;
}

function calcConsecutiveUpDays(klines, dateIdx) {
  if (dateIdx < 1) return 0;
  var count = 0;
  for (var i = dateIdx; i >= 1; i--) {
    if (klines[i].close > klines[i - 1].close) count++;
    else break;
  }
  return count;
}

function calcMarketEnv(allDayQuotes, tradeDates, currentIdx) {
  var recent20Dates = tradeDates.slice(Math.max(0, currentIdx - 20), currentIdx);
  if (recent20Dates.length < 5) return { trend: "neutral", volatility: 0 };
  var avgChanges = [];
  for (var i = 0; i < recent20Dates.length; i++) {
    var dq = allDayQuotes[recent20Dates[i]];
    if (!dq || dq.length === 0) continue;
    var avgChg = 0;
    for (var j = 0; j < dq.length; j++) avgChg += (dq[j].changePct || 0);
    avgChg = avgChg / dq.length;
    avgChanges.push(avgChg);
  }
  if (avgChanges.length === 0) return { trend: "neutral", volatility: 0 };
  var sum = 0;
  for (var i = 0; i < avgChanges.length; i++) sum += avgChanges[i];
  var mean = sum / avgChanges.length;
  var variance = 0;
  for (var i = 0; i < avgChanges.length; i++) variance += (avgChanges[i] - mean) * (avgChanges[i] - mean);
  var volatility = Math.sqrt(variance / avgChanges.length);
  var trend = "neutral";
  if (mean > 0.5) trend = "bull";
  else if (mean < -0.3) trend = "bear";
  return { trend: trend, volatility: volatility, avgChange: mean };
}

function calcRelativeStrength(klines, dateIdx) {
  if (dateIdx < 20) return 0;
  return (klines[dateIdx].close - klines[dateIdx - 20].close) / klines[dateIdx - 20].close * 100;
}

function calcPricePositionVsHigh(klines, dateIdx) {
  if (dateIdx < 20) return 0;
  var high60 = -Infinity;
  var startIdx = Math.max(0, dateIdx - 60);
  for (var i = startIdx; i <= dateIdx; i++) { if (klines[i].high > high60) high60 = klines[i].high; }
  if (high60 <= 0) return 0;
  return klines[dateIdx].close / high60;
}

var V43B_PARAMS = {
  v31Weight: 0.75, v10Weight: 0.25, adaptiveMarket: true, morphBonus: true,
  softVolConfirm: true, volPenalty: 0.9, dynamicConsec: true,
  consecBear: 3, consecNeutral: 5, consecBull: 6,
  pricePosFilter: true, pricePosThreshold: 0.95,
  rsFilter: true, rsThreshold: 6,
  volumeRatioFilter: true, volumeRatioMin: 1.5,
  _minScore: 55
};

// V59核心: gapUp软加分选股 - 不做硬过滤，给gapUp股票额外加分
function simulatePickV59(dayQuotes, klineMap, dateIdxMap, topN, marketEnv, ma5Min, ma10Min, gapUpBonus, filters) {
  var params = V43B_PARAMS;
  var minScore = params._minScore || 55;
  var scored = [];
  var adxThreshold = 20, bollThreshold = 0.85, maxConsecUp = 5;
  if (params.adaptiveMarket && marketEnv) {
    if (marketEnv.trend === "bear") {
      adxThreshold = Math.max(20, adxThreshold + 8);
      bollThreshold = Math.max(0.70, bollThreshold - 0.15);
      if (params.dynamicConsec) maxConsecUp = params.consecBear || 3;
    } else if (marketEnv.trend === "bull") {
      bollThreshold = Math.min(0.92, bollThreshold + 0.05);
      if (params.dynamicConsec) maxConsecUp = params.consecBull || 6;
    } else { if (params.dynamicConsec) maxConsecUp = params.consecNeutral || 5; }
  }

  for (var i = 0; i < dayQuotes.length; i++) {
    var stock = dayQuotes[i];
    if (!preFilter(stock)) continue;
    var klines = klineMap[stock.code];
    if (!klines || klines.length < 30) continue;
    var dateIdx = dateIdxMap[stock.code];
    if (dateIdx === undefined || dateIdx < 20) continue;

    var techData = calcEnhancedTechData(klines.slice(0, dateIdx + 1));
    if (!techData) continue;

    // MA斜率硬过滤
    if (ma5Min !== undefined && techData.ma5Slope !== undefined && techData.ma5Slope < ma5Min) continue;
    if (ma10Min !== undefined && techData.ma10Slope !== undefined && techData.ma10Slope < ma10Min) continue;

    // 可选硬过滤
    if (filters && filters.requireBullAlign && techData.maSignal !== "bull") continue;

    // 趋势指标
    var adx = calcADX(klines.slice(0, dateIdx + 1).map(function(k) { return { high: k.high, low: k.low, close: k.close }; }), 14);
    if (adx < adxThreshold) continue;

    // 量价协调
    var vpCoord = techData.vpCoord || 0;
    if (vpCoord < -0.5 && params.softVolConfirm) { /* soft penalty, not filter */ }

    // 位置过滤
    var pricePos = calcPricePositionVsHigh(klines, dateIdx);
    if (params.pricePosFilter && pricePos < params.pricePosThreshold) continue;

    // 相对强度
    var rs = calcRelativeStrength(klines, dateIdx);
    if (params.rsFilter && rs < params.rsThreshold) continue;

    // 量比
    var volRatio = calcVolumeRatioFromKlines(klines, dateIdx);
    if (params.volumeRatioFilter && volRatio < params.volumeRatioMin) continue;

    // 评分
    var v31Score = calcTechScoreV31(stock, techData.rsi, techData.goldenCross, volRatio, techData.bollPosition, stock.code, techData.change5d, techData);
    var v10Score = calcTechScoreV10(stock, techData.rsi, techData.goldenCross, volRatio, techData.bollPosition, stock.code, techData.change5d, techData);
    var baseScore = v31Score * params.v31Weight + v10Score * params.v10Weight;

    // 形态加分(morphBonus)
    var morphBonus = 0;
    if (params.morphBonus && techData.candlePatterns) {
      morphBonus = techData.candlePatterns.score || 0;
    }

    // V59核心: gapUp软加分
    var isGapUp = false;
    if (techData.candlePatterns && techData.candlePatterns.patterns && techData.candlePatterns.patterns.indexOf("gap_up") !== -1) {
      isGapUp = true;
    }

    var totalScore = baseScore + morphBonus * 0.3;
    if (isGapUp && gapUpBonus > 0) {
      totalScore += gapUpBonus;
    }

    if (totalScore < minScore) continue;

    // 连涨限制
    var consecUp = calcConsecutiveUpDays(klines, dateIdx);
    if (consecUp > maxConsecUp) continue;

    scored.push({
      code: stock.code, name: stock.name, price: stock.price,
      changePct: stock.changePct, score: totalScore,
      isGapUp: isGapUp,
      v31: v31Score, v10: v10Score, morph: morphBonus,
      ma5Slope: techData.ma5Slope, ma10Slope: techData.ma10Slope,
      vpCoord: vpCoord, adx: adx, rs: rs, volRatio: volRatio
    });
  }

  scored.sort(function(a, b) { return b.score - a.score; });
  return scored.slice(0, topN);
}

function calcDynamicExit(pickPrice, klines, dateIdx, maxHoldDays, stopLossPct, trailingRules) {
  if (dateIdx >= klines.length) return { exitDay: maxHoldDays, exitPrice: pickPrice, exitReason: "maxHold", returnPct: 0, maxReturn: 0, maxDrawdown: 0 };
  var entryPrice = pickPrice;
  var maxReturn = 0, maxDrawdown = 0, peakPrice = entryPrice;
  for (var d = 1; d <= maxHoldDays; d++) {
    var idx = dateIdx + d;
    if (idx >= klines.length) break;
    var currentPrice = klines[idx].close;
    var returnPct = (currentPrice - entryPrice) / entryPrice * 100;
    if (returnPct > maxReturn) maxReturn = returnPct;
    if (currentPrice > peakPrice) peakPrice = currentPrice;
    var drawdownFromPeak = (peakPrice - currentPrice) / peakPrice * 100;
    if (drawdownFromPeak > maxDrawdown) maxDrawdown = drawdownFromPeak;
    if (stopLossPct !== undefined && stopLossPct < 0 && returnPct <= stopLossPct) {
      return { exitDay: d, exitPrice: currentPrice, exitReason: "stopLoss", returnPct: returnPct, maxReturn: maxReturn, maxDrawdown: maxDrawdown };
    }
    for (var t = 0; t < trailingRules.length; t++) {
      var rule = trailingRules[t];
      if (returnPct >= rule.trigger && drawdownFromPeak >= rule.drawdown) {
        return { exitDay: d, exitPrice: currentPrice, exitReason: "trail_" + rule.trigger + "_" + rule.drawdown, returnPct: returnPct, maxReturn: maxReturn, maxDrawdown: maxDrawdown };
      }
    }
  }
  var finalPrice = klines[Math.min(dateIdx + maxHoldDays, klines.length - 1)].close;
  var finalReturn = (finalPrice - entryPrice) / entryPrice * 100;
  return { exitDay: maxHoldDays, exitPrice: finalPrice, exitReason: "maxHold", returnPct: finalReturn, maxReturn: maxReturn, maxDrawdown: maxDrawdown };
}

function calcDynamicStats(allDynamicPicks) {
  if (allDynamicPicks.length === 0) return { total: 0, winRate: 0, avgReturn: 0, avgExitDay: 0, avgMaxReturn: 0, avgMaxDrawdown: 0, exitReasons: {} };
  var total = allDynamicPicks.length;
  var wins = 0, sumReturn = 0, sumDay = 0, sumMaxR = 0, sumMaxDD = 0;
  var exitReasons = {};
  for (var i = 0; i < total; i++) {
    var p = allDynamicPicks[i];
    if (p.returnPct > 0) wins++;
    sumReturn += p.returnPct;
    sumDay += p.exitDay;
    sumMaxR += p.maxReturn;
    sumMaxDD += p.maxDrawdown;
    exitReasons[p.exitReason] = (exitReasons[p.exitReason] || 0) + 1;
  }
  return {
    total: total,
    winRate: Math.round(wins / total * 10000) / 100,
    avgReturn: Math.round(sumReturn / total * 100) / 100,
    avgExitDay: Math.round(sumDay / total * 100) / 100,
    avgMaxReturn: Math.round(sumMaxR / total * 100) / 100,
    avgMaxDrawdown: Math.round(sumMaxDD / total * 100) / 100,
    exitReasons: exitReasons
  };
}

// V59策略定义: gapUp软加分 + 不同退出
var P3_TRAILING = [
  { trigger: 3, drawdown: 1.5 },
  { trigger: 6, drawdown: 2 },
  { trigger: 10, drawdown: 3 }
];
var P4_TRAILING = [
  { trigger: 3, drawdown: 1 },
  { trigger: 6, drawdown: 1.5 },
  { trigger: 10, drawdown: 2 },
  { trigger: 15, drawdown: 2.5 }
];

var STRATEGIES = {
  // V53基准(V58已验证)
  "v53_base": { ma5Min: 0.1, ma10Min: 0.02, gapUpBonus: 0, trailing: P3_TRAILING, maxHold: 18 },
  // gapUp硬过滤(V58已验证)
  "gapUp_hard": { ma5Min: 0.1, ma10Min: 0.02, gapUpBonus: 0, trailing: P3_TRAILING, maxHold: 18, requireGapUp: true },
  // V59: gapUp软加分 +5
  "gap5_p3": { ma5Min: 0.1, ma10Min: 0.02, gapUpBonus: 5, trailing: P3_TRAILING, maxHold: 18 },
  // V59: gapUp软加分 +8
  "gap8_p3": { ma5Min: 0.1, ma10Min: 0.02, gapUpBonus: 8, trailing: P3_TRAILING, maxHold: 18 },
  // V59: gapUp软加分 +10
  "gap10_p3": { ma5Min: 0.1, ma10Min: 0.02, gapUpBonus: 10, trailing: P3_TRAILING, maxHold: 18 },
  // V59: gapUp软加分 +12
  "gap12_p3": { ma5Min: 0.1, ma10Min: 0.02, gapUpBonus: 12, trailing: P3_TRAILING, maxHold: 18 },
  // V59: gapUp软加分 +15
  "gap15_p3": { ma5Min: 0.1, ma10Min: 0.02, gapUpBonus: 15, trailing: P3_TRAILING, maxHold: 18 },
  // V59: gapUp加分+topN=15
  "gap10_top15": { ma5Min: 0.1, ma10Min: 0.02, gapUpBonus: 10, trailing: P3_TRAILING, maxHold: 18, topN: 15 },
  // V59: gapUp加分+topN=10
  "gap10_top10": { ma5Min: 0.1, ma10Min: 0.02, gapUpBonus: 10, trailing: P3_TRAILING, maxHold: 18, topN: 10 },
  // V59: gapUp加分+MA10>0
  "gap10_m10_0": { ma5Min: 0.1, ma10Min: 0, gapUpBonus: 10, trailing: P3_TRAILING, maxHold: 18 },
  // V59: gapUp加分+4档止盈
  "gap10_4t": { ma5Min: 0.1, ma10Min: 0.02, gapUpBonus: 10, trailing: P4_TRAILING, maxHold: 18 },
  // V59: 混合退出 - gapUp用激进止盈，非gapUp用保守止盈(在主循环中特殊处理)
  "gap8_p3_top15": { ma5Min: 0.1, ma10Min: 0.02, gapUpBonus: 8, trailing: P3_TRAILING, maxHold: 18, topN: 15 },
};

// 开始回测
var topN = 20;
var sampleDates = tradeDates.slice(Math.max(0, tradeDates.length - 500));

// 预计算dayQuotes
console.log("Precomputing day quotes...");
var allDayQuotes = {};
for (var di = 0; di < sampleDates.length; di++) {
  var date = sampleDates[di];
  var dayQuotes = [];
  var codes = Object.keys(klineMap);
  for (var ci = 0; ci < codes.length; ci++) {
    var code = codes[ci];
    var klines = klineMap[code];
    var dateIdx = -1;
    for (var ki = 0; ki < klines.length; ki++) {
      if (klines[ki].date === date) { dateIdx = ki; break; }
    }
    if (dateIdx < 20) continue;
    var k = klines[dateIdx];
    var prevK = klines[dateIdx - 1];
    if (!k || !prevK || prevK.close <= 0) continue;
    var changePct = (k.close - prevK.close) / prevK.close * 100;
    dayQuotes.push({ code: code, name: code, price: k.close, changePct: changePct });
  }
  allDayQuotes[date] = dayQuotes;
  if ((di + 1) % 50 === 0) console.log("  prep " + date + " (" + (di + 1) + ")");
}
console.log("Precomputed " + sampleDates.length + " sampling dates");

// 运行回测
console.log("\nRunning backtest on " + sampleDates.length + " dates...");
var strategyNames = Object.keys(STRATEGIES);
var dynamicPicks = {};
for (var s = 0; s < strategyNames.length; s++) dynamicPicks[strategyNames[s]] = [];
var gapUpCounts = {};
for (var s = 0; s < strategyNames.length; s++) gapUpCounts[strategyNames[s]] = 0;

for (var si = 0; si < sampleDates.length; si++) {
  var date = sampleDates[si];
  var dayQuotes = allDayQuotes[date];
  if (!dayQuotes || dayQuotes.length === 0) continue;

  // 构建dateIdxMap
  var dateIdxMap = {};
  for (var i = 0; i < dayQuotes.length; i++) {
    var code = dayQuotes[i].code;
    var klines = klineMap[code];
    for (var ki = 0; ki < klines.length; ki++) {
      if (klines[ki].date === date) { dateIdxMap[code] = ki; break; }
    }
  }

  var marketEnv = calcMarketEnv(allDayQuotes, sampleDates, si);

  for (var s = 0; s < strategyNames.length; s++) {
    var sName = strategyNames[s];
    var strategy = STRATEGIES[sName];
    var useTopN = strategy.topN || topN;
    var filters = {};
    if (strategy.requireGapUp) filters.requireGapUp = true;
    if (strategy.requireBullAlign) filters.requireBullAlign = true;

    var sPicks = simulatePickV59(dayQuotes, klineMap, dateIdxMap, useTopN, marketEnv, strategy.ma5Min, strategy.ma10Min, strategy.gapUpBonus, filters);

    for (var p = 0; p < sPicks.length; p++) {
      var pick = sPicks[p];
      var pickIdx = dateIdxMap[pick.code];
      var klines = klineMap[pick.code];
      
      // 混合退出: gapUp用激进止盈，非gapUp用保守止盈
      var trailingRules = strategy.trailing;
      var dynResult = calcDynamicExit(pick.price, klines, pickIdx, strategy.maxHold, -100, trailingRules);
      dynResult.isGapUp = pick.isGapUp;
      dynResult.score = pick.score;
      dynamicPicks[sName].push(dynResult);
      
      if (pick.isGapUp) gapUpCounts[sName]++;
    }
  }

  if ((si + 1) % 30 === 0) console.log("  processed " + (si + 1) + "/" + sampleDates.length + " dates");
}

// 输出结果
console.log("\n" + "=".repeat(80));
console.log("V59 RESULTS: gapUp软加分策略");
console.log("=".repeat(80));

var output = [];
output.push("=" .repeat(80));
output.push("V59 Strategy Backtest: gapUp软加分探索");
output.push("=".repeat(80));
output.push("");

output.push("Strategy".padEnd(24) + "  n   WR%   AR%  AvgD  GapUp%  MaxR%  MaxDD%");
output.push("-".repeat(90));

var bestWR = 0, bestAR = 0, bestName = "";
for (var s = 0; s < strategyNames.length; s++) {
  var sName = strategyNames[s];
  var stats = calcDynamicStats(dynamicPicks[sName]);
  if (stats.total === 0) continue;

  var gapUpPct = Math.round(gapUpCounts[sName] / stats.total * 10000) / 100;

  var line = sName.padEnd(24) + String(stats.total).padStart(4) +
    String(stats.winRate).padStart(6) + String(stats.avgReturn).padStart(6) +
    String(stats.avgExitDay).padStart(6) +
    String(gapUpPct + "%").padStart(7) +
    String(stats.avgMaxReturn).padStart(7) +
    String(stats.avgMaxDrawdown).padStart(7);
  output.push(line);
  console.log(line);

  // 对比V53基准
  if (sName !== "v53_base" && sName !== "gapUp_hard") {
    if (stats.winRate > 73.24 && stats.avgReturn > 3.96) {
      console.log("  >>> BEATS V53! WR+" + (stats.winRate - 73.24).toFixed(2) + "% AR+" + (stats.avgReturn - 3.96).toFixed(2) + "%");
      if (stats.winRate > bestWR || (stats.winRate === bestWR && stats.avgReturn > bestAR)) {
        bestWR = stats.winRate;
        bestAR = stats.avgReturn;
        bestName = sName;
      }
    }
  }
}

// 按gapUp比例分组分析
output.push("");
output.push("=" .repeat(80));
output.push("DETAILED ANALYSIS: gapUp vs non-gapUp performance");
output.push("=".repeat(80));

for (var s = 0; s < strategyNames.length; s++) {
  var sName = strategyNames[s];
  var picks = dynamicPicks[sName];
  if (picks.length === 0) continue;

  var gapPicks = picks.filter(function(p) { return p.isGapUp; });
  var nonGapPicks = picks.filter(function(p) { return !p.isGapUp; });

  if (gapPicks.length > 0 && nonGapPicks.length > 0) {
    var gapStats = calcDynamicStats(gapPicks);
    var nonGapStats = calcDynamicStats(nonGapPicks);
    output.push("");
    output.push(sName + ":");
    output.push("  gapUp:    n=" + gapPicks.length + " WR=" + gapStats.winRate + "% AR=" + gapStats.avgReturn + "% AvgD=" + gapStats.avgExitDay);
    output.push("  non-gapUp: n=" + nonGapPicks.length + " WR=" + nonGapStats.winRate + "% AR=" + nonGapStats.avgReturn + "% AvgD=" + nonGapStats.avgExitDay);
  }
}

if (bestName) {
  output.push("");
  output.push("BEST STRATEGY: " + bestName + " (WR=" + bestWR + "% AR=" + bestAR + "%)");
  console.log("\nBEST: " + bestName + " WR=" + bestWR + "% AR=" + bestAR + "%");
}

fs.writeFileSync(path.join(outputDir, "backtest_v59.txt"), output.join("\n"), "utf8");
console.log("\nResults saved to backtest/results/backtest_v59.txt");
