var fs = require('fs');
var v31 = fs.readFileSync('D:/wx_jztz/backtest/run_v31.js', 'utf8');

// Replace VARIANTS with V32 sweep around V31j
var variantsStart = v31.indexOf('var VARIANTS = {');
var variantsEnd = v31.indexOf('\nasync function runBacktest');

var v32Variants = [
  'var VARIANTS = {',
  '  "V31j_base": { v31Weight: 0.65, v10Weight: 0.35, filterADX: true, filterVP: true, filterBOLL: true },',
  '  "V32a_70_30": { v31Weight: 0.7, v10Weight: 0.3, filterADX: true, filterVP: true, filterBOLL: true },',
  '  "V32b_75_25": { v31Weight: 0.75, v10Weight: 0.25, filterADX: true, filterVP: true, filterBOLL: true },',
  '  "V32c_80_20": { v31Weight: 0.8, v10Weight: 0.2, filterADX: true, filterVP: true, filterBOLL: true },',
  '  "V32d_60_40": { v31Weight: 0.6, v10Weight: 0.4, filterADX: true, filterVP: true, filterBOLL: true },',
  '  "V32e_55_45": { v31Weight: 0.55, v10Weight: 0.45, filterADX: true, filterVP: true, filterBOLL: true },',
  '  "V32f_boll90": { v31Weight: 0.65, v10Weight: 0.35, filterADX: true, filterVP: true, filterBOLL: true, bollThreshold: 0.9 },',
  '  "V32g_boll95": { v31Weight: 0.65, v10Weight: 0.35, filterADX: true, filterVP: true, filterBOLL: true, bollThreshold: 0.95 },',
  '  "V32h_adx25": { v31Weight: 0.65, v10Weight: 0.35, filterADX: true, adxThreshold: 25, filterVP: true, filterBOLL: true },',
  '  "V32i_adx15": { v31Weight: 0.65, v10Weight: 0.35, filterADX: true, adxThreshold: 15, filterVP: true, filterBOLL: true },',
  '  "V32j_strictVP": { v31Weight: 0.65, v10Weight: 0.35, filterADX: true, filterVP: true, filterBOLL: true, strictVP: true },',
  '  "V32k_all_rsi": { v31Weight: 0.65, v10Weight: 0.35, filterADX: true, filterVP: true, filterBOLL: true, filterRSI: true },',
  '  "V32l_70_rsi": { v31Weight: 0.7, v10Weight: 0.3, filterADX: true, filterVP: true, filterBOLL: true, filterRSI: true },',
  '  "V32m_75_rsi": { v31Weight: 0.75, v10Weight: 0.25, filterADX: true, filterVP: true, filterBOLL: true, filterRSI: true },',
  '}',
  ''
].join('\n');

var result = v31.substring(0, variantsStart) + v32Variants + v31.substring(variantsEnd);
result = result.replace('V31 5-Dimension Scoring Sweep', 'V32 Fine-tune around V31j');
result = result.replace('V31 5-Dimension Scoring', 'V32 Fine-tune');
result = result.replace('backtest_v31.txt', 'backtest_v32.txt');

// Also update the filterBOLL in simulatePickV31 to support bollThreshold
result = result.replace(
  'if (params.filterBOLL && techData.bollPosition > 0.85) continue',
  'if (params.filterBOLL && techData.bollPosition > (params.bollThreshold || 0.85)) continue'
);
// Support adxThreshold
result = result.replace(
  'if (params.filterADX && (techData.adx < 20 || techData.plusDI <= techData.minusDI)) continue',
  'if (params.filterADX && (techData.adx < (params.adxThreshold || 20) || techData.plusDI <= techData.minusDI)) continue'
);
// Support strictVP
result = result.replace(
  'if (params.filterVP && techData.vpCoord && techData.vpCoord.trend === "bearish_divergence") continue',
  'if (params.filterVP && techData.vpCoord && (techData.vpCoord.trend === "bearish_divergence" || (params.strictVP && techData.vpCoord.score < 40))) continue'
);

fs.writeFileSync('D:/wx_jztz/backtest/run_v32.js', result, 'utf8');
console.log('Done, length: ' + result.length);
