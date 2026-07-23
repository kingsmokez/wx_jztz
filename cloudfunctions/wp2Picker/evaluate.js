/**
 * 五因子评分引擎 — 对齐原版 modules/scoring.py
 * 
 * 评分流程:
 * 1. 基础过滤 (ST/北交所/B股/停牌/低换手率/白酒银行)
 * 2. 动量拒绝过滤 (20日动量 < -15%)
 * 3. 五维评分: 价值36% + 质量11% + 成长8% + 动量12% + 情绪33%
 * 4. 行业PE动态阈值
 * 5. 行业集中度限制
 * 6. 买卖建议计算
 */

const { FACTOR_WEIGHTS, SECTOR_PE_RANGES, LIQUOR_NAMES, BANK_CODES, MIN_SCORE_TO_RETURN, INDUSTRY_MAX_PER } = require('./config')

/**
 * 统一字段访问 — 支持小程序字段命名
 */
function getField(stock, ...names) {
  for (const name of names) {
    if (stock[name] !== undefined && stock[name] !== null) return stock[name]
  }
  return 0
}

function safeFloat(value, defaultVal = 0) {
  const n = parseFloat(value)
  return isNaN(n) ? defaultVal : n
}

/**
 * 识别股票所属行业板块 — 对齐原版 _match_sector()
 */
function matchSector(stock) {
  const name = getField(stock, 'name', 'stockName') || ''
  const industry = getField(stock, 'industry', 'industryName') || ''
  const searchText = (industry + name).toLowerCase()

  for (const [sector, range] of Object.entries(SECTOR_PE_RANGES)) {
    for (const kw of range.keywords) {
      if (searchText.includes(kw.toLowerCase())) return sector
    }
    for (const n of range.names) {
      if (searchText.includes(n.toLowerCase())) return sector
    }
  }
  return 'default'
}

/**
 * PE评分 — 对齐原版 _pe_score()
 */
function peScore(pe, sector = '') {
  if (pe <= 0) return 5
  const range = SECTOR_PE_RANGES[sector]
  if (range) {
    if (pe <= range.peLow) return 85
    if (pe <= range.peMax) return 60 + (range.peMax - pe) / (range.peMax - range.peLow) * 25
    if (pe <= range.peMax * 1.5) return 40
    return 20
  }
  if (pe <= 15) return 85
  if (pe <= 25) return 70
  if (pe <= 40) return 55
  if (pe <= 60) return 40
  if (pe <= 100) return 25
  return 10
}

/**
 * PB评分
 */
function pbScore(pb) {
  if (pb <= 0) return 5
  if (pb <= 1) return 80
  if (pb <= 2) return 65
  if (pb <= 3) return 50
  if (pb <= 5) return 35
  if (pb <= 10) return 20
  return 10
}

/**
 * ROE评分
 */
function roeScore(roe) {
  if (roe < 0) return 0
  if (roe >= 18) return 85 + Math.min((roe - 18) * 2, 15)
  if (roe >= 15) return 65 + (roe - 15) * 6.67
  if (roe >= 10) return 40 + (roe - 10) * 5
  if (roe >= 5) return 20 + (roe - 5) * 4
  return roe * 4
}

/**
 * 价值因子评分
 */
function mfScoreValue(stock) {
  const pe = safeFloat(getField(stock, 'pe', 'PE'))
  const pb = safeFloat(getField(stock, 'pb', 'PB'))
  const roe = safeFloat(getField(stock, 'roe', 'ROE'))
  const sector = matchSector(stock)
  const marketCap = safeFloat(getField(stock, 'marketCap', 'market_cap', 'circCap'))

  let score = 0
  score += peScore(pe, sector) * 0.4
  score += pbScore(pb) * 0.2
  score += roeScore(roe) * 0.4

  if (marketCap >= 30 && marketCap <= 500) score += 5
  else if (marketCap > 500 && marketCap <= 3000) score += 3

  return Math.min(100, Math.max(0, score))
}

/**
 * 质量因子评分
 */
function mfScoreQuality(stock) {
  const roe = safeFloat(getField(stock, 'roe', 'ROE'))
  const debtRatio = safeFloat(getField(stock, 'debtRatio', 'debt_ratio'))
  const grossMargin = safeFloat(getField(stock, 'grossMargin', 'gross_margin'))

  let score = 50

  if (roe >= 15) score += 20
  else if (roe >= 10) score += 12
  else if (roe >= 5) score += 5
  else if (roe < 0) score -= 20

  if (debtRatio > 0 && debtRatio <= 30) score += 15
  else if (debtRatio > 30 && debtRatio <= 50) score += 8
  else if (debtRatio > 70) score -= 10

  if (grossMargin >= 40) score += 15
  else if (grossMargin >= 25) score += 8
  else if (grossMargin >= 15) score += 3
  else if (grossMargin > 0 && grossMargin < 10) score -= 5

  return Math.min(100, Math.max(0, score))
}

/**
 * 成长因子评分
 */
function mfScoreGrowth(stock) {
  const revGrowth = safeFloat(getField(stock, 'revGrowth', 'rev_growth', 'revenueGrowth'))
  const profitGrowth = safeFloat(getField(stock, 'profitGrowth', 'profit_growth'))

  let score = 50

  if (revGrowth >= 30) score += 20
  else if (revGrowth >= 15) score += 12
  else if (revGrowth >= 5) score += 5
  else if (revGrowth < 0) score -= 10

  if (profitGrowth >= 30) score += 20
  else if (profitGrowth >= 15) score += 12
  else if (profitGrowth >= 5) score += 5
  else if (profitGrowth < 0) score -= 10

  if (revGrowth > 0 && profitGrowth > 0) score += 10

  return Math.min(100, Math.max(0, score))
}

/**
 * 动量因子评分
 */
function mfScoreMomentum(techData) {
  if (!techData) return 50

  let score = 50
  const rsi = safeFloat(techData.rsi)
  const macdObj = techData.macdObj || techData

  if (rsi >= 50 && rsi <= 65) score += 15
  else if (rsi >= 40 && rsi < 50) score += 5
  else if (rsi > 65 && rsi <= 75) score += 5
  else if (rsi > 75) score -= 10
  else if (rsi < 30) score -= 5

  if (macdObj.goldenCross) score += 15

  const ma = techData.ma || {}
  if (ma.bullAlign) score += 15
  else if (ma.bearAlign) score -= 10

  return Math.min(100, Math.max(0, score))
}

/**
 * 情绪因子评分
 */
function mfScoreSentiment(stock, techData) {
  let score = 50

  const changePct = safeFloat(getField(stock, 'changePct', 'change_pct', 'change_pct'))
  const turnover = safeFloat(getField(stock, 'turnover', 'turnoverRate', 'turnover_rate'))
  const volumeRatio = safeFloat(getField(stock, 'volumeRatio', 'volume_ratio'))
  const amount = safeFloat(getField(stock, 'amount', ' Amount'))

  if (changePct >= 2 && changePct <= 6) score += 15
  else if (changePct >= 1 && changePct < 2) score += 8
  else if (changePct > 6 && changePct <= 9.5) score += 5
  else if (changePct < -3) score -= 15

  if (turnover >= 1 && turnover <= 8) score += 12
  else if (turnover >= 0.5 && turnover < 1) score += 5
  else if (turnover > 8 && turnover <= 15) score += 5
  else if (turnover > 15) score -= 5

  if (volumeRatio >= 1.5 && volumeRatio <= 3) score += 15
  else if (volumeRatio >= 1 && volumeRatio < 1.5) score += 5
  else if (volumeRatio > 3 && volumeRatio <= 5) score += 8
  else if (volumeRatio > 5) score -= 5

  if (amount >= 500000000) score += 8
  else if (amount >= 100000000) score += 4

  if (techData) {
    const momentum20 = safeFloat(techData.momentum_20)
    if (momentum20 >= 10) score += 10
    else if (momentum20 >= 5) score += 5
    else if (momentum20 < -10) score -= 10
  }

  return Math.min(100, Math.max(0, score))
}

/**
 * 多因子综合评分
 */
function multiFactorEvaluate(stock, techData = null) {
  const valueScore = mfScoreValue(stock)
  const qualityScore = mfScoreQuality(stock)
  const growthScore = mfScoreGrowth(stock)
  const momentumScore = mfScoreMomentum(techData)
  const sentimentScore = mfScoreSentiment(stock, techData)

  const v5Total = Math.round(
    valueScore * FACTOR_WEIGHTS.value +
    qualityScore * FACTOR_WEIGHTS.quality +
    growthScore * FACTOR_WEIGHTS.growth +
    momentumScore * FACTOR_WEIGHTS.momentum +
    sentimentScore * FACTOR_WEIGHTS.sentiment
  )

  // V5.5 ROE惩罚
  let adjustedTotal = v5Total
  const roe = safeFloat(getField(stock, 'roe', 'ROE'))
  if (roe > 0 && roe < 5) adjustedTotal = Math.round(adjustedTotal * 0.80)
  else if (roe > 0 && roe < 8) adjustedTotal = Math.round(adjustedTotal * 0.90)

  if (qualityScore < 25) adjustedTotal = Math.round(adjustedTotal * 0.85)

  const factors = {
    value: Math.round(valueScore),
    quality: Math.round(qualityScore),
    growth: Math.round(growthScore),
    momentum: Math.round(momentumScore),
    sentiment: Math.round(sentimentScore),
  }

  let recommendation
  if (adjustedTotal >= 80) recommendation = '强烈推荐'
  else if (adjustedTotal >= 65) recommendation = '推荐'
  else if (adjustedTotal >= 50) recommendation = '观望'
  else if (adjustedTotal >= 35) recommendation = '谨慎'
  else recommendation = '回避'

  const reasons = []
  if (valueScore >= 70) reasons.push('价值优势突出')
  else if (valueScore < 30) reasons.push('估值偏高')
  if (qualityScore >= 70) reasons.push('财务质量优秀')
  else if (qualityScore < 30) reasons.push('财务质量欠佳')
  if (growthScore >= 70) reasons.push('成长性优异')
  if (momentumScore >= 70) reasons.push('技术面强势')
  if (sentimentScore >= 70) reasons.push('市场情绪积极')
  else if (sentimentScore < 30) reasons.push('市场情绪低迷')

  return {
    v5Total: adjustedTotal,
    v5Factors: factors,
    v5Reasons: reasons,
    recommendation,
    valueScore, qualityScore, growthScore, momentumScore, sentimentScore,
  }
}

/**
 * 完整股票评估
 */
function evaluateStock(stock, techData = null, marketTrend = 'unknown') {
  const name = getField(stock, 'name', 'stockName') || ''
  const code = getField(stock, 'code', 'stockCode') || ''

  // 基础过滤
  if (name.includes('ST') || name.includes('*') || name.includes('退') || name.startsWith('N')) return null
  if (code.startsWith('8') || code.startsWith('4') || code.startsWith('920')) return null
  if (code.startsWith('900') || code.startsWith('200') || code.startsWith('A2')) return null
  if (LIQUOR_NAMES.includes(name) || BANK_CODES.includes(code)) return null

  // 换手率过滤
  const turnover = safeFloat(getField(stock, 'turnover', 'turnoverRate'))
  const changePct = safeFloat(getField(stock, 'changePct', 'change_pct'))
  if (turnover === 0 && changePct === 0) return null
  if (turnover > 0 && turnover < 0.3) return null

  // 动量拒绝过滤
  const momentumThreshold = marketTrend === 'bear' ? -20 : -15
  if (techData && techData.momentum_20 !== undefined && techData.momentum_20 < momentumThreshold) return null
  else if (stock.momentum_20 !== undefined && stock.momentum_20 < momentumThreshold) return null

  const result = multiFactorEvaluate(stock, techData)
  if (!result || result.v5Total < MIN_SCORE_TO_RETURN) return null

  return {
    ...stock,
    v5Score: result.v5Total,
    v5Factors: result.v5Factors,
    v5Reasons: result.v5Reasons,
    v5Recommendation: result.recommendation,
    score: result.v5Total,
    totalScore: result.v5Total,
    recommendation: result.recommendation,
  }
}

/**
 * 行业集中度限制
 */
function industryConcentrationLimit(results, maxPerIndustry = INDUSTRY_MAX_PER, minCount = 5) {
  if (!results || results.length === 0) return results
  const industryCount = {}
  const filtered = []

  for (const stock of results) {
    const industry = stock.industry || '未知'
    const count = industryCount[industry] || 0
    if (count < maxPerIndustry) {
      filtered.push(stock)
      industryCount[industry] = count + 1
    }
    if (filtered.length >= 30) break
  }

  if (filtered.length < minCount) {
    const seen = new Set(filtered.map(s => s.code))
    for (const stock of results) {
      if (!seen.has(stock.code)) {
        filtered.push(stock)
        if (filtered.length >= minCount) break
      }
    }
  }

  return filtered
}

/**
 * 买卖建议
 */
function calculateBuySell(stock, v5Score, techData = null) {
  const price = safeFloat(getField(stock, 'price', 'currentPrice'))
  if (price <= 0) return null

  let buyDiscount = 0.05
  let sellPremium = 0.08

  if (v5Score >= 75) { buyDiscount = 0.03; sellPremium = 0.12 }
  else if (v5Score >= 60) { buyDiscount = 0.05; sellPremium = 0.10 }
  else if (v5Score < 40) { buyDiscount = 0.10; sellPremium = 0.05 }

  if (techData) {
    const rsi = safeFloat(techData.rsi)
    if (rsi > 70) sellPremium = Math.max(sellPremium, 0.03)
    if (rsi < 30) buyDiscount = Math.min(buyDiscount, 0.02)
  }

  const buyPrice = Math.round(price * (1 - buyDiscount) * 100) / 100
  const sellPrice = Math.round(price * (1 + sellPremium) * 100) / 100
  const stopLoss = Math.round(price * 0.93 * 100) / 100

  return {
    buyPrice, sellPrice, stopLoss,
    buyDiscount: Math.round(buyDiscount * 10000) / 100,
    sellPremium: Math.round(sellPremium * 10000) / 100,
  }
}

/**
 * 快速评分
 */
function quickScore(stock) {
  let score = 0
  const pe = safeFloat(getField(stock, 'pe', 'PE'))
  const marketCap = safeFloat(getField(stock, 'marketCap', 'market_cap'))
  const roe = safeFloat(getField(stock, 'roe', 'ROE'))
  const turnover = safeFloat(getField(stock, 'turnover', 'turnoverRate'))

  if (pe > 0 && pe <= 20) score += 25
  else if (pe > 20 && pe <= 40) score += 15
  else if (pe > 0) score += 5

  if (marketCap >= 30) score += 25
  else if (marketCap >= 10) score += 15

  if (roe >= 10) score += 25
  else if (roe >= 5) score += 15
  else if (roe > 0) score += 5
  else score += 10

  if (turnover >= 0.5 && turnover <= 10) score += 25
  else if (turnover > 10) score += 15
  else score += 5

  return score
}

module.exports = {
  matchSector,
  peScore, pbScore, roeScore,
  mfScoreValue, mfScoreQuality, mfScoreGrowth, mfScoreMomentum, mfScoreSentiment,
  multiFactorEvaluate,
  evaluateStock,
  industryConcentrationLimit,
  calculateBuySell,
  quickScore,
}
