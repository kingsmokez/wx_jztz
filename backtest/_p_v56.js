const fs = require("fs");
let c = fs.readFileSync("backtest/run_v56.js", "utf8");
c = c.replace(/\r\n/g, "\n");

c = c.replace(/V55 Strategy Backtest: 评分权重优化\(V31\/V10比例\)/g, "V56 Strategy Backtest: minScore阈值+形态过滤探索");
c = c.replace(/backtest_v55\.txt/g, "backtest_v56.txt");
c = c.replace(/V55 RESULTS/g, "V56 RESULTS");

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
  "  // === V56: minScore阈值+形态过滤 ===",
  "  // 评分权重不影响选股结果(已验证), 改为探索minScore和形态过滤",
  "  // 组1: minScore阈值(当前55)",
  '  "ms50_p3": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, minScore: 50 },",
  '  "ms55_p3": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, minScore: 55 },",
  '  "ms60_p3": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, minScore: 60 },",
  '  "ms65_p3": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, minScore: 65 },",
  "  // 组2: minScore+4tier退出",
  '  "ms50_4t": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, minScore: 50 },",
  '  "ms55_4t": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, minScore: 55 },",
  '  "ms60_4t": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, minScore: 60 },",
  '  "ms65_4t": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, minScore: 65 },",
  "  // 组3: minScore+MA5>0.08(更宽松)",
  '  "ms55_p3_m008": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.08, ma10Min: 0.02, minScore: 55 },",
  '  "ms50_p3_m008": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.08, ma10Min: 0.02, minScore: 50 },",
  '  "ms55_4t_m008": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.08, ma10Min: 0.02, minScore: 55 },",
  '  "ms50_4t_m008": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.08, ma10Min: 0.02, minScore: 50 },",
  "  // V53基准",
  '  "v53_baseline": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, minScore: 55 }",
  "}"
];
lines.splice(startLine, endLine - startLine + 1, ...newES);

c = lines.join("\n");

// Update simulatePickV43b to accept minScore param
var oldSig = "function simulatePickV43b(dayQuotes, klineMap, dateIdxMap, topN, marketEnv, ma5Min, ma10Min, rsiMax, adxMin, v31W, v10W) {";
var newSig = "function simulatePickV43b(dayQuotes, klineMap, dateIdxMap, topN, marketEnv, ma5Min, ma10Min, rsiMax, adxMin, v31W, v10W, minScoreOverride) {";
if (c.indexOf(oldSig) === -1) { console.log("ERROR: oldSig not found"); } else { c = c.replace(oldSig, newSig); console.log("Function signature updated"); }

// Update minScore usage
var oldMS = "var minScore = params._minScore || 55";
var newMS = "var minScore = minScoreOverride !== undefined ? minScoreOverride : (params._minScore || 55)";
if (c.indexOf(oldMS) === -1) { console.log("ERROR: oldMS not found"); } else { c = c.replace(oldMS, newMS); console.log("minScore updated"); }

// Update strategy call
var oldCall = "var sPicks = simulatePickV43b(dayQuotes, klineMap, dateIdxMap, CONFIG.topN, marketEnv, strategy.ma5Min, strategy.ma10Min, strategy.rsiMax, strategy.adxMin, strategy.v31W, strategy.v10W)";
var newCall = "var sPicks = simulatePickV43b(dayQuotes, klineMap, dateIdxMap, CONFIG.topN, marketEnv, strategy.ma5Min, strategy.ma10Min, strategy.rsiMax, strategy.adxMin, strategy.v31W, strategy.v10W, strategy.minScore)";
if (c.indexOf(oldCall) === -1) { console.log("ERROR: oldCall not found"); } else { c = c.replace(oldCall, newCall); console.log("Strategy call updated"); }

fs.writeFileSync("backtest/run_v56.js", c, "utf8");
console.log("V56 script saved!");
