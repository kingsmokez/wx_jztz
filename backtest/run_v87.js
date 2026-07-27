// run_v87.js - V87上涨趋势信号增强+动态止盈优化
// V84最佳基线: v84_boll_or_flag_atr13 WR=91.18% AR=6.89% n=34
// V87目标: WR>=92% AR>=7.5% n>=30
// 新增: 上升通道突破/多头排列加速/量价齐升加速 + 阶梯止盈+ATR混合退出
var fs = require('fs')
var path = require('path')

var CONFIG = {
  holdDays: [3, 5, 7, 10],
  topN: 20,
  minScore: 55,
  cacheDir: path.join(__dirname, 'cache'),
  outputDir: path.join(__dirname, 'results'),
}

if (!fs.existsSync(CONFIG.outputDir)) fs.mkdirSync(CONFIG.outputDir, { recursive: true })

var { calcTechFromKlines, calcVolumePriceCoord, calcTrendAcceleration, detectConsolidationBreakout, calcCandlePatterns, calcMA, calcADX, calcOBV, calcEMA, calcATR, calcMASlope, calcBollPosition, calcRSI, calcMACD } = require('./indicators')
var { getLimitPct, calcTechScoreV10, calcTechScoreV31 } = require('./scoring')

// 加载V82共享函数 (preFilter/calcVolumeRatioFromKlines/calcPatternScoreV81/calcMarketEnv等)
var v82Code = fs.readFileSync(path.join(__dirname, '_v82_funcs.js'), 'utf8')
eval(v82Code)

// 加载V84形态检测函数 (detectDoubleBottomV84/detectFlagBreakoutV84/detectBigCandleConfirmV84/detectMA20BounceV84/calcPatternScoreV84/calcDynamicATRExitV2/calcVolPriceScoreV84/checkMACDHistogramIncreasingV2)
// _v84_funcs.js 由 run_v84.js 第1-341行提取(全部函数定义, 不含主流程)
var v84Funcs = fs.readFileSync(path.join(__dirname, '_v84_funcs.js'), 'utf8')
eval(v84Funcs)

// V87新增函数(上升通道突破/多头排列加速/量价齐升加速/形态评分/混合退出/选股)已提取到 _v87_funcs.js
eval(fs.readFileSync(path.join(__dirname, '_v87_funcs.js'), 'utf8'))

// ===== V87策略集 =====
// 设计原则: v84_best_base必须与V84主流程完全一致(验证复现), 新策略通过新形态扩大选股池+混合退出提升收益
var ALL_V87_PATS = ['boll_squeeze', 'flag_breakout', 'asc_channel_break', 'bull_align_accel', 'vol_price_accel']
var NEW_PATS_ONLY = ['asc_channel_break', 'bull_align_accel', 'vol_price_accel']
var V87_STRATEGIES = {}

// [基线] V84最佳 (必须复现 WR=91.18% AR=6.89% n=34)
V87_STRATEGIES['v84_best_base'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v84_all', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ['boll_squeeze', 'flag_breakout'],
  minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true
})

// [组1: 新形态扩大选股池] 用V87形态评分引入3种新信号, 退出保持ATR1.3
V87_STRATEGIES['v87_new_pool'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ALL_V87_PATS,
  minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true
})

// [组2: 新形态 + 混合退出] 阶梯止盈锁定利润 + ATR追踪
V87_STRATEGIES['v87_new_hybrid'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', hybridExit: true, atrMultiplier: 1.3, atrTrailingMultiplier: 0.5, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ALL_V87_PATS,
  minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true
})

// [组3: 新形态 + 混合退出 + ATR1.4] 更宽止盈目标捕捉大行情
V87_STRATEGIES['v87_new_hybrid_atr14'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', hybridExit: true, atrMultiplier: 1.4, atrTrailingMultiplier: 0.5, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ALL_V87_PATS,
  minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true
})

// [组4: V84基线形态 + 混合退出] 仅测试混合退出对V84基线的提升
V87_STRATEGIES['v84_base_hybrid'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v84_all', hybridExit: true, atrMultiplier: 1.3, atrTrailingMultiplier: 0.5, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ['boll_squeeze', 'flag_breakout'],
  minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true
})

// [组5: V84基线 + 混合退出 + ATR1.4]
V87_STRATEGIES['v84_base_hybrid_atr14'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v84_all', hybridExit: true, atrMultiplier: 1.4, atrTrailingMultiplier: 0.5, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ['boll_squeeze', 'flag_breakout'],
  minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true
})

// [组6: 新形态 + 混合退出 + top15] 精选15只降低噪音
V87_STRATEGIES['v87_new_hybrid_top15'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', hybridExit: true, atrMultiplier: 1.3, atrTrailingMultiplier: 0.5, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ALL_V87_PATS,
  minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true, topN: 15
})

// [组7: 新形态 + 混合退出 + consec5] 允许更多连涨天数
V87_STRATEGIES['v87_new_hybrid_consec5'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', hybridExit: true, atrMultiplier: 1.3, atrTrailingMultiplier: 0.5, maxConsecUp: 5,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ALL_V87_PATS,
  minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true
})

// [组8: 新形态 + 混合退出 + 量价MACD加分] extraBonus提升排序质量
V87_STRATEGIES['v87_new_hybrid_vp'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', hybridExit: true, atrMultiplier: 1.3, atrTrailingMultiplier: 0.5, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ALL_V87_PATS,
  minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true,
  useVolPriceScore: true, macdIncrBonus: 3, extraBonus: true
})

// [组9: 仅新形态 + 混合退出] 测试新信号独立效果
V87_STRATEGIES['v87_new_only_hybrid'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', hybridExit: true, atrMultiplier: 1.3, atrTrailingMultiplier: 0.5, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: NEW_PATS_ONLY,
  minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true
})

// [组10: 新形态 + 混合退出 + 放宽筛选] 增加样本量
V87_STRATEGIES['v87_new_hybrid_wide'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', hybridExit: true, atrMultiplier: 1.3, atrTrailingMultiplier: 0.5, maxConsecUp: 4,
  ma5Min: 0.08, ma10Min: 0.01, requirePattern: ALL_V87_PATS,
  minScore: 50, patternWeight: 2.0, bollWidthMax: 0.10,
  chgMin: 0.8, chgMax: 3, vrMin: 1.0, rsiMax: 62,
  confirmMACD: true, confirmAboveMA20: true
})

// [组11: V84基线 + 混合退出 + 放宽] 增加基线样本
V87_STRATEGIES['v84_base_hybrid_wide'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v84_all', hybridExit: true, atrMultiplier: 1.3, atrTrailingMultiplier: 0.5, maxConsecUp: 4,
  ma5Min: 0.08, ma10Min: 0.01, requirePattern: ['boll_squeeze', 'flag_breakout'],
  minScore: 50, patternWeight: 2.0, bollWidthMax: 0.10,
  chgMin: 0.8, chgMax: 3, vrMin: 1.0, rsiMax: 62,
  confirmMACD: true, confirmAboveMA20: true
})

// [组12: 新形态 + 混合退出 + ATR1.5] 最宽止盈
V87_STRATEGIES['v87_new_hybrid_atr15'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', hybridExit: true, atrMultiplier: 1.5, atrTrailingMultiplier: 0.5, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ALL_V87_PATS,
  minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true
})

// [组13: 新形态 + ATR1.4] 更宽止盈目标
V87_STRATEGIES['v87_new_pool_atr14'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', atrExit: true, atrMultiplier: 1.4, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ALL_V87_PATS,
  minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true
})

// [组14: 新形态 + ATR1.5] 最宽止盈目标
V87_STRATEGIES['v87_new_pool_atr15'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', atrExit: true, atrMultiplier: 1.5, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ALL_V87_PATS,
  minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true
})

// [组15: 新形态 + minScore60] 提高门槛精选
V87_STRATEGIES['v87_new_pool_min60'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ALL_V87_PATS,
  minScore: 60, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true
})

// [组16: bonus模式 + ATR1.3] V84形态+新形态bonus叠加
V87_STRATEGIES['v87_bonus_pool'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87_bonus', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ALL_V87_PATS,
  minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true, extraBonus: true
})

// [组17: 新形态 + ATR1.3 + consec5] 允许5天连涨
V87_STRATEGIES['v87_new_pool_consec5'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 5,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ALL_V87_PATS,
  minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true
})

// [组18: 新形态 + ATR1.3 + 量价MACD加分] extraBonus提升排序
V87_STRATEGIES['v87_new_pool_vp'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ALL_V87_PATS,
  minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true,
  useVolPriceScore: true, macdIncrBonus: 3, extraBonus: true
})

// [组19: 新形态 + ATR1.3 + top15] 精选15只
V87_STRATEGIES['v87_new_pool_top15'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ALL_V87_PATS,
  minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true, topN: 15
})

// [组20: 新形态 + minScore65] 高门槛精选
V87_STRATEGIES['v87_new_pool_min65'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ALL_V87_PATS,
  minScore: 65, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true
})

// [组21: 新形态 + minScore70] 极高门槛
V87_STRATEGIES['v87_new_pool_min70'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ALL_V87_PATS,
  minScore: 70, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true
})

// [组22: 新形态 + 窄涨幅1-2%] 限制涨幅范围
V87_STRATEGIES['v87_new_pool_narrow'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ALL_V87_PATS,
  minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true
})

// [组23: V84基线形态 + ATR1.4] 基线加宽止盈
V87_STRATEGIES['v84_best_atr14'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v84_all', atrExit: true, atrMultiplier: 1.4, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ['boll_squeeze', 'flag_breakout'],
  minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true
})

// [组24: 新形态 + rsiMax55] 更严格RSI
V87_STRATEGIES['v87_new_pool_rsi55'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ALL_V87_PATS,
  minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 55,
  confirmMACD: true, confirmAboveMA20: true
})

// [组25: 新形态 + vrMin1.5] 更高量比门槛
V87_STRATEGIES['v87_new_pool_vr15'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ALL_V87_PATS,
  minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.5, vrMin: 1.5, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true
})

// [组26: 新形态 + extraBonus + minScore65] 高门槛+额外加分精选
V87_STRATEGIES['v87_new_pool_eb_min65'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ALL_V87_PATS,
  minScore: 65, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.5, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true, extraBonus: true
})

// [组27: 窄涨幅1-2% + 放宽ma] 增加窄涨幅样本量
V87_STRATEGIES['v87_narrow_wide_ma'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
  ma5Min: 0.08, ma10Min: 0.01, requirePattern: ALL_V87_PATS,
  minScore: 50, patternWeight: 2.0, bollWidthMax: 0.10,
  chgMin: 1, chgMax: 2, vrMin: 1.0, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true
})

// [组28: 窄涨幅1-2% + minScore50] 低门槛+窄涨幅
V87_STRATEGIES['v87_narrow_min50'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ALL_V87_PATS,
  minScore: 50, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true
})

// [组29: 窄涨幅1-2.2%] 略微放宽涨幅上限
V87_STRATEGIES['v87_narrow_22'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ALL_V87_PATS,
  minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.2, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true
})

// [组30: rsiMax55 + chgMax2.2] 严格RSI+窄涨幅
V87_STRATEGIES['v87_rsi55_narrow'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ALL_V87_PATS,
  minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2.2, vrMin: 1.2, rsiMax: 55,
  confirmMACD: true, confirmAboveMA20: true
})

// [组31: rsiMax55 + 放宽ma] 严格RSI+宽松MA增加样本
V87_STRATEGIES['v87_rsi55_wide'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', atrExit: true, atrMultiplier: 1.3, maxConsecUp: 4,
  ma5Min: 0.08, ma10Min: 0.01, requirePattern: ALL_V87_PATS,
  minScore: 50, patternWeight: 2.0, bollWidthMax: 0.10,
  chgMin: 1, chgMax: 2.5, vrMin: 1.0, rsiMax: 55,
  confirmMACD: true, confirmAboveMA20: true
})

// [组32: 窄涨幅 + ATR1.4] 窄涨幅+更宽止盈
V87_STRATEGIES['v87_narrow_atr14'] = Object.assign({}, BASE_EXIT, {
  patternMode: 'v87', atrExit: true, atrMultiplier: 1.4, maxConsecUp: 4,
  ma5Min: 0.1, ma10Min: 0.02, requirePattern: ALL_V87_PATS,
  minScore: 55, patternWeight: 2.0, bollWidthMax: 0.09,
  chgMin: 1, chgMax: 2, vrMin: 1.2, rsiMax: 60,
  confirmMACD: true, confirmAboveMA20: true
})

// ===== 主流程 =====
console.log('V87 Backtest: 上涨趋势信号增强+动态止盈优化')
console.log('V84最佳基线: v84_boll_or_flag_atr13 WR=91.18% AR=6.89% n=34')
console.log('Loading cache...')
var cacheFiles = fs.readdirSync(CONFIG.cacheDir).filter(function(f) { return f.startsWith('tx_kline_') && f.endsWith('.json') })
console.log('K-line files: ' + cacheFiles.length)

var klineMap = {}, codes = []
for (var i = 0; i < cacheFiles.length; i++) {
  try {
    var data = JSON.parse(fs.readFileSync(path.join(CONFIG.cacheDir, cacheFiles[i]), 'utf8'))
    var code = cacheFiles[i].replace('tx_kline_', '').replace('.json', '')
    if (data.length >= 60) { klineMap[code] = data; codes.push(code) }
  } catch (e) {}
}
console.log('Valid K-lines: ' + codes.length)

var dateSet = {}
for (var ci = 0; ci < codes.length; ci++) {
  var k = klineMap[codes[ci]]
  for (var ki = 0; ki < k.length; ki++) dateSet[k[ki].date] = true
}
var tradeDates = Object.keys(dateSet).sort()
console.log('Trade dates: ' + tradeDates.length)

var startIdx = 0
for (; startIdx < tradeDates.length; startIdx++) {
  if (tradeDates[startIdx] >= '2024-07-01') break
}
console.log('Start from: ' + tradeDates[startIdx])

console.log('Building day quotes...')
var allQuotes = {}, allIdxMap = {}
for (var di = startIdx; di < tradeDates.length - 14; di += 3) {
  var dateStr = tradeDates[di]
  var dayQuotes = [], dateIdxMap = {}
  for (var ci = 0; ci < codes.length; ci++) {
    var code2 = codes[ci], k2 = klineMap[code2], idx = -1
    for (var ki = 0; ki < k2.length; ki++) {
      if (k2[ki].date === dateStr) { idx = ki; break }
    }
    if (idx < 20) continue
    var kday = k2[idx]
    if (kday.volume <= 0 || kday.close <= 3 || kday.close > 200) continue
    dayQuotes.push({
      code: code2, name: '', price: kday.close,
      changePct: kday.changePct || ((kday.close - k2[idx - 1].close) / k2[idx - 1].close * 100),
      volume: kday.volume, amount: kday.amount || kday.volume * kday.close,
      turnover: 0, amplitude: ((kday.high - kday.low) / kday.low * 100),
      high: kday.high, low: kday.low, open: kday.open, prevClose: k2[idx - 1].close,
      circCap: 0, pe: 0, pb: 0, volumeRatio: 0
    })
    dateIdxMap[code2] = idx
  }
  dayQuotes.sort(function(a, b) { return (b.changePct || 0) - (a.changePct || 0) })
  dayQuotes = dayQuotes.slice(0, 300)
  allQuotes[dateStr] = dayQuotes
  allIdxMap[dateStr] = dateIdxMap
}

var sampleDates = Object.keys(allQuotes).sort()
console.log('Sample dates: ' + sampleDates.length)

console.log('Running backtest...')
var strategyNames = Object.keys(V87_STRATEGIES)
var dynamicPicks = {}
for (var s = 0; s < strategyNames.length; s++) dynamicPicks[strategyNames[s]] = []

for (var si = 0; si < sampleDates.length; si++) {
  var dateStr = sampleDates[si]
  var dayQuotes = allQuotes[dateStr]
  var dateIdxMap = allIdxMap[dateStr]
  var marketEnv = calcMarketEnv(allQuotes, tradeDates, si)

  for (var s = 0; s < strategyNames.length; s++) {
    var sName = strategyNames[s]
    var strategy = V87_STRATEGIES[sName]
    var picks = simulatePickV87(dayQuotes, klineMap, dateIdxMap, strategy.topN || CONFIG.topN, marketEnv, strategy)

    for (var p = 0; p < picks.length; p++) {
      var pick = picks[p]
      var klines = klineMap[pick.code]
      var buyIdx = dateIdxMap[pick.code]
      var atrVal = calcATR(klines.slice(0, buyIdx + 1), 14)
      var atrMult = strategy.atrMultiplier || 1.0
      var atrTrailMult = strategy.atrTrailingMultiplier || 0.5

      var exit
      if (strategy.hybridExit) {
        // V87混合退出: 阶梯止盈锁定利润 + ATR追踪止损
        exit = calcHybridExitV87(pick.price, klines, buyIdx, strategy.maxHoldDays || 21, atrVal, atrMult, atrTrailMult)
      } else if (strategy.dynamicATR) {
        // V84动态ATR退出 (修复版: 盈利2%后激活追踪)
        exit = calcDynamicATRExitV2(pick.price, klines, buyIdx, strategy.maxHoldDays || 21, atrVal, atrMult, atrTrailMult)
      } else {
        // 默认ATR阶梯退出 (V84基线atrExit:true走此分支)
        var atrProfit = atrVal * atrMult
        var atrTrailing = atrVal * atrTrailMult
        exit = calcDynamicExit(pick.price, klines, buyIdx, strategy.maxHoldDays || 21, strategy.stopLoss,
          [{ profitPct: atrProfit / pick.price * 100, trailingPct: atrTrailing / pick.price * 100 }])
      }

      dynamicPicks[sName].push({
        code: pick.code, date: dateStr, patternName: pick.patternName,
        buyPrice: pick.price, exitPrice: exit.exitPrice, exitDay: exit.exitDay,
        finalReturn: exit.finalReturn, exitReason: exit.exitReason, maxReturn: exit.maxReturn,
        totalScore: pick.totalScore
      })
    }
  }
  if (si % 20 === 0) process.stdout.write('.')
}

console.log('\nComputing results...')
var output = []
var v84WR = 91.18, v84AR = 6.89
var results = []

output.push('V87 Backtest: 上涨趋势信号增强+动态止盈优化')
output.push('V84最佳基线: v84_boll_or_flag_atr13 WR=91.18% AR=6.89% n=34')
output.push('Period: 2024-07-01 ~ 2026-07-24, 3-day sampling, ' + codes.length + ' stocks, ' + sampleDates.length + ' days')
output.push('')
output.push('Strategy'.padEnd(32) + '  n   WR%   AR%  AvgD vsV84WR vsV84AR')
output.push('-'.repeat(85))

for (var s = 0; s < strategyNames.length; s++) {
  var sName = strategyNames[s]
  var stats = calcDynamicStats(dynamicPicks[sName])
  var vsWR = Math.round((stats.winRate - v84WR) * 100) / 100
  var vsAR = Math.round((stats.avgReturn - v84AR) * 100) / 100
  var line = sName.padEnd(32) +
    String(stats.total).padStart(4) + ' ' +
    String(stats.winRate).padStart(5) + ' ' +
    String(stats.avgReturn).padStart(5) + ' ' +
    String(stats.avgExitDay).padStart(5) + ' ' +
    (vsWR >= 0 ? '+' : '') + String(vsWR).padStart(6) + ' ' +
    (vsAR >= 0 ? '+' : '') + String(vsAR).padStart(5)
  output.push(line)
  results.push({ name: sName, stats: stats, score: stats.winRate * 0.35 + stats.avgReturn * 6 + stats.total * 0.05 })
}

output.push('')
output.push('=== Sorted by composite (WR*0.35 + AR*6 + n*0.05) ===')
results.sort(function(a, b) { return b.score - a.score })
for (var i = 0; i < results.length; i++) {
  output.push(String(i + 1).padStart(2) + '. ' + results[i].name.padEnd(32) +
    ' WR=' + results[i].stats.winRate + '% AR=' + results[i].stats.avgReturn + '% n=' + results[i].stats.total +
    ' Score=' + Math.round(results[i].score * 100) / 100)
}

output.push('')
output.push('=== WR>=92% and AR>=7.0% and n>=30 ===')
for (var i = 0; i < results.length; i++) {
  if (results[i].stats.winRate >= 92 && results[i].stats.avgReturn >= 7.0 && results[i].stats.total >= 30) {
    output.push('  ' + results[i].name + ': WR=' + results[i].stats.winRate + '% AR=' + results[i].stats.avgReturn + '% n=' + results[i].stats.total)
  }
}

output.push('')
output.push('=== WR>=90% and AR>=6.5% and n>=30 ===')
for (var i = 0; i < results.length; i++) {
  if (results[i].stats.winRate >= 90 && results[i].stats.avgReturn >= 6.5 && results[i].stats.total >= 30) {
    output.push('  ' + results[i].name + ': WR=' + results[i].stats.winRate + '% AR=' + results[i].stats.avgReturn + '% n=' + results[i].stats.total)
  }
}

// 形态分布统计 (最优策略)
output.push('')
output.push('=== Pattern distribution (top strategy) ===')
var topStrategy = results[0]
if (topStrategy) {
  var patternCount = {}
  var picksArr = dynamicPicks[topStrategy.name]
  for (var i = 0; i < picksArr.length; i++) {
    var p = picksArr[i].patternName || 'unknown'
    if (!patternCount[p]) patternCount[p] = { count: 0, wins: 0, totalRet: 0 }
    patternCount[p].count++
    if (picksArr[i].finalReturn > 0) patternCount[p].wins++
    patternCount[p].totalRet += picksArr[i].finalReturn
  }
  var patternNames = Object.keys(patternCount).sort(function(a, b) { return patternCount[b].count - patternCount[a].count })
  output.push('Pattern'.padEnd(22) + '  n   WR%   AR%')
  for (var i = 0; i < patternNames.length; i++) {
    var pn = patternNames[i]
    var pc = patternCount[pn]
    var wr = pc.count > 0 ? Math.round(pc.wins / pc.count * 10000) / 100 : 0
    var ar = pc.count > 0 ? Math.round(pc.totalRet / pc.count * 100) / 100 : 0
    output.push(pn.padEnd(22) + String(pc.count).padStart(4) + ' ' + String(wr).padStart(5) + ' ' + String(ar).padStart(5))
  }
}

var resultText = output.join('\n')
fs.writeFileSync(path.join(CONFIG.outputDir, 'backtest_V87.txt'), resultText, 'utf8')
console.log('\n' + resultText)
console.log('\nResult saved to results/backtest_V87.txt')
