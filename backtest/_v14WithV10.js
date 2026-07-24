const fs = require('fs');
let r = fs.readFileSync('run_v3.js', 'utf8');

// V14用V10评分+更严格的预筛选：排除空头和超买
const oldV14 = '} else if (scoreFunc === "v14") {\n      // V14预筛选：趋势优先，比V10更严格的筛选\n      if (stock.changePct < 0) continue // 必须上涨\n      if (techData.rsi > 78) continue // 排除超买\n      if (techData.maSignal === "bear") continue // 排除空头\n      score = calcTechScoreV14(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)';

const newV14 = '} else if (scoreFunc === "v14") {\n      // V14: V10评分 + 更严格筛选\n      if (stock.changePct < 0) continue\n      if (techData.rsi > 78) continue\n      if (techData.maSignal === "bear") continue\n      score = calcTechScoreV10(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)';

r = r.replace(oldV14, newV14);

// V14 minScore 改回55
r = r.replace(
  'var minS = scoreFunc === "v14" ? 50 : CONFIG.minScore',
  'var minS = CONFIG.minScore'
);

fs.writeFileSync('run_v3.js', r, 'utf8');
console.log('V14 now uses V10 scoring + stricter filter');
