const fs = require('fs');
let r = fs.readFileSync('run_v3.js', 'utf8');

// 完全重新设计V14预筛选：
// V14的核心思路：不选涨幅最大的，而选"趋势最强"的
// 1. 涨幅 >= 0.5%（比V10的-2%更严格）
// 2. 必须均线多头排列(bull)或MACD金叉
// 3. 量比 >= 1.0（有放量）
// 4. 价格在MA20上方（中期趋势向上）
// 5. 排除：RSI>75、均线空头、5日涨幅>25%

const oldV14Pre = '} else if (scoreFunc === "v14") {\n      // V14预筛选：可持续强势条件\n      if (techData.rsi > 75) continue\n      if (techData.maSignal === "bear") continue\n      if (volumeRatio > 5) continue\n      if (techData.momentum20 > 35) continue\n      // 必须有至少一个强势信号\n      var hasSignal = techData.maSignal === "bull" || techData.goldenCross || (stock.price > techData.ma60 && techData.ma60 > 0)\n      if (!hasSignal) continue\n      score = calcTechScoreV14(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)';

const newV14Pre = '} else if (scoreFunc === "v14") {\n      // V14预筛选：趋势优先策略\n      if (stock.changePct < 0.5) continue // 必须上涨\n      if (techData.maSignal !== "bull" && !techData.goldenCross) continue // 必须多头或金叉\n      if (volumeRatio < 1.0) continue // 必须放量\n      if (techData.rsi > 75) continue // 排除超买\n      if (techData.change5d > 25) continue // 排除过热\n      if (techData.ma20 > 0 && stock.price < techData.ma20) continue // 必须站上MA20\n      score = calcTechScoreV14(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)';

r = r.replace(oldV14Pre, newV14Pre);

fs.writeFileSync('run_v3.js', r, 'utf8');
console.log('V14 prefilter redesigned');
