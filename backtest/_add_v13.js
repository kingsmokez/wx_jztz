var fs = require('fs');

// Add V13 to scoring.js
var scoring = fs.readFileSync('scoring.js', 'utf8');
var v13 = fs.readFileSync('scoring_v13.js', 'utf8');
var v13Func = v13.replace('module.exports = { calcTechScoreV13 }', '').trim();
var exportIdx = scoring.lastIndexOf('module.exports');
var before = scoring.substring(0, exportIdx);
var after = scoring.substring(exportIdx);
after = after.replace('module.exports = {', 'module.exports = {\n  calcTechScoreV13,');
scoring = before + '\n\n' + v13Func + '\n\n' + after;
fs.writeFileSync('scoring.js', scoring, 'utf8');

// Add V13 to run_v3.js
var run = fs.readFileSync('run_v3.js', 'utf8');

// Import
run = run.replace(
  'calcTechScoreV12 } = require("./scoring")',
  'calcTechScoreV12, calcTechScoreV13 } = require("./scoring")'
);

// Branch - add v13 before v12
run = run.replace(
  '} else if (scoreFunc === "v12") {',
  '} else if (scoreFunc === "v13") {\n      score = calcTechScoreV13(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)\n    } else if (scoreFunc === "v12") {'
);

// Array
run = run.replace(
  'var allPicksV8 = [], allPicksV9 = [], allPicksV10 = [], allPicksV11 = [], allPicksV12 = []',
  'var allPicksV8 = [], allPicksV9 = [], allPicksV10 = [], allPicksV11 = [], allPicksV12 = [], allPicksV13 = []'
);

// picksV13
run = run.replace(
  'var picksV12 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v12", CONFIG.topN)',
  'var picksV12 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v12", CONFIG.topN)\n    var picksV13 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v13", CONFIG.topN)'
);

// V13 holding return
var v12Loop = 'for (var p = 0; p < picksV12.length; p++) {\n      var pick = picksV12[p]\n      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)\n      if (returns) allPicksV12.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })\n    }';
var v13Loop = 'for (var p = 0; p < picksV13.length; p++) {\n      var pick = picksV13[p]\n      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)\n      if (returns) allPicksV13.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })\n    }';
run = run.replace(v12Loop, v12Loop + '\n    ' + v13Loop);

// Stats
run = run.replace(
  'var sV12 = calcStats(allPicksV12, "终极V12")',
  'var sV12 = calcStats(allPicksV12, "终极V12")\n  var sV13 = calcStats(allPicksV13, "区分度V13")'
);

// allStats
run = run.replace(
  'var allStats = [sV8, sV9, sV10, sV11, sV12]',
  'var allStats = [sV8, sV9, sV10, sV11, sV12, sV13]'
);

// Count log
run = run.replace(
  'console.log("V12选股: " + allPicksV12.length + " 次")',
  'console.log("V12选股: " + allPicksV12.length + " 次")\nconsole.log("V13选股: " + allPicksV13.length + " 次")'
);

// JSON output
run = run.replace(
  'JSON.stringify({ sV8: sV8, sV9: sV9, sV10: sV10, sV11: sV11, sV12: sV12 }',
  'JSON.stringify({ sV8: sV8, sV9: sV9, sV10: sV10, sV11: sV11, sV12: sV12, sV13: sV13 }'
);

// Add V13 vs V8 comparison
var v12vs = '=== V12 vs V8 ===';
var v13comparison = '=== V13 vs V8 ===")\n  for (var h = 0; h < CONFIG.holdDays.length; h++) {\n    var orig = sV8["hold" + CONFIG.holdDays[h]], opt = sV13["hold" + CONFIG.holdDays[h]]\n    if (!orig || !opt || orig.total === 0 || opt.total === 0) continue\n    var dw = (opt.winRate - orig.winRate).toFixed(2), dr = (opt.avgReturn - orig.avgReturn).toFixed(2)\n    lines.push("  持" + CONFIG.holdDays[h] + "天: 胜率" + orig.winRate + "%->" + opt.winRate + "%(" + (dw >= 0 ? "+" : "") + dw + "%) 均收" + orig.avgReturn + "%->" + opt.avgReturn + "%(" + (dr >= 0 ? "+" : "") + dr + "%)")\n  }\n  lines.push("\\n' + v12vs;
run = run.replace(v12vs, v13comparison);

fs.writeFileSync('run_v3.js', run, 'utf8');
console.log('V13 added');
