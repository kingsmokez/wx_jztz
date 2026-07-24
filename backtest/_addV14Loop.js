const fs = require('fs');
let r = fs.readFileSync('run_v3.js', 'utf8');

// 在V13循环结束后、picksOpt循环前添加V14循环
const v13LoopEnd = "if (returns) allPicksV13.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })\n      \n    }\n    for (var p = 0; p < picksOpt.length;";

const v14LoopInsert = "if (returns) allPicksV13.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })\n    }\n    for (var p = 0; p < picksV14.length; p++) {\n      var pick = picksV14[p]\n      var returns = calcHoldingReturn(pick.price, klineMap[pick.code], dateIdxMap[pick.code], CONFIG.holdDays)\n      if (returns) allPicksV14.push({ date: dateStr, code: pick.code, price: pick.price, changePct: pick.changePct, score: pick.score, returns: returns })\n    }\n    for (var p = 0; p < picksOpt.length;";

r = r.replace(v13LoopEnd, v14LoopInsert);

fs.writeFileSync('run_v3.js', r, 'utf8');
console.log('V14 loop added');
