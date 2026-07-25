const fs = require("fs");
let c = fs.readFileSync("backtest/run_v54.js", "utf8");
c = c.replace(/\r\n/g, "\n");

c = c.replace(/V53 Strategy Backtest: 最终策略选择\(4tier vs p3_t1.5 vs hybrid\)/g, "V54 Strategy Backtest: 4tier变体+评分权重+形态过滤探索");
c = c.replace(/backtest_v53\.txt/g, "backtest_v54.txt");
c = c.replace(/V53 RESULTS/g, "V54 RESULTS");

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
  "  // === V54: 4tier变体+评分权重+形态过滤 ===",
  "  // 组1: 4tier+4档trailing(让利润跑更远)",
  '  "4tier_4d_h18": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 12, trailingPct: 3.5 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02 },",
  '  "4tier_4d_h20": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 12, trailingPct: 3.5 }",
  "  ], maxHoldDays: 20, ma5Min: 0.1, ma10Min: 0.02 },",
  "  // 组2: 4tier+5档trailing(极致保护)",
  '  "4tier_5d_h18": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }, { profitPct: 15, trailingPct: 4 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02 },",
  '  "4tier_5d_h20": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }, { profitPct: 15, trailingPct: 4 }",
  "  ], maxHoldDays: 20, ma5Min: 0.1, ma10Min: 0.02 },",
  "  // 组3: p3_t1.5+4档trailing(平衡+让利润跑)",
  '  "p3_4d_h18": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }, { profitPct: 15, trailingPct: 4 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02 },",
  '  "p3_4d_h20": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }, { profitPct: 15, trailingPct: 4 }",
  "  ], maxHoldDays: 20, ma5Min: 0.1, ma10Min: 0.02 },",
  "  // 组4: 4tier+MA5>0.08(更宽松MA5+更多样本)",
  '  "4tier_ma5_008_h18": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.08, ma10Min: 0.02 },",
  '  "4tier_ma5_008_h20": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 20, ma5Min: 0.08, ma10Min: 0.02 },",
  "  // 组5: p3_t1.5+MA5>0.08",
  '  "p3_ma5_008_h18": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.08, ma10Min: 0.02 },",
  '  "p3_ma5_008_h20": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 20, ma5Min: 0.08, ma10Min: 0.02 },",
  "  // 组6: 4tier+MA5>0.12(更严格MA5)",
  '  "4tier_ma5_012_h18": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.12, ma10Min: 0.02 },",
  "  // 组7: 4tier+MA10>0.05(更严格MA10)",
  '  "4tier_ma10_005_h18": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.05 },",
  '  "4tier_ma10_005_h20": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 2, trailingPct: 0.5 }, { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 20, ma5Min: 0.1, ma10Min: 0.05 },",
  "  // 组8: p3_t1.5+MA10>0.05",
  '  "p3_ma10_005_h18": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.05 },",
  '  "p3_ma10_005_h20": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 20, ma5Min: 0.1, ma10Min: 0.05 },",
  "  // V53基准(对比用)",
  '  "v53_baseline": { stopLoss: -100, trailingRules: [',
  "    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }",
  "  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02 }",
  "}"
];
lines.splice(startLine, endLine - startLine + 1, ...newES);

c = lines.join("\n");
fs.writeFileSync("backtest/run_v54.js", c, "utf8");
console.log("V54 script saved!");
