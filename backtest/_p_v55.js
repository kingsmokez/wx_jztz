const fs = require("fs");
let c = fs.readFileSync("backtest/run_v55.js", "utf8");
c = c.replace(/\r\n/g, "\n");

c = c.replace(/V54 Strategy Backtest: 4tier变体\+评分权重\+形态过滤探索/g, "V55 Strategy Backtest: 评分权重优化(V31/V10比例)");
c = c.replace(/backtest_v54\.txt/g, "backtest_v55.txt");
c = c.replace(/V54 RESULTS/g, "V55 RESULTS");

// Replace EXIT_STRATEGIES with weight-based strategies
let lines = c.split("\n");
var startLine = -1, endLine = -1;
for (var i = 0; i < lines.length; i++) {
  if (lines[i].indexOf("var EXIT_STRATEGIES = {") !== -1) { startLine = i; }
}
var braceCount = 0;
for (var i = startLine; i < lines.length; i++) {
  for (var j = 0; j < lines[i].length; j++) {
    if (lines[i][j] === "{") braceCount++;
    if (lines[i][j] === "}") braceCount--;
  }
  if (braceCount === 0 && i > startLine) { endLine = i; break; }
}
console.log("Replacing EXIT_STRATEGIES lines", startLine, "to", endLine);

var newES = [
  "var EXIT_STRATEGIES = {",
  "  // === V55: 评分权重优化 ===",
  "  // 当前V43b: V31x0.75+V10x0.25, 测试不同权重",
  "  // 使用V53最优退出(p3_t1.5+MA10>0.02)",
  '  "w80_20": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, v31W: 0.80, v10W: 0.20 },",
  '  "w70_30": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, v31W: 0.70, v10W: 0.30 },",
  '  "w65_35": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, v31W: 0.65, v10W: 0.35 },",
  '  "w60_40": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, v31W: 0.60, v10W: 0.40 },",
  '  "w50_50": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, v31W: 0.50, v10W: 0.50 },",
  "  // 也测试4tier退出+不同权重",
  '  "4t_w80_20": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, v31W: 0.80, v10W: 0.20 },",
  '  "4t_w70_30": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, v31W: 0.70, v10W: 0.30 },",
  '  "4t_w60_40": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, v31W: 0.60, v10W: 0.40 },",
  '  "4t_w50_50": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, v31W: 0.50, v10W: 0.50 },",
  "  // V53基准(0.75/0.25权重)",
  '  "v53_baseline": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02 }",
  "}"
];
lines.splice(startLine, endLine - startLine + 1, ...newES);

c = lines.join("\n");

// Update simulatePickV43b to accept v31W/v10W params
var oldSig = "function simulatePickV43b(dayQuotes, klineMap, dateIdxMap, topN, marketEnv, ma5Min, ma10Min, rsiMax, adxMin) {";
var newSig = "function simulatePickV43b(dayQuotes, klineMap, dateIdxMap, topN, marketEnv, ma5Min, ma10Min, rsiMax, adxMin, v31W, v10W) {";
if (c.indexOf(oldSig) === -1) { console.log("ERROR: oldSig not found"); } else { c = c.replace(oldSig, newSig); console.log("Function signature updated"); }

// Update score calculation to use v31W/v10W
var oldCalc = "var finalScore = v31Score * (params.v31Weight || 0.75) + v10Score * (params.v10Weight || 0.25) + morphBonus";
var newCalc = "var finalScore = v31Score * (v31W !== undefined ? v31W : (params.v31Weight || 0.75)) + v10Score * (v10W !== undefined ? v10W : (params.v10Weight || 0.25)) + morphBonus";
if (c.indexOf(oldCalc) === -1) { console.log("ERROR: oldCalc not found"); } else { c = c.replace(oldCalc, newCalc); console.log("Score calc updated"); }

// Update strategy call in main loop
var oldCall = "var sPicks = simulatePickV43b(dayQuotes, klineMap, dateIdxMap, CONFIG.topN, marketEnv, strategy.ma5Min, strategy.ma10Min, strategy.rsiMax, strategy.adxMin)";
var newCall = "var sPicks = simulatePickV43b(dayQuotes, klineMap, dateIdxMap, CONFIG.topN, marketEnv, strategy.ma5Min, strategy.ma10Min, strategy.rsiMax, strategy.adxMin, strategy.v31W, strategy.v10W)";
if (c.indexOf(oldCall) === -1) { console.log("ERROR: oldCall not found"); } else { c = c.replace(oldCall, newCall); console.log("Strategy call updated"); }

fs.writeFileSync("backtest/run_v55.js", c, "utf8");
console.log("V55 script saved!");
