// V63创建脚本: 围绕3/5/8%止盈微调回撤参数
var fs = require("fs");
var path = require("path");
var v58code = fs.readFileSync(path.join(__dirname, "run_v59b.js"), "utf8");
var modifiedCode = v58code;

// 修改策略定义
var strategyStart = modifiedCode.indexOf("var EXIT_STRATEGIES = {");
var noBonusIdx = modifiedCode.indexOf("noBonus_top8", strategyStart);
if (noBonusIdx === -1) noBonusIdx = modifiedCode.indexOf("gap8_top15", strategyStart);
var strategyEnd = modifiedCode.indexOf("\n}", noBonusIdx) + 2;

var newStrategies = [
  "var EXIT_STRATEGIES = {",
  "  // V61基准: gapUp+3/6/10%",
  '  "v61_base": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true },',
  "  // V62最优: gapUp+3/5/8%",
  '  "gapUp_358": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true },',
  "  // 3/5/8% + 回撤1/1.5/2.5%(更紧)",
  '  "g358_115_25": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 1.5 }, { profitPct: 8, trailingPct: 2.5 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true },',
  "  // 3/5/8% + 回撤1.5/2/3%(更松)",
  '  "g358_15_2_3": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1.5 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true },',
  "  // 3/5/8% + 回撤0.5/1/2%(非常紧)",
  '  "g358_05_1_2": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 0.5 }, { profitPct: 5, trailingPct: 1 }, { profitPct: 8, trailingPct: 2 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true },',
  "  // 3/5/8% + 回撤1/2/3%(混合)",
  '  "g358_1_2_3": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true },',
  "  // 3/5/8/10% 4档",
  '  "g358_4t": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 1.5 }, { profitPct: 8, trailingPct: 2.5 }, { profitPct: 10, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true },',
  "  // 3/5/8/12% 4档",
  '  "g358_12_4t": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 1.5 }, { profitPct: 8, trailingPct: 2.5 }, { profitPct: 12, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true },',
  "  // 3/6/8%(跳过5%)",
  '  "g368": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1 }, { profitPct: 6, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true },',
  "  // 2/4/7%(更早止盈)",
  '  "g247": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 2, trailingPct: 1 }, { profitPct: 4, trailingPct: 1.5 }, { profitPct: 7, trailingPct: 2.5 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0, requireGapUp: true },',
  "  // 3/5/8% + MA5>0.08(更宽松MA5)",
  '  "g358_m508": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.08, ma10Min: 0, requireGapUp: true },',
  "  // 3/5/8% + MA5>0.12(更严格MA5)",
  '  "g358_m512": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.12, ma10Min: 0, requireGapUp: true },',
  "  // 3/5/8% + MA10>0.02(更严格MA10)",
  '  "g358_m1002": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }',
  '  ], maxHoldDays: 18, ma5Min: 0.1, ma10Min: 0.02, requireGapUp: true },',
  "  // 3/5/8% + 最大持有15天",
  '  "g358_15d": { stopLoss: -100, trailingRules: [',
  '    { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }',
  '  ], maxHoldDays: 15, ma5Min: 0.1, ma10Min: 0, requireGapUp: true }',
  "}"
].join("\n");

modifiedCode = modifiedCode.substring(0, strategyStart) + newStrategies + modifiedCode.substring(strategyEnd);

// 修改标题
modifiedCode = modifiedCode.replace("V58 Strategy Backtest: gapUp", "V63 Strategy Backtest: 退出参数精细微调");
modifiedCode = modifiedCode.replace("V58 RESULTS", "V63 RESULTS");
modifiedCode = modifiedCode.replace("backtest_v59.txt", "backtest_v63.txt");

fs.writeFileSync(path.join(__dirname, "run_v63.js"), modifiedCode, "utf8");
console.log("V63脚本创建完成");
