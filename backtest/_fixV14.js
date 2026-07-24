const fs = require('fs');
let r = fs.readFileSync('run_v3.js', 'utf8');

// V14策略：基于V10评分 + 更严格的筛选条件
// 1. 预筛选：必须均线多头或MACD金叉或价格在MA60上方
// 2. 排除：RSI>75超买、均线空头、量比>5暴量
// 3. 最低分数60（而不是55）

const oldV14 = '} else if (scoreFunc === "v14") {\n      if (techData.rsi > 78) continue\n      if (techData.momentum20 > 35) continue\n      if (techData.maSignal === "bear") continue\n      if (volumeRatio > 6) continue\n      score = calcTechScoreV14(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)';

const newV14 = '} else if (scoreFunc === "v14") {\n      // V14预筛选：可持续强势条件\n      if (techData.rsi > 75) continue\n      if (techData.maSignal === "bear") continue\n      if (volumeRatio > 5) continue\n      if (techData.momentum20 > 35) continue\n      // 必须有至少一个强势信号\n      var hasSignal = techData.maSignal === "bull" || techData.goldenCross || (price > techData.ma60 && techData.ma60 > 0)\n      if (!hasSignal) continue\n      score = calcTechScoreV14(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)';

r = r.replace(oldV14, newV14);

// 同时为V14设置更高的minScore - 通过在V14评分后覆盖
// 实际上更好的方法是：在V14分支中，score < 60 就跳过
// 但目前minScore是55，所以需要在scored.push之前加判断
// 或者在V14评分后设一个更高的门槛

fs.writeFileSync('run_v3.js', r, 'utf8');
console.log('V14 prefilter updated');
