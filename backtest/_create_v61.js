// V61: gapUp+放松过滤条件增加样本
var fs = require("fs");
var path = require("path");
var v58code = fs.readFileSync(path.join(__dirname, "run_v59b.js"), "utf8");
var modifiedCode = v58code;

// 替换策略定义
var strategyStart = modifiedCode.indexOf("var EXIT_STRATEGIES = {");
var noBonusIdx = modifiedCode.indexOf("noBonus_top8", strategyStart);
var strategyEnd = modifiedCode.indexOf("\n}", noBonusIdx) + 2;

var newStrategies = [
  "var EXIT_STRATEGIES = {",
  "  // gapUp基准(V57)",
  '  "gapUp_base": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireGapUp: true },',
  "  // gapUp+RS>=3(降低相对强度)",
  '  "gapUp_rs3": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireGapUp: true, rsMin: 3 },',
  "  // gapUp+量比>=1.2(降低量比)",
  '  "gapUp_vr12": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireGapUp: true, vrMin: 1.2 },',
  "  // gapUp+minScore=50(降低评分门槛)",
  '  "gapUp_sc50": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireGapUp: true, minScore: 50 },',
  "  // gapUp+MA5>0.08(更宽松MA5)",
  '  "gapUp_m5_08": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.08, ma10Min: 0.02, requireGapUp: true },',
  "  // gapUp+MA5>0.06",
  '  "gapUp_m5_06": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.06, ma10Min: 0.02, requireGapUp: true },',
  "  // gapUp+MA10>0(宽松MA10)",
  '  "gapUp_m10_0": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true },',
  "  // gapUp+MA5>0.06+MA10>0",
  '  "gapUp_m56_m100": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.06, ma10Min: 0, requireGapUp: true },',
  "  // gapUp+放宽价格位置到0.9",
  '  "gapUp_pp09": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireGapUp: true, pricePosThreshold: 0.9 }',
  "}"
].join("\n");

modifiedCode = modifiedCode.substring(0, strategyStart) + newStrategies + modifiedCode.substring(strategyEnd);

// 修改选股函数以支持新的过滤参数
// 在simulatePickV43b中的rsFilter处添加rsMin支持
var oldRs = "if (params.rsFilter) { var rs = calcRelativeStrength(klines, dateIdx); if (rs < (params.rsThreshold || 0)) continue }";
var newRs = "var rs = calcRelativeStrength(klines, dateIdx); if (filters && filters.rsMin !== undefined) { if (rs < filters.rsMin) continue } else if (params.rsFilter) { if (rs < (params.rsThreshold || 0)) continue }";
modifiedCode = modifiedCode.replace(oldRs, newRs);

// 量比过滤
var oldVr = "if (params.volumeRatioFilter && volumeRatio < (params.volumeRatioMin || 1.5)) continue";
var newVr = "if (filters && filters.vrMin !== undefined) { if (volumeRatio < filters.vrMin) continue } else if (params.volumeRatioFilter && volumeRatio < (params.volumeRatioMin || 1.5)) continue";
modifiedCode = modifiedCode.replace(oldVr, newVr);

// minScore覆盖
var oldMinScore = "var minScore = minScoreOverride !== undefined ? minScoreOverride : (params._minScore || 55)";
var newMinScore = "var minScore = (filters && filters.minScore !== undefined) ? filters.minScore : (minScoreOverride !== undefined ? minScoreOverride : (params._minScore || 55))";
modifiedCode = modifiedCode.replace(oldMinScore, newMinScore);

// 价格位置
var oldPp = "if (params.pricePosFilter) { var pp = calcPricePositionVsHigh(klines, dateIdx); if (pp < (params.pricePosThreshold || 0.75)) continue }";
var newPp = "var pp = calcPricePositionVsHigh(klines, dateIdx); if (filters && filters.pricePosThreshold !== undefined) { if (pp < filters.pricePosThreshold) continue } else if (params.pricePosFilter) { if (pp < (params.pricePosThreshold || 0.75)) continue }";
modifiedCode = modifiedCode.replace(oldPp, newPp);

// 修改sFilters传入逻辑
var oldFilters = "var sFilters = {}; if (strategy.requireGapUp) sFilters.requireGapUp = true; if (strategy.requireBullAlign) sFilters.requireBullAlign = true; if (strategy.gapUpBonus) sFilters.gapUpBonus = strategy.gapUpBonus;";
var newFilters = "var sFilters = {}; if (strategy.requireGapUp) sFilters.requireGapUp = true; if (strategy.requireBullAlign) sFilters.requireBullAlign = true; if (strategy.gapUpBonus) sFilters.gapUpBonus = strategy.gapUpBonus; if (strategy.rsMin !== undefined) sFilters.rsMin = strategy.rsMin; if (strategy.vrMin !== undefined) sFilters.vrMin = strategy.vrMin; if (strategy.minScore !== undefined) sFilters.minScore = strategy.minScore; if (strategy.pricePosThreshold !== undefined) sFilters.pricePosThreshold = strategy.pricePosThreshold;";
modifiedCode = modifiedCode.replace(oldFilters, newFilters);

// 修改标题
modifiedCode = modifiedCode.replace("V58 Strategy Backtest: gapUp", "V61 Strategy Backtest: gapUp+放宽过滤");
modifiedCode = modifiedCode.replace("V58 RESULTS", "V61 RESULTS");
modifiedCode = modifiedCode.replace("backtest_v59.txt", "backtest_v61.txt");

fs.writeFileSync(path.join(__dirname, "run_v61.js"), modifiedCode, "utf8");
console.log("V61脚本创建完成");
