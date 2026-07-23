const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { evaluateStock, multiFactorEvaluate, industryConcentrationLimit, calculateBuySell, quickScore } = require('./evaluate')

exports.main = async (event, context) => {
  const { action, data = {} } = event
  try {
    switch (action) {
      case 'evaluate': {
        const result = evaluateStock(data.stock, data.techData, data.marketTrend)
        return { success: true, data: result }
      }
      case 'batch': {
        const results = []
        const stocks = data.stocks || []
        for (const stock of stocks) {
          try {
            const result = evaluateStock(stock, stock.techData, data.marketTrend)
            if (result) results.push(result)
          } catch (e) { console.error('Batch eval error:', e.message) }
        }
        results.sort((a, b) => (b.v5Score || 0) - (a.v5Score || 0))
        const limited = industryConcentrationLimit(results, data.maxPerIndustry || 2, data.minCount || 5)
        return { success: true, data: limited }
      }
      case 'quickScore': {
        const score = quickScore(data.stock)
        return { success: true, data: { score } }
      }
      case 'buySell': {
        const bs = calculateBuySell(data.stock, data.v5Score || 50, data.techData)
        return { success: true, data: bs }
      }
      default:
        return { success: false, error: '未知操作' }
    }
  } catch (err) {
    console.error('scoring error:', err)
    return { success: false, error: err.message }
  }
}
