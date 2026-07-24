const fs = require('fs');
let r = fs.readFileSync('run_v3.js', 'utf8');

// 为V14使用更高的minScore(60)
r = r.replace(
  'if (score >= CONFIG.minScore) {',
  'var minS = scoreFunc === "v14" ? 60 : CONFIG.minScore\n    if (score >= minS) {'
);

fs.writeFileSync('run_v3.js', r, 'utf8');
console.log('V14 minScore=60 set');
