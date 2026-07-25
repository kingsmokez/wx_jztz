const fs = require("fs");
let c = fs.readFileSync("backtest/run_v57.js", "utf8");
c = c.replace(/\r\n/g, "\n");

c = c.replace(/V56 Strategy Backtest: minScore阈值\+形态过滤探索/g, "V57 Strategy Backtest: 均线多头+量价配合+跳空过滤");
c = c.replace(/backtest_v56\.txt/g, "backtest_v57.txt");
c = c.replace(/V56 RESULTS/g, "V57 RESULTS");

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
  "  // === V57: 均线多头+量价配合+跳空过滤 ===",
  "  // 组1: 均线多头排列(价格>MA5>MA10>MA20)硬过滤",
  '  "bullAlign_p3": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireBullAlign: true },",
  '  "bullAlign_4t": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireBullAlign: true },",
  "  // 组2: 量价看涨(vpCoord.trend=bullish)硬过滤",
  '  "vpBull_p3": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireVpBull: true },",
  '  "vpBull_4t": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireVpBull: true },",
  "  // 组3: 跳空高开(gap_up)硬过滤",
  '  "gapUp_p3": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireGapUp: true },",
  '  "gapUp_4t": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireGapUp: true },",
  "  // 组4: 均线多头+量价看涨(双重过滤)",
  '  "bullVp_p3": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireBullAlign: true, requireVpBull: true },",
  '  "bullVp_4t": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireBullAlign: true, requireVpBull: true },",
  "  // 组5: MACD金叉硬过滤",
  '  "macdCross_p3": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireMacdCross: true },",
  '  "macdCross_4t": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireMacdCross: true },",
  "  // 组6: 均线多头+MACD金叉",
  '  "bullMacd_p3": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireBullAlign: true, requireMacdCross: true },",
  "  // V53基准",
  '  "v53_baseline": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02 }",
  "}"
];
lines.splice(startLine, endLine - startLine + 1, ...newES);

c = lines.join("\n");

// Update function signature
var oldSig = "function simulatePickV43b(dayQuotes, klineMap, dateIdxMap, topN, marketEnv, ma5Min, ma10Min, rsiMax, adxMin, v31W, v10W, minScoreOverride) {";
var newSig = "function simulatePickV43b(dayQuotes, klineMap, dateIdxMap, topN, marketEnv, ma5Min, ma10Min, rsiMax, adxMin, v31W, v10W, minScoreOverride, filters) {";
if (c.indexOf(oldSig) === -1) { console.log("ERROR: oldSig not found"); } else { c = c.replace(oldSig, newSig); console.log("Function signature updated"); }

// Add new filters after MA slope filter
var oldFilter = "    // V51: RSI/ADX交互过滤\n    if (rsiMax !== undefined && techData.rsi !== undefined && techData.rsi > rsiMax) continue\n    if (adxMin !== undefined && techData.adx !== undefined && techData.adx < adxMin) continue";
var newFilter = "    // V51: RSI/ADX交互过滤\n    if (rsiMax !== undefined && techData.rsi !== undefined && techData.rsi > rsiMax) continue\n    if (adxMin !== undefined && techData.adx !== undefined && techData.adx < adxMin) continue\n    // V57: 形态/信号硬过滤\n    if (filters && filters.requireBullAlign && techData.maSignal !== 'bull') continue\n    if (filters && filters.requireVpBull && (!techData.vpCoord || techData.vpCoord.trend !== 'bullish')) continue\n    if (filters && filters.requireGapUp && (!techData.candlePatterns || !techData.candlePatterns.patterns || techData.candlePatterns.patterns.indexOf('gap_up') === -1)) continue\n    if (filters && filters.requireMacdCross && !techData.goldenCross) continue";
if (c.indexOf(oldFilter) === -1) { console.log("ERROR: oldFilter not found"); } else { c = c.replace(oldFilter, newFilter); console.log("New filters added"); }

// Update strategy call
var oldCall = "var sPicks = simulatePickV43b(dayQuotes, klineMap, dateIdxMap, CONFIG.topN, marketEnv, strategy.ma5Min, strategy.ma10Min, strategy.rsiMax, strategy.adxMin, strategy.v31W, strategy.v10W, strategy.minScore)";
var newCall = "var sPicks = simulatePickV43b(dayQuotes, klineMap, dateIdxMap, CONFIG.topN, marketEnv, strategy.ma5Min, strategy.ma10Min, strategy.rsiMax, strategy.adxMin, strategy.v31W, strategy.v10W, strategy.minScore, strategy)";
if (c.indexOf(oldCall) === -1) { console.log("ERROR: oldCall not found"); } else { c = c.replace(oldCall, newCall); console.log("Strategy call updated"); }

fs.writeFileSync("backtest/run_v57.js", c, "utf8");
console.log("V57 script saved!");
