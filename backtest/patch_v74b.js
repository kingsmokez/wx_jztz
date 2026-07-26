const fs = require('fs');
const p = 'D:/wx_jztz/backtest/run_v74.js';
let code = fs.readFileSync(p, 'utf8');

// 1. 替换策略定义
const s1 = code.indexOf('var V73_STRATEGIES');
const s2 = code.indexOf('async function runBacktest()');
if (s1 > 0 && s2 > 0) {
  const ns = ar V74_STRATEGIES = {
  "v74_v73base": {
    stopLoss: -100, trailingRules: [
      { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }
    ], maxHoldDays: 21, ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze', minScore: 65, patternWeight: 2.0,
    chgMin: 1, chgMax: 2.5, vrMin: 1.8, adxMin: 20, rsiMax: 60
  },
  "v74_boll_relax_any": {
    stopLoss: -100, trailingRules: [
      { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }
    ], maxHoldDays: 21, ma5Min: 0.05, ma10Min: 0, requirePattern: 'any', minScore: 60, patternWeight: 2.0,
    chgMin: 0.5, chgMax: 4, vrMin: 1.2, adxMin: 15, rsiMax: 68
  },
  "v74_boll_relax_only": {
    stopLoss: -100, trailingRules: [
      { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }
    ], maxHoldDays: 21, ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze', minScore: 60, patternWeight: 2.0,
    chgMin: 0.5, chgMax: 4, vrMin: 1.2, adxMin: 15, rsiMax: 68
  },
  "v74_ma_macd": {
    stopLoss: -100, trailingRules: [
      { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }
    ], maxHoldDays: 21, ma5Min: 0.05, ma10Min: 0, requirePattern: 'any', allowedPatterns: ['ma_support_bounce', 'macd_golden_vol'], minScore: 60, patternWeight: 2.5,
    chgMin: 0.5, chgMax: 4, vrMin: 1.2, adxMin: 15, rsiMax: 68
  },
  "v74_breakout": {
    stopLoss: -100, trailingRules: [
      { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }
    ], maxHoldDays: 21, ma5Min: 0.05, ma10Min: 0, requirePattern: 'any', allowedPatterns: ['breakout_20d_high', 'platform_break'], minScore: 60, patternWeight: 2.5,
    chgMin: 0.5, chgMax: 5, vrMin: 1.2, adxMin: 15, rsiMax: 70
  },
  "v74_multi_strict": {
    stopLoss: -100, trailingRules: [
      { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }
    ], maxHoldDays: 21, ma5Min: 0.05, ma10Min: 0, requirePattern: 'any', minScore: 70, patternWeight: 2.0,
    chgMin: 0.5, chgMax: 4, vrMin: 1.2, adxMin: 18, rsiMax: 65
  },
  "v74_multi_medium": {
    stopLoss: -100, trailingRules: [
      { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }
    ], maxHoldDays: 21, ma5Min: 0.05, ma10Min: 0, requirePattern: 'any', minScore: 60, patternWeight: 2.0,
    chgMin: 0.5, chgMax: 4, vrMin: 1.2, adxMin: 15, rsiMax: 68
  },
  "v74_multi_aggressive": {
    stopLoss: -100, trailingRules: [
      { profitPct: 4, trailingPct: 1 }, { profitPct: 7, trailingPct: 2 }, { profitPct: 10, trailingPct: 3 }
    ], maxHoldDays: 21, ma5Min: 0.05, ma10Min: 0, requirePattern: 'any', minScore: 60, patternWeight: 2.0,
    chgMin: 0.5, chgMax: 4, vrMin: 1.2, adxMin: 15, rsiMax: 68
  },
  "v74_boll_adx25": {
    stopLoss: -100, trailingRules: [
      { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }
    ], maxHoldDays: 21, ma5Min: 0.1, ma10Min: 0.02, requirePattern: 'boll_squeeze', minScore: 65, patternWeight: 2.0,
    chgMin: 0.8, chgMax: 3.5, vrMin: 1.5, adxMin: 25, rsiMax: 65
  },
  "v74_multi_sl8": {
    stopLoss: -8, trailingRules: [
      { profitPct: 3, trailingPct: 1 }, { profitPct: 5, trailingPct: 2 }, { profitPct: 8, trailingPct: 3 }
    ], maxHoldDays: 21, ma5Min: 0.05, ma10Min: 0, requirePattern: 'any', minScore: 60, patternWeight: 2.0,
    chgMin: 0.5, chgMax: 4, vrMin: 1.2, adxMin: 15, rsiMax: 68
  },
}

;
  code = code.substring(0, s1) + ns + code.substring(s2);
  console.log('Strategies replaced');
}

// 2. 替换引用
code = code.replace(/V73_STRATEGIES/g, 'V74_STRATEGIES');
code = code.replace(/V73 Strategy Backtest: RSI阈值精细搜索/g, 'V74 Strategy Backtest: 多形态融合+放宽参数+扩大选股');
code = code.replace(/backtest_v70\.txt/g, 'backtest_v74.txt');
code = code.replace(/backtest\/results\/backtest_v70\.txt/g, 'backtest/results/backtest_v74.txt');
code = code.replace(
  "var patternNames = ['gapUp', 'platform_break', 'trend_accel', 'pullback_restart', 'boll_squeeze']",
  "var patternNames = ['boll_squeeze', 'ma_support_bounce', 'breakout_20d_high', 'macd_golden_vol', 'platform_break', 'pullback_restart']"
);

fs.writeFileSync(p, code, 'utf8');
console.log('V74 file fully updated');