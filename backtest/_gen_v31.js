var fs = require('fs');
var v30 = fs.readFileSync('D:/wx_jztz/backtest/run_v30.js', 'utf8');

// 1. Replace imports
var result = v30;
result = result.replace('var { calcTechFromKlines } = require("./indicators")', 
  'var { calcTechFromKlines, calcVolumePriceCoord, calcTrendAcceleration, detectConsolidationBreakout, calcCandlePatterns } = require("./indicators")');
result = result.replace('var { getLimitPct, calcTechScoreV10 } = require("./scoring")',
  'var { getLimitPct, calcTechScoreV10, calcTechScoreV31 } = require("./scoring")');

// 2. Add enhanced tech data function
var idx = result.indexOf('function calcVolumeRatioFromKlines');
var insertPoint = result.indexOf('\n', idx) + 1;

var enhancedFunc = [
  '// ===== V31: Enhanced Tech Data =====',
  'function calcEnhancedTechData(klines) {',
  '  var techData = calcTechFromKlines(klines)',
  '  if (!techData) return null',
  '  techData.vpCoord = calcVolumePriceCoord(klines)',
  '  var closes = klines.map(function(k) { return k.close })',
  '  techData.trendAccel = calcTrendAcceleration(closes)',
  '  techData.consolidationBreakout = detectConsolidationBreakout(klines)',
  '  techData.candlePatterns = calcCandlePatterns(klines)',
  '  return techData',
  '}',
  ''
].join('\n');

result = result.substring(0, insertPoint) + enhancedFunc + result.substring(insertPoint);

// 3. Replace simulatePickV30 with simulatePickV31
var v30Start = result.indexOf('function simulatePickV30');
var v30End = result.indexOf('\nfunction ', v30Start + 10);

var v31Func = [
  'function simulatePickV31(dayQuotes, klineMap, dateIdxMap, topN, params) {',
  '  var scored = []',
  '  for (var i = 0; i < dayQuotes.length; i++) {',
  '    var stock = dayQuotes[i]',
  '    if (!preFilter(stock)) continue',
  '    var klines = klineMap[stock.code]',
  '    if (!klines) continue',
  '    var dateIdx = dateIdxMap[stock.code]',
  '    if (dateIdx === undefined || dateIdx < 30) continue',
  '    var sliceKlines = klines.slice(Math.max(0, dateIdx - 60), dateIdx + 1)',
  '    var techData = calcEnhancedTechData(sliceKlines)',
  '    if (!techData) continue',
  '    if (techData.momentum20 < -15) continue',
  '    var volumeRatio = calcVolumeRatioFromKlines(klines, dateIdx)',
  '    stock.volumeRatio = volumeRatio',
  '    var v10Score = calcTechScoreV10(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)',
  '    if (v10Score < CONFIG.minScore) continue',
  '    var v31Score = calcTechScoreV31(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)',
  '    if (params.filterADX && (techData.adx < 20 || techData.plusDI <= techData.minusDI)) continue',
  '    if (params.filterVP && techData.vpCoord && techData.vpCoord.trend === "bearish_divergence") continue',
  '    if (params.filterRSI && techData.rsi > 75) continue',
  '    if (params.filterBOLL && techData.bollPosition > 0.85) continue',
  '    var finalScore = v31Score * (params.v31Weight !== undefined ? params.v31Weight : 0.65) + v10Score * (params.v10Weight !== undefined ? params.v10Weight : 0.35)',
  '    scored.push({ code: stock.code, price: stock.price, changePct: stock.changePct, score: Math.round(finalScore) })',
  '  }',
  '  scored.sort(function(a, b) { return b.score - a.score })',
  '  return scored.slice(0, topN)',
  '}',
  ''
].join('\n');

result = result.substring(0, v30Start) + v31Func + result.substring(v30End);

// 4. Replace VARIANTS block
var variantsStart = result.indexOf('var BASE_CHG');
var variantsEnd = result.indexOf('\nasync function runBacktest');

var v31Variants = [
  'var VARIANTS = {',
  '  "V28b4_base": { v10Weight: 0.35, v31Weight: 0.65 },',
  '  "V31_base": { v31Weight: 0.65, v10Weight: 0.35 },',
  '  "V31a_adx": { v31Weight: 0.65, v10Weight: 0.35, filterADX: true },',
  '  "V31b_vp": { v31Weight: 0.65, v10Weight: 0.35, filterVP: true },',
  '  "V31c_rsi": { v31Weight: 0.65, v10Weight: 0.35, filterRSI: true },',
  '  "V31d_boll": { v31Weight: 0.65, v10Weight: 0.35, filterBOLL: true },',
  '  "V31e_all": { v31Weight: 0.65, v10Weight: 0.35, filterADX: true, filterVP: true, filterRSI: true, filterBOLL: true },',
  '  "V31f_80_20": { v31Weight: 0.8, v10Weight: 0.2 },',
  '  "V31g_50_50": { v31Weight: 0.5, v10Weight: 0.5 },',
  '  "V31h_adx_vp": { v31Weight: 0.65, v10Weight: 0.35, filterADX: true, filterVP: true },',
  '  "V31i_adx_vp_rsi": { v31Weight: 0.65, v10Weight: 0.35, filterADX: true, filterVP: true, filterRSI: true },',
  '  "V31j_adx_vp_boll": { v31Weight: 0.65, v10Weight: 0.35, filterADX: true, filterVP: true, filterBOLL: true },',
  '  "V31k_e_80_20": { v31Weight: 0.8, v10Weight: 0.2, filterADX: true, filterVP: true },',
  '  "V31l_e_50_50": { v31Weight: 0.5, v10Weight: 0.5, filterADX: true, filterVP: true },',
  '}',
  ''
].join('\n');

result = result.substring(0, variantsStart) + v31Variants + result.substring(variantsEnd);

// 5. Replace simulatePickV30 -> simulatePickV31 in main loop
result = result.replace(/simulatePickV30/g, 'simulatePickV31');

// 6. Replace titles and output
result = result.replace('V30 Multi-factor Enhancement', 'V31 5-Dimension Scoring');
result = result.replace('V30 Multi-factor Enhancement Sweep', 'V31 5-Dimension Scoring Sweep');
result = result.replace('backtest_v30.txt', 'backtest_v31.txt');

fs.writeFileSync('D:/wx_jztz/backtest/run_v31.js', result, 'utf8');
console.log('Done, length: ' + result.length);
