const fs = require('fs');
let r = fs.readFileSync('run_v3.js', 'utf8');

// 修复V14结果收集：从V13循环中移除，添加独立的V14循环
const wrongV14 = "if (returns) allPicksV14.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })";

// 先移除V13循环中错误的V14 push
r = r.replace(wrongV14, '');

// 在V13循环后添加V14的独立循环
const v13Loop = "for (var p = 0; p < picksV13.length; p++) {\n      var pick = picksV13[p]\n      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)\n      if (returns) allPicksV13.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })\n    }";

const v14Loop = "for (var p = 0; p < picksV13.length; p++) {\n      var pick = picksV13[p]\n      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)\n      if (returns) allPicksV13.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })\n    }\n    for (var p = 0; p < picksV14.length; p++) {\n      var pick = picksV14[p]\n      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)\n      if (returns) allPicksV14.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })\n    }";

r = r.replace(v13Loop, v14Loop);

fs.writeFileSync('run_v3.js', r, 'utf8');
console.log('V14 collection fixed');
