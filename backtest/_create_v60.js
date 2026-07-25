// V60创建脚本
var fs = require("fs");
var path = require("path");
var v59code = fs.readFileSync(path.join(__dirname, "run_v59b.js"), "utf8");
var modifiedCode = v59code;

// 1. 插入混合退出函数
var hybridExitFunc = "\n// V60: 混合退出\nfunction calcHybridExit(pickPrice, klines, dateIdx, maxHoldDays, isGapUp, gapTrailing, normalTrailing) {\n  var rules = isGapUp ? gapTrailing : normalTrailing;\n  return calcDynamicExit(pickPrice, klines, dateIdx, maxHoldDays, -100, rules);\n}\n\n";

var insertPoint = modifiedCode.indexOf("async function runBacktest()");
if (insertPoint === -1) { console.log("ERROR"); process.exit(1); }
modifiedCode = modifiedCode.substring(0, insertPoint) + hybridExitFunc + modifiedCode.substring(insertPoint);

// 2. 替换策略定义
var strategyStart = modifiedCode.indexOf("var EXIT_STRATEGIES = {");
var noBonusIdx = modifiedCode.indexOf("noBonus_top8", strategyStart);
var strategyEnd = modifiedCode.indexOf("\n}", noBonusIdx) + 2;
if (strategyStart === -1 || strategyEnd === 1) { console.log("ERROR strategies"); process.exit(1); }

var newStrategies = [
  "var EXIT_STRATEGIES = {",
  "  // V53基准",
  "  \"v53_base\": { stopLoss: -100, trailingRules: [",
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02 },",
  "  // gapUp硬过滤",
  "  \"gapUp_hard\": { stopLoss: -100, trailingRules: [",
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireGapUp: true },",
  "  // 混合1: gapUp用3/6/10, 非gapUp用2/4/7(保守)",
  "  \"hybrid_1\": { maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02,",
  "    gapTrailing: [{ profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }],",
  "    normalTrailing: [{ profitPct: 2, trailingPct: 1 }, { profitPct: 4, trailingPct: 1.5 }, { profitPct: 7, trailingPct: 2 }] },",
  "  // 混合2: gapUp用3/6/10, 非gapUp固定持有10天",
  "  \"hybrid_2\": { maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02,",
  "    gapTrailing: [{ profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }],",
  "    normalTrailing: 'hold10' },",
  "  // 混合3: gapUp用2/4/7/10(4档), 非gapUp用3/6/10",
  "  \"hybrid_3\": { maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02,",
  "    gapTrailing: [{ profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }],",
  "    normalTrailing: [{ profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }] },",
  "  // 混合4: gapUp用4/8/12(激进), 非gapUp用3/6/10",
  "  \"hybrid_4\": { maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02,",
  "    gapTrailing: [{ profitPct: 4, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }, { profitPct: 12, trailingPct: 4 }],",
  "    normalTrailing: [{ profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }] }",
  "}"
].join("\n");

modifiedCode = modifiedCode.substring(0, strategyStart) + newStrategies + modifiedCode.substring(strategyEnd);

// 3. 修改退出逻辑
var oldExit = "var dynResult = calcDynamicExit(pick.price, klines, pickIdx, strategy.maxHoldDays, -100, strategy.trailingRules)";
var newExit = "var dynResult; if (strategy.gapTrailing) { if (pick.isGapUp) { dynResult = calcDynamicExit(pick.price, klines, pickIdx, strategy.maxHoldDays, -100, strategy.gapTrailing); } else if (strategy.normalTrailing === 'hold10') { var maxHold = Math.min(10, klines.length - pickIdx - 1); var endPrice = klines[Math.min(pickIdx + 10, klines.length - 1)].close; dynResult = { exitDay: maxHold, exitPrice: endPrice, exitReason: 'fixed10', returnPct: (endPrice / pick.price - 1) * 100, maxReturn: 0, maxDrawdown: 0 }; var pp = pick.price, mr = 0; for (var dd = 1; dd <= maxHold; dd++) { var rr = (klines[pickIdx + dd].close / pp - 1) * 100; if (rr > mr) mr = rr; } dynResult.maxReturn = mr; } else { dynResult = calcDynamicExit(pick.price, klines, pickIdx, strategy.maxHoldDays, -100, strategy.normalTrailing); } } else { dynResult = calcDynamicExit(pick.price, klines, pickIdx, strategy.maxHoldDays, -100, strategy.trailingRules); } dynResult.isGapUp = pick.isGapUp || false;";
modifiedCode = modifiedCode.replace(oldExit, newExit);

// 4. 修改输出标题
modifiedCode = modifiedCode.replace("V58 Strategy Backtest: gapUp软加分探索", "V60 Strategy Backtest: 混合退出策略");
modifiedCode = modifiedCode.replace("V58 RESULTS", "V60 RESULTS");
modifiedCode = modifiedCode.replace("backtest_v59.txt", "backtest_v60.txt");

fs.writeFileSync(path.join(__dirname, "run_v60.js"), modifiedCode, "utf8");
console.log("V60脚本创建完成");
