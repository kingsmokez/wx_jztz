// V62创建脚本: gapUp精细优化+退出参数微调+扩大样本方向
var fs = require("fs");
var path = require("path");
var v58code = fs.readFileSync(path.join(__dirname, "run_v59b.js"), "utf8");
var modifiedCode = v58code;

// 1. 在simulatePickV43b中添加新的过滤条件支持
// 在requireGapUp过滤后添加额外条件
var gapUpFilter = "if (filters && filters.requireGapUp && (!techData.candlePatterns || !techData.candlePatterns.patterns || techData.candlePatterns.patterns.indexOf('gap_up') === -1)) continue";
var newGapUpFilter = gapUpFilter + "\n    // V62: gapUp扩展 - 'gapUp或大阳线'模式\n    if (filters && filters.requireGapUpOrBigYang) {\n      var isGapUp2 = techData.candlePatterns && techData.candlePatterns.patterns && techData.candlePatterns.patterns.indexOf('gap_up') !== -1;\n      var isBigYang2 = techData.candlePatterns && techData.candlePatterns.patterns && techData.candlePatterns.patterns.indexOf('big_yang') !== -1;\n      if (!isGapUp2 && !isBigYang2) continue;\n    }\n    // V62: gapUp扩展 - 'gapUp或放量阳线'模式\n    if (filters && filters.requireGapUpOrVolYang) {\n      var isGapUp3 = techData.candlePatterns && techData.candlePatterns.patterns && techData.candlePatterns.patterns.indexOf('gap_up') !== -1;\n      var isVolYang = (stock.changePct || 0) >= 3 && volumeRatio >= 2;\n      if (!isGapUp3 && !isVolYang) continue;\n    }\n    // V62: gapUp+量比阈值\n    if (filters && filters.gapUpVrMin) { if (volumeRatio < filters.gapUpVrMin) continue; }\n    // V62: gapUp+涨幅范围\n    if (filters && filters.gapUpChgMin) { var chg = stock.changePct || 0; if (chg < filters.gapUpChgMin) continue; }\n    if (filters && filters.gapUpChgMax) { var chg2 = stock.changePct || 0; if (chg2 > filters.gapUpChgMax) continue; }\n    // V62: gapUp+RSI阈值\n    if (filters && filters.gapUpRsiMax) { if (techData.rsi > filters.gapUpRsiMax) continue; }";
modifiedCode = modifiedCode.replace(gapUpFilter, newGapUpFilter);

// 2. 修改sFilters传入
var oldFilters = "if (strategy.requireGapUp) sFilters.requireGapUp = true; if (strategy.requireBullAlign) sFilters.requireBullAlign = true; if (strategy.gapUpBonus) sFilters.gapUpBonus = strategy.gapUpBonus; if (strategy.rsMin !== undefined) sFilters.rsMin = strategy.rsMin; if (strategy.vrMin !== undefined) sFilters.vrMin = strategy.vrMin; if (strategy.minScore !== undefined) sFilters.minScore = strategy.minScore; if (strategy.pricePosThreshold !== undefined) sFilters.pricePosThreshold = strategy.pricePosThreshold;";
var newFilters = "if (strategy.requireGapUp) sFilters.requireGapUp = true; if (strategy.requireBullAlign) sFilters.requireBullAlign = true; if (strategy.gapUpBonus) sFilters.gapUpBonus = strategy.gapUpBonus; if (strategy.rsMin !== undefined) sFilters.rsMin = strategy.rsMin; if (strategy.vrMin !== undefined) sFilters.vrMin = strategy.vrMin; if (strategy.minScore !== undefined) sFilters.minScore = strategy.minScore; if (strategy.pricePosThreshold !== undefined) sFilters.pricePosThreshold = strategy.pricePosThreshold; if (strategy.requireGapUpOrBigYang) sFilters.requireGapUpOrBigYang = true; if (strategy.requireGapUpOrVolYang) sFilters.requireGapUpOrVolYang = true; if (strategy.gapUpVrMin) sFilters.gapUpVrMin = strategy.gapUpVrMin; if (strategy.gapUpChgMin) sFilters.gapUpChgMin = strategy.gapUpChgMin; if (strategy.gapUpChgMax) sFilters.gapUpChgMax = strategy.gapUpChgMax; if (strategy.gapUpRsiMax) sFilters.gapUpRsiMax = strategy.gapUpRsiMax;";
modifiedCode = modifiedCode.replace(oldFilters, newFilters);

// 3. 替换策略定义
var strategyStart = modifiedCode.indexOf("var EXIT_STRATEGIES = {");
var noBonusIdx = modifiedCode.indexOf("noBonus_top8", strategyStart);
if (noBonusIdx === -1) noBonusIdx = modifiedCode.indexOf("gap8_top15", strategyStart);
var strategyEnd = modifiedCode.indexOf("\n}", noBonusIdx) + 2;

var newStrategies = [
  "var EXIT_STRATEGIES = {",
  "  // V53基准",
  '  "v53_base": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02 },',
  "  // V61基准: gapUp+MA5>0.1+MA10>0",
  '  "gapUp_base": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true },',
  "  // gapUp+量比>=2(更强放量)",
  '  "gapUp_vr2": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true, gapUpVrMin: 2 },',
  "  // gapUp+量比>=2.5",
  '  "gapUp_vr25": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true, gapUpVrMin: 2.5 },',
  "  // gapUp+涨幅>3%(更强跳空)",
  '  "gapUp_chg3": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true, gapUpChgMin: 3 },',
  "  // gapUp+涨幅2-8%(排除涨停)",
  '  "gapUp_chg2_8": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true, gapUpChgMin: 2, gapUpChgMax: 8 },',
  "  // gapUp+RSI<80(排除超买)",
  '  "gapUp_rsi80": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true, gapUpRsiMax: 80 },',
  "  // gapUp+RSI<75",
  '  "gapUp_rsi75": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true, gapUpRsiMax: 75 },',
  "  // gapUp或大阳线(扩大样本)",
  '  "gapOrBigYang": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUpOrBigYang: true },',
  "  // gapUp或(涨幅>3%且量比>2)(扩大样本)",
  '  "gapOrVolYang": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUpOrVolYang: true },',
  "  // gapUp+退出2/5/8%",
  '  "gapUp_258": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 2, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true },',
  "  // gapUp+退出3/5/8%",
  '  "gapUp_358": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true },',
  "  // gapUp+退出4/7/10%",
  '  "gapUp_4710": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 4, trailingPct: 2 }, { profitPct: 7, trailingPct: 2.5 }, { profitPct: 10, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true },',
  "  // gapUp+退出3/6/10%+最大持有15天(缩短持有)",
  '  "gapUp_15d": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }',
  '  ], maxHoldDays: 15, ma5Min: 0.1, ma10Min: 0, requireGapUp: true },',
  "  // gapUp+退出3/6/10%+最大持有12天",
  '  "gapUp_12d": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }',
  '  ], maxHoldDays: 12, ma5Min: 0.1, ma10Min: 0, requireGapUp: true }',
  "}"
].join("\n");

modifiedCode = modifiedCode.substring(0, strategyStart) + newStrategies + modifiedCode.substring(strategyEnd);

// 4. 修改标题
modifiedCode = modifiedCode.replace("V58 Strategy Backtest: gapUp", "V62 Strategy Backtest: gapUp精细优化");
modifiedCode = modifiedCode.replace("V58 RESULTS", "V62 RESULTS");
modifiedCode = modifiedCode.replace("backtest_v59.txt", "backtest_v62.txt");

fs.writeFileSync(path.join(__dirname, "run_v62.js"), modifiedCode, "utf8");
console.log("V62脚本创建完成");
