/**
 * 回测框架 - 价值投资之王短线强势股策略优化
 * 核心流程:
 * 1. 获取历史交易日列表
 * 2. 对每个交易日: 获取当日涨幅榜+换手率榜 → 粗筛 → 获取K线+技术指标 → 策略筛选
 * 3. 跟踪筛选出的股票后续N天收益
 * 4. 计算胜率(WR)和平均收益率(AR)
 */
var https = require('https')
var http = require('http')
var fs = require('fs')
var path = require('path')

var CONFIG = {
  startDate: '2024-07-01',
  endDate: '2026-06-30',
  sampleDaysPerMonth: 3,
  holdDays: [3, 5, 10, 21],
  strategy: {
    bollSqueezeWidth: 0.08,
    bollSqueezeWidthAlt: 0.06,
    bollPositionMin: 0.7,
    changePctMin: 1,
    changePctMax: 2.5,
    volumeRatioMin: 1.8,
    rsiMax: 60,
    adxMin: 25,
    ma5SlopeMin: 0.1,
    ma10SlopeMin: 0.02,
    pricePosVsHighMin: 0.95,
    relativeStrengthMin: 6,
    maxConsecUp: 5,
    rankingScoreMin: 55,
    blendedScoreMin: 65,
    bollPositionMax: 0.85,
  },
  requestTimeout: 8000,
  requestDelay: 200,
}

function request(url, options) {
  return new Promise(function(resolve, reject) {
    var mod = url.startsWith('https') ? https : http
    var req = mod.get(url, { timeout: options.timeout || 8000, headers: options.headers || {} }, function(res) {
      var chunks = []
      res.on('data', function(chunk) { chunks.push(chunk) })
      res.on('end', function() { resolve(Buffer.concat(chunks).toString('utf-8')) })
    })
    req.on('error', reject)
    req.on('timeout', function() { req.destroy(); reject(new Error('timeout')) })
  })
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms) }) }

async function getTradeDays(startDate, endDate) {
  var url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.000300&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=0&beg=' + startDate.replace(/-/g, '') + '&end=' + endDate.replace(/-/g, '')
  try {
    var text = await request(url, { timeout: 10000 })
    var data = JSON.parse(text)
    if (!data.data || !data.data.klines) return []
    var days = data.data.klines.map(function(k) { return k.split(',')[0] })
    console.log('[交易日] 获取到 ' + days.length + ' 个交易日')
    return days
  } catch(e) { console.error('[交易日] 失败:', e.message); return [] }
}

async function fetchDayStocks(field, count) {
  var url = 'https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=' + count + '&po=1&np=1&fltt=2&invt=2&fid=' + field + '&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f14,f15,f16,f17,f18,f20,f21,f23,f24,f25,f26,f100'
  try {
    var text = await request(url, { timeout: CONFIG.requestTimeout, headers: { 'User-Agent': 'Mozilla/5.0' } })
    var data = JSON.parse(text)
    if (!data.data || !data.data.diff) return {}
    var stocks = {}
    for (var i = 0; i < data.data.diff.length; i++) {
      var item = data.data.diff[i]
      var code = String(item.f12 || '')
      if (!code || code.startsWith('8') || code.startsWith('4') || code.startsWith('920')) continue
      var name = String(item.f14 || '')
      if (name.indexOf('ST') >= 0 || name.indexOf('退') >= 0) continue
      stocks[code] = {
        code: code, name: name, price: item.f2 || 0, changePct: item.f3 || 0,
        amplitude: item.f7 || 0, turnover: item.f8 || 0, volumeRatio: item.f10 || 0,
        pe: item.f9 || 0, amount: item.f6 || 0, circCap: item.f21 || 0,
        high: item.f15 || 0, low: item.f16 || 0, industry: item.f100 || '',
      }
    }
    return stocks
  } catch(e) { return {} }
}

async function fetchKlineForBacktest(code, count) {
  var market = code.startsWith('6') ? '1' : '0'
  var url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + market + '.' + code + '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&lmt=' + count
  try {
    var text = await request(url, { timeout: CONFIG.requestTimeout, headers: { 'User-Agent': 'Mozilla/5.0' } })
    var data = JSON.parse(text)
    if (!data.data || !data.data.klines) return null
    return data.data.klines.map(function(k) {
      var p = k.split(',')
      return { date: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4], volume: +p[5], amount: +p[6] }
    })
  } catch(e) { return null }
}

module.exports = { CONFIG, request, sleep, getTradeDays, fetchDayStocks, fetchKlineForBacktest }
