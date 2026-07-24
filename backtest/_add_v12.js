var fs = require('fs');

// Add V12 to scoring.js
var scoring = fs.readFileSync('scoring.js', 'utf8');
var v12 = fs.readFileSync('scoring_v12.js', 'utf8');
var v12Func = v12.replace('module.exports = { calcTechScoreV12 }', '').trim();
var exportIdx = scoring.lastIndexOf('module.exports');
var before = scoring.substring(0, exportIdx);
var after = scoring.substring(exportIdx);
after = after.replace('module.exports = {', 'module.exports = {\n  calcTechScoreV12,');
scoring = before + '\n\n' + v12Func + '\n\n' + after;
fs.writeFileSync('scoring.js', scoring, 'utf8');

// Add V12 to run_v3.js
var run = fs.readFileSync('run_v3.js', 'utf8');

// Import
run = run.replace(
  'calcTechScoreV11 } = require("./scoring")',
  'calcTechScoreV11, calcTechScoreV12 } = require("./scoring")'
);

// Branch
run = run.replace(
  '} else if (scoreFunc === "v11") {',
  '} else if (scoreFunc === "v12") {\n      score = calcTechScoreV12(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)\n    } else if (scoreFunc === "v11") {'
);

// Array declaration
run = run.replace(
  'var allPicksV8 = [], allPicksV9 = [], allPicksV10 = [], allPicksV11 = []',
  'var allPicksV8 = [], allPicksV9 = [], allPicksV10 = [], allPicksV11 = [], allPicksV12 = []'
);

// picksV12 call
run = run.replace(
  'var picksV11 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v11", CONFIG.topN)',
  'var picksV11 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v11", CONFIG.topN)\n    var picksV12 = simulatePick(dayQuotes, klineEMap, dateIdxMap, "v12", CONFIG.topN)'
);

// Fix typo: klineEMap -> klineMap
run = run.replace('klineEMap', 'klineMap');

// V12 holding return
var v11Loop = 'for (var p = 0; p < picksV11.length; p++) {\n      var pick = picksV11[p]\n      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)\n      if (returns) allPicksV11.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })\n    }';
var v12Loop = 'for (var p = 0; p < picksV12.length; p++) {\n      var pick = picksV12[p]\n      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)\n      if (returns) allPicksV12.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })\n    }';
run = run.replace(v11Loop, v11Loop + '\n    ' + v12Loop);

// Stats
run = run.replace(
  'var sV11 = calcStats(allPicksV11, "终极优化V11")',
  'var sV11 = calcStats(allPicksV11, "终极优化V11")\n  var sV12 = calcStats(allPicksV12, "终极V12")'
);

// allStats
run = run.replace(
  'var allStats = [sV8, sV9, sV10, sV11]',
  'var allStats = [sV8, sV9, sV10, sV11, sV12]'
);

// Count log
run = run.replace(
  'console.log("V11选股: " + allPicksV11.length + " 次")',
  'console.log("V11选股: " + allPicksV11.length + " 次")\nconsole.log("V12选股: " + allPicksV12.length + " 次")'
);

// JSON output
run = run.replace(
  'JSON.stringify({ sV8: sV8, sV9: sV9, sV10: sV10, sV11: sV11 }',
  'JSON.stringify({ sV8: sV8, sV9: sV9, sV10: sV10, sV11: sV11, sV12: sV12 }'
);

// Add V12 vs V8 comparison
var v11vs = '=== V11 vs V8 ===';
var v12comparison = '=== V12 vs V8 ===")\n  for (var h = 0; h < CONFIG.holdDays.length; h++) {\n    var orig = sV8["hold" + CONFIG.holdDays[h]], opt = sV12["hold" + CONFIG.holdDays[h]]\n    if (!orig || !opt || orig.total === 0 || opt.total === 0) continue\n    var dw = (opt.winRate - orig.winRate).toFixed(2), dr = (opt.avgReturn - orig.avgReturn).toFixed(2)\n    lines.push("  持" + CONFIG.holdDays[h] + "天: 胜率" + orig.winRate + "%->" + opt.winRate + "%(" + (dw >= 0 ? "+" : "") + dw + "%) 均收" + orig.avgReturn + "%->" + opt.avgReturn + "%(" + (dr >= 0 ? "+" : "") + dr + "%)")\n  }\n  lines.push("\\n' + v11vs;
run = run.replace(v11vs, v12comparison);

fs.writeFileSync('run_v3.js', run, 'utf8');
console.log('V12 added');
