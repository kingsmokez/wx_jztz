const fs = require('fs');
let r = fs.readFileSync('run_v3.js', 'utf8');

// 放宽V14预筛选条件
const oldV14 = '} else if (scoreFunc === "v14") {\n      // V14预筛选：趋势优先策略\n      if (stock.changePct < 0.5) continue // 必须上涨\n      if (techData.maSignal !== "bull" && !techData.goldenCross) continue // 必须多头或金叉\n      if (volumeRatio < 1.0) continue // 必须放量\n      if (techData.rsi > 75) continue // 排除超买\n      if (techData.change5d > 25) continue // 排除过热\n      if (techData.ma20 > 0 && stock.price < techData.ma20) continue // 必须站上MA20\n      score = calcTechScoreV14(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)';

const newV14 = '} else if (scoreFunc === "v14") {\n      // V14预筛选：趋势优先，比V10更严格的筛选\n      if (stock.changePct < 0) continue // 必须上涨\n      if (techData.rsi > 78) continue // 排除超买\n      if (techData.maSignal === "bear") continue // 排除空头\n      score = calcTechScoreV14(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)';

r = r.replace(oldV14, newV14);

// V14的minScore也降低到55
r = r.replace(
  'var minS = scoreFunc === "v14" ? 60 : CONFIG.minScore',
  'var minS = scoreFunc === "v14" ? 50 : CONFIG.minScore'
);

fs.writeFileSync('run_v3.js', r, 'utf8');
console.log('V14 loosened');
