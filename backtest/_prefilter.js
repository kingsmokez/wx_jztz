const fs = require('fs');
let r = fs.readFileSync('run_v3.js', 'utf8');

// 找到V14分支并添加预筛选
const oldV14 = '} else if (scoreFunc === "v14") {\n      score = calcTechScoreV14(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)';

const newV14 = '} else if (scoreFunc === "v14") {\n      if (techData.rsi > 78) continue\n      if (techData.momentum20 > 35) continue\n      if (techData.maSignal === "bear") continue\n      if (volumeRatio > 6) continue\n      score = calcTechScoreV14(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)';

if (r.includes(oldV14)) {
  r = r.replace(oldV14, newV14);
  fs.writeFileSync('run_v3.js', r, 'utf8');
  console.log('V14 prefilter added successfully');
} else {
  console.log('V14 branch not found in expected format, searching...');
  const idx = r.indexOf('scoreFunc === "v14"');
  console.log('Found at:', idx);
  if (idx > -1) {
    console.log(r.substring(idx - 5, idx + 250));
  }
}
