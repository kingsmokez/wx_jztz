var fs = require('fs');
var src = fs.readFileSync('run_v3.js', 'utf8');

// Fix 1: Variable declarations
src = src.replace(
  'var allPicksOriginal = [], allPicksOptimized = []',
  'var allPicksV8 = [], allPicksV9 = [], allPicksV10 = []'
);

// Fix 2: Remove duplicate picksV10 lines (3 copies -> 1)
var dupPattern = 'var picksV10 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v10", CONFIG.topN)\n    var picksV10 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v10", CONFIG.topN)\n    var picksV10 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v10", CONFIG.topN)';
var singleV10 = 'var picksV10 = simulatePick(dayQuotes, klineMap, dateIdxMap, "v10", CONFIG.topN)';
src = src.replace(dupPattern, singleV10);

// Fix 3: Rename variables
src = src.replace(/allPicksOriginal/g, 'allPicksV8');
src = src.replace(/allPicksOptimized/g, 'allPicksV9');

// Fix 4: Stats variables
src = src.replace('var sO = calcStats(allPicksV8, "原始策略V8")', 'var sV8 = calcStats(allPicksV8, "原始策略V8")');
src = src.replace('var sP = calcStats(allPicksV9, "优化策略V9")', 'var sV9 = calcStats(allPicksV9, "优化策略V9")\n  var sV10 = calcStats(allPicksV10, "深度优化V10")');

// Fix 5: Console output
src = src.replace('console.log("\\n原始策略: " + allPicksV8.length + " 次")', 'console.log("\\nV8选股: " + allPicksV8.length + " 次")');
src = src.replace('console.log("优化策略: " + allPicksV9.length + " 次")', 'console.log("V9选股: " + allPicksV9.length + " 次")\nconsole.log("V10选股: " + allPicksV10.length + " 次")');

// Fix 6: Report loop - iterate 3 strategies
src = src.replace(
  'for (var s = 0; s < 2; s++) {\n    var st = s === 0 ? sO : sP',
  'var allStats = [sV8, sV9, sV10]\n  for (var s = 0; s < allStats.length; s++) {\n    var st = allStats[s]'
);

// Fix 7: Comparison section  
src = src.replace(
  'lines.push("\\n--- 对比 ---")',
  'lines.push("\\n=== V10 vs V8 ===")'
);
src = src.replace(
  'var orig = sO["hold" + CONFIG.holdDays[h]], opt = sP["hold" + CONFIG.holdDays[h]]',
  'var orig = sV8["hold" + CONFIG.holdDays[h]], opt = sV10["hold" + CONFIG.holdDays[h]]'
);

// Fix 8: JSON output
src = src.replace('JSON.stringify({ sO: sO, sP: sP }', 'JSON.stringify({ sV8: sV8, sV9: sV9, sV10: sV10 }');

// Fix 9: Remove garbled V10 report section and replace with clean ending
var v10Start = src.indexOf('// V10 report');
if (v10Start >= 0) {
  src = src.substring(0, v10Start);
  src += 'console.log("\\n" + report)\n  console.log("\\n报告已保存到: " + CONFIG.outputDir)\n}\n\nrunBacktest().catch(function(e) { console.error("回测失败:", e); process.exit(1) })\n';
}

fs.writeFileSync('run_v3.js', src, 'utf8');
console.log('修复完成，行数: ' + src.split('\n').length);
