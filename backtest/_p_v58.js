const fs = require("fs");
let c = fs.readFileSync("backtest/run_v58.js", "utf8");
c = c.replace(/\r\n/g, "\n");

c = c.replace(/V57 Strategy Backtest: 均线多头\+量价配合\+跳空过滤/g, "V58 Strategy Backtest: gapUp深度探索+组合过滤");
c = c.replace(/backtest_v57\.txt/g, "backtest_v58.txt");
c = c.replace(/V57 RESULTS/g, "V58 RESULTS");

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
  "  // === V58: gapUp深度探索 ===",
  "  // 组1: gapUp+MA10>0(无MA10>0.02, 增加样本)",
  '  "gap_ma10_0_p3": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true },",
  '  "gap_ma10_0_4t": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true },",
  "  // 组2: gapUp+MA5>0.08(更宽松MA5)",
  '  "gap_m5_008_p3": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.08, ma10Min: 0.02, requireGapUp: true },",
  '  "gap_m5_008_4t": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.08, ma10Min: 0.02, requireGapUp: true },",
  "  // 组3: gapUp+MA5>0.12(更严格MA5)",
  '  "gap_m5_012_p3": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.12, ma10Min: 0.02, requireGapUp: true },",
  "  // 组4: gapUp+MA10>0.05(更严格MA10)",
  '  "gap_m10_005_p3": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.05, requireGapUp: true },",
  "  // 组5: gapUp+均线多头排列",
  '  "gap_bull_p3": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireGapUp: true, requireBullAlign: true },",
  '  "gap_bull_4t": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireGapUp: true, requireBullAlign: true },",
  "  // 组6: 非gapUp但有大阳线(放量阳线)",
  '  "bigYang_p3": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireBigYang: true },",
  "  // 组7: gapUp+红三兵",
  '  "gap_threeW_p3": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireGapUp: true, requireThreeWhite: true },",
  "  // 组8: gapUp+长下影线",
  '  "gap_shadow_p3": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireGapUp: true, requireLongShadow: true },",
  "  // V53基准(对比)",
  '  "v53_baseline": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02 },",
  "  // V57 gapUp基准(对比)",
  '  "gapUp_baseline": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireGapUp: true }",
  "}"
];
lines.splice(startLine, endLine - startLine + 1, ...newES);

c = lines.join("\n");

// Add new filter types: requireBigYang, requireThreeWhite, requireLongShadow
var oldFilter = "    if (filters && filters.requireMacdCross && !techData.goldenCross) continue";
var newFilter = "    if (filters && filters.requireMacdCross && !techData.goldenCross) continue\n    if (filters && filters.requireBigYang && (!techData.candlePatterns || !techData.candlePatterns.patterns || techData.candlePatterns.patterns.indexOf('big_yang') === -1)) continue\n    if (filters && filters.requireThreeWhite && (!techData.candlePatterns || !techData.candlePatterns.patterns || techData.candlePatterns.patterns.indexOf('three_white') === -1)) continue\n    if (filters && filters.requireLongShadow && (!techData.candlePatterns || !techData.candlePatterns.patterns || techData.candlePatterns.patterns.indexOf('long_lower_shadow') === -1)) continue";
if (c.indexOf(oldFilter) === -1) { console.log("ERROR: oldFilter not found"); } else { c = c.replace(oldFilter, newFilter); console.log("New filter types added"); }

fs.writeFileSync("backtest/run_v58.js", c, "utf8");
console.log("V58 script saved!");
