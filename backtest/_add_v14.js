const fs = require('fs');
let run = fs.readFileSync('run_v3.js', 'utf8');

// 1. require中添加V14
run = run.replace(
  'calcTechScoreV13 } = require("./scoring")',
  'calcTechScoreV13, calcTechScoreV14 } = require("./scoring")'
);

// 2. allPicks数组添加V14
run = run.replace(
  'allPicksV12 = [], allPicksV13 = []',
  'allPicksV12 = [], allPicksV13 = [], allPicksV14 = []'
);

// 3. simulatePick调用添加V14
run = run.replace(
  'var picksV13 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v13", CONFIG.topN)',
  'var picksV13 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v13", CONFIG.topN)\n    var picksV14 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v14", CONFIG.topN)'
);

// 4. scoreFunc分支添加V14
const v13ScoreLine = 'score = calcTechScoreV13(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)';
run = run.replace(
  v13ScoreLine,
  v13ScoreLine + '\n    } else if (scoreFunc === "v14") {\n      score = calcTechScoreV14(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)'
);

// 5. picksV13循环后添加V14
run = run.replace(
  'for (var p = 0; p < picksV13.length; p++) {\n      var pick = picksV13[p]',
  'for (var p = 0; p < picksV13.length; p++) {\n      var pick = picksV13[p]\n      var returns = calcHoldingReturn(pick.code, pick.price, dateStr, klineMap, dateIdxMap, CONFIG.holdDays)\n      if (returns) allPicksV13.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })\n    }\n    for (var p = 0; p < picksV14.length; p++) {\n      var pick = picksV14[p]'
);
// 上面替换会导致重复，改用另一种方式
// 恢复原文件
run = fs.readFileSync('run_v3.js', 'utf8');

// 重新做1-4的替换
run = run.replace('calcTechScoreV13 } = require("./scoring")', 'calcTechScoreV13, calcTechScoreV14 } = require("./scoring")');
run = run.replace('allPicksV12 = [], allPicksV13 = []', 'allPicksV12 = [], allPicksV13 = [], allPicksV14 = []');
run = run.replace('var picksV13 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v13", CONFIG.topN)', 'var picksV13 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v13", CONFIG.topN)\n    var picksV14 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v14", CONFIG.topN)');
run = run.replace(v13ScoreLine, v13ScoreLine + '\n    } else if (scoreFunc === "v14") {\n      score = calcTechScoreV14(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)');

// 5. 结果收集 - 找V13的push行
const v13Push = "if (returns) allPicksV13.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })";
const v14Push = "if (returns) allPicksV14.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })";
run = run.replace(v13Push, v13Push + "\n      " + v14Push);

// 6. 选股计数
run = run.replace(
  'console.log("V13选股: " + allPicksV13.length + " 次")',
  'console.log("V13选股: " + allPicksV13.length + " 次")\nconsole.log("V14选股: " + allPicksV14.length + " 次")'
);

// 7. 统计
run = run.replace(
  'var sV13 = calcStats(allPicksV13, "区分度V13")',
  'var sV13 = calcStats(allPicksV13, "区分度V13")\n  var sV14 = calcStats(allPicksV14, "可持续V14")'
);

// 8. allStats数组
run = run.replace(
  'var allStats = [sV8, sV9, sV10, sV11, sV12, sV13]',
  'var allStats = [sV8, sV9, sV10, sV11, sV12, sV13, sV14]'
);

// 9. V14 vs V8对比
run = run.replace(
  'lines.push("\\n=== V13 vs V8 ===")',
  'lines.push("\\n=== V14 vs V8 ===")\n  for (var h = 0; h < CONFIG.holdDays.length; h++) {\n    var orig = sV8["hold" + CONFIG.holdDays[h]], opt = sV14["hold" + CONFIG.holdDays[h]]\n    if (!orig || !opt || orig.total === 0 || opt.total === 0) continue\n    var dw = (opt.winRate - orig.winRate).toFixed(2), dr = (opt.avgReturn - orig.avgReturn).toFixed(2)\n    lines.push("  持" + CONFIG.holdDays[h] + "天: 胜率" + orig.winRate + "%->" + opt.winRate + "%(" + (dw >= 0 ? "+" : "") + dw + "%) 均收" + orig.avgReturn + "%->" + opt.avgReturn + "%(" + (dr >= 0 ? "+" : "") + dr + "%)")\n  }\n  lines.push("\\n=== V13 vs V8 ===")'
);

// 10. JSON输出
run = run.replace(
  'sV12: sV12, sV13: sV13',
  'sV12: sV12, sV13: sV13, sV14: sV14'
);

fs.writeFileSync('run_v3.js', run, 'utf8');
console.log('run_v3.js updated with V14 successfully');
