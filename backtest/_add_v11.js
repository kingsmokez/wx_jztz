var fs = require('fs');
var src = fs.readFileSync('run_v3.js', 'utf8');

// 1. Add V11 import
src = src.replace(
  'calcTechScoreV10 } = require("./scoring")',
  'calcTechScoreV10, calcTechScoreV11 } = require("./scoring")'
);

// 2. Add v11 branch in simulatePick
src = src.replace(
  '} else if (scoreFunc === "v10") {',
  '} else if (scoreFunc === "v11") {\n      score = calcTechScoreV11(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)\n    } else if (scoreFunc === "v10") {'
);

// 3. Add allPicksV11 declaration
src = src.replace(
  'var allPicksV8 = [], allPicksV9 = [], allPicksV10 = []',
  'var allPicksV8 = [], allPicksV9 = [], allPicksV10 = [], allPicksV11 = []'
);

// 4. Add picksV11 call
src = src.replace(
  'var picksV10 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v10", CONFIG.topN)',
  'var picksV10 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v10", CONFIG.topN)\n    var picksV11 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v11", CONFIG.topN)'
);

// 5. Add V11 holding return calculation
var v10Block = 'for (var p = 0; p < picksV10.length; p++) {\n      var pick = picksV10[p]\n      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)\n      if (returns) allPicksV10.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })\n    }';
var v11Block = 'for (var p = 0; p < picksV11.length; p++) {\n      var pick = picksV11[p]\n      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)\n      if (returns) allPicksV11.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })\n    }';
src = src.replace(v10Block, v10Block + '\n    ' + v11Block);

// 6. Add V11 stats
src = src.replace(
  'var sV10 = calcStats(allPicksV10, "深度优化V10")',
  'var sV10 = calcStats(allPicksV10, "深度优化V10")\n  var sV11 = calcStats(allPicksV11, "终极优化V11")'
);

// 7. Update allStats array
src = src.replace(
  'var allStats = [sV8, sV9, sV10]',
  'var allStats = [sV8, sV9, sV10, sV11]'
);

// 8. Add V11 count log
src = src.replace(
  'console.log("V10选股: " + allPicksV10.length + " 次")',
  'console.log("V10选股: " + allPicksV10.length + " 次")\nconsole.log("V11选股: " + allPicksV11.length + " 次")'
);

// 9. Update JSON output
src = src.replace(
  'JSON.stringify({ sV8: sV8, sV9: sV9, sV10: sV10 }',
  'JSON.stringify({ sV8: sV8, sV9: sV9, sV10: sV10, sV11: sV11 }'
);

// 10. Update minScore threshold
src = src.replace('minScore: 45', 'minScore: 55');

// 11. Add V11 vs V8 comparison at the end
var v10vs = '=== V10 vs V8 ===';
var v11vs = '=== V11 vs V8 ===';
src = src.replace(v10vs, v11vs + '\n  for (var h = 0; h < CONFIG.holdDays.length; h++) {\n    var orig = sV8["hold" + CONFIG.holdDays[h]], opt = sV11["hold" + CONFIG.holdDays[h]]\n    if (!orig || !opt || orig.total === 0 || opt.total === 0) continue\n    var dw = (opt.winRate - orig.winRate).toFixed(2), dr = (opt.avgReturn - orig.avgReturn).toFixed(2)\n    lines.push("  持" + CONFIG.holdDays[h] + "天: 胜率" + orig.winRate + "%->" + opt.winRate + "%(" + (dw >= 0 ? "+" : "") + dw + "%) 均收" + orig.avgReturn + "%->" + opt.avgReturn + "%(" + (dr >= 0 ? "+" : "") + dr + "%)")\n  }\n  lines.push("\\n' + v10vs);

fs.writeFileSync('run_v3.js', src, 'utf8');
console.log('V11 added to run_v3.js');
