const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const http = require('./http')

const TTL = {
  QUOTES: 60,
  FINANCIALS: 3600,
  INDUSTRY: 86400,
  PICK: 300,
}

async function getFromCache(collection, key, ttlSeconds) {
  try {
    const res = await db.collection(collection).where({
      _key: key,
      cachedAt: _.gte(Date.now() - ttlSeconds * 1000),
    }).limit(1).get()
    return res.data.length > 0 ? res.data[0] : null
  } catch { return null }
}

async function setCache(collection, key, data) {
  try {
    const existing = await db.collection(collection).where({ _key: key }).limit(1).get()
    const doc = { _key: key, ...data, cachedAt: Date.now() }
    if (existing.data.length > 0) {
      await db.collection(collection).doc(existing.data[0]._id).update({ data: doc })
    } else {
      await db.collection(collection).add({ data: doc })
    }
  } catch (err) { console.error('Cache write failed:', err.message) }
}

// ===== 核心数据获取 =====

async function getQuotes(codes) {
  if (!codes || codes.length === 0) return {}
  const cacheKey = 'q_' + codes.length + '_' + codes[0]
  const cached = await getFromCache('stock_cache', cacheKey, TTL.QUOTES)
  if (cached && cached.quotes) return cached.quotes

  const quotes = await http.fetchTencentQuotes(codes)
  if (Object.keys(quotes).length > 0) {
    await setCache('stock_cache', cacheKey, { quotes })
  }
  return quotes
}

async function getFinancials(codes) {
  if (!codes || codes.length === 0) return {}
  const cacheKey = 'f_' + codes.length + '_' + codes[0]
  const cached = await getFromCache('financial_cache', cacheKey, TTL.FINANCIALS)
  if (cached && cached.financials) return cached.financials

  const financials = await http.fetchFinancialData(codes)
  if (Object.keys(financials).length > 0) {
    await setCache('financial_cache', cacheKey, { financials })
  }
  return financials
}

async function getKline(code, count = 120) {
  if (!code) return null
  return await http.fetchKline(code, count)
}

async function getAuctionCandidates(pages = 5) {
  return await http.fetchSinaAuctionCandidates(pages)
}

async function getEMRank(page, pageSize, sortField, sortOrder) {
  return await http.fetchEMRank(page, pageSize, sortField, sortOrder)
}

async function getIndustries(codes) {
  if (!codes || codes.length === 0) return {}
  return await http.fetchStockIndustry(codes)
}

async function searchStock(keyword) {
  return await http.searchStock(keyword)
}

exports.main = async (event, context) => {
  const { action, data = {} } = event
  try {
    switch (action) {
      case 'quotes':
        return { success: true, data: await getQuotes(data.codes || []), cached: false }
      case 'financials':
        return { success: true, data: await getFinancials(data.codes || []), cached: false }
      case 'kline':
        return { success: true, data: await getKline(data.code, data.count || 120) }
      case 'auctionCandidates':
        return { success: true, data: await getAuctionCandidates(data.pages || 5) }
      case 'emRank':
        return { success: true, data: await getEMRank(data.page || 1, data.pageSize || 200, data.sortField || 'f3', data.sortOrder || 0) }
      case 'industry':
        return { success: true, data: await getIndustries(data.codes || []) }
      case 'search':
        return { success: true, data: await searchStock(data.keyword || '') }
      default:
        return { success: false, error: '未知操作' }
    }
  } catch (err) {
    console.error('dataFetcher error:', err)
    return { success: false, error: err.message }
  }
}
