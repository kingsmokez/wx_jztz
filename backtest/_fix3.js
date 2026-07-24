var fs = require('fs');
var src = fs.readFileSync('run_v3.js', 'utf8');

// Fix 1: Replace the entire score function branch in simulatePick
var oldBranch = 'if (scoreFunc === "original") {\n      score = calcTechScoreOriginal(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d)\n    } else if (scoreFunc === \'v10\') {\n      score = calcTechScoreV10(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)\n    } else {\n      score = calcTechScoreOptimized(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)\n    }';

var newBranch = 'if (scoreFunc === "original") {\n      score = calcTechScoreOriginal(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d)\n    } else if (scoreFunc === "v10") {\n      score = calcTechScoreV10(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)\n    } else if (scoreFunc === "v11") {\n      score = calcTechScoreV11(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)\n    } else {\n      score = calcTechScoreOptimized(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)\n    }';

src = src.replace(oldBranch, newBranch);

// Fix 2: minScore to 55
src = src.replace('if (score >= 45)', 'if (score >= CONFIG.minScore)');

// Fix 3: Also check if there's a duplicate v11 branch from earlier attempt
// Remove any orphaned v11 branch that might be before v10
var orphanPattern = '} else if (scoreFunc === "v11") {\n      score = calcTechScoreV11(stock, techData.rsi, techData.goldenCross, volumeRatio, techData.bollPosition, stock.code, techData.change5d, techData)\n    } else if (scoreFunc === "v10") {';
var cleanPattern = '} else if (scoreFunc === "v10") {';
src = src.replace(orphanPattern, cleanPattern);

fs.writeFileSync('run_v3.js', src, 'utf8');
console.log('Fixed simulatePick branches');
