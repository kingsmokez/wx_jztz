/**
 * 大盘环境云函数 - 双源获取沪深300行情
 * 主源: 新浪行情  备用源: 腾讯行情
 */
const cloud = require("wx-server-sdk")
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const http = require("./http")

function withTimeout(promiseFactory, ms, fallback) {
  if (!fallback) fallback = null
  return new Promise(function(resolve) {
    var done = false
    var timer = setTimeout(function() { if (!done) { done = true; resolve(fallback) } }, ms)
    promiseFactory().then(function(v) {
      if (!done) { done = true; clearTimeout(timer); resolve(v) }
    }).catch(function() {
      if (!done) { done = true; clearTimeout(timer); resolve(fallback) }
    })
  })
}

// 主源: 新浪沪深300
function getSinaHS300() {
  return withTimeout(function() {
    return http.request("https://hq.sinajs.cn/list=sh000300", {
      timeout: 3000,
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.sina.com.cn/" }
    }).then(function(text) {
      var m = text.match(/"([^"]+)"/)
      if (!m) return null
      var ps = m[1].split(",")
      if (ps.length < 5) return null
      var pc = parseFloat(ps[2]) || 0
      var cur = parseFloat(ps[3]) || 0
      if (pc <= 0) return null
      var cp = Math.round((cur - pc) / pc * 10000) / 100
      return { changePct: cp, current: cur, prevClose: pc }
    })
  }, 3000, null)
}

// 备用源: 腾讯沪深300
function getTencentHS300() {
  return withTimeout(function() {
    return http.request("https://qt.gtimg.cn/q=sh000300", {
      timeout: 3000,
      encoding: "gbk",
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://gu.qq.com/" }
    }).then(function(text) {
      var m = text.match(/sh000300="(.+)"/)
      if (!m) return null
      var ps = m[1].split("~")
      if (ps.length < 40) return null
      var cur = parseFloat(ps[3]) || 0
      var pc = parseFloat(ps[4]) || 0
      if (pc <= 0) return null
      var cp = Math.round((cur - pc) / pc * 10000) / 100
      return { changePct: cp, current: cur, prevClose: pc }
    })
  }, 3000, null)
}

// 获取沪深300趋势 (腾讯K线)
function getIndexTrend() {
  return withTimeout(function() {
    return http.request("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sz399300,day,,,30,qfq", {
      timeout: 2000,
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://gu.qq.com/" }
    }).then(function(text) {
      var klineData = JSON.parse(text)
      var stockData = klineData.data && klineData.data.sz399300
      var klines = (stockData && (stockData.qfqday || stockData.day)) || []
      if (klines.length < 20) return "unknown"
      var closes = klines.map(function(k) { return parseFloat(k[2]) }).filter(function(c) { return c > 0 })
      if (closes.length < 20) return "unknown"
      var ma5 = closes.slice(-5).reduce(function(a, b) { return a + b }, 0) / 5
      var ma10 = closes.slice(-10).reduce(function(a, b) { return a + b }, 0) / 10
      var ma20 = closes.slice(-20).reduce(function(a, b) { return a + b }, 0) / 20
      var cur = closes[closes.length - 1]
      if (cur > ma5 && ma5 > ma10 && ma10 > ma20) return "bull"
      if (cur < ma5 && ma5 < ma10 && ma10 < ma20) return "bear"
      return "range"
    })
  }, 2000, "unknown")
}

function getMarketEnv() {
  return Promise.all([
    getSinaHS300(),
    getTencentHS300(),
    getIndexTrend(),
  ]).then(function(results) {
    var sinaData = results[0]
    var tencentData = results[1]
    var trend = results[2]

    // 优先用新浪，失败用腾讯
    var quote = sinaData || tencentData
    if (!quote) {
      return { status: "未知", changePct: 0, trend: trend || "unknown", volatility: "normal", multiplier: 1.0, canPick: true }
    }

    // 状态判断
    var status = "震荡"
    if (quote.changePct > 2) status = "大涨"
    else if (quote.changePct > 0.5) status = "上涨"
    else if (quote.changePct > -0.5) status = "震荡"
    else if (quote.changePct > -2) status = "下跌"
    else status = "大跌"

    // 计算乘数
    var multiplier = 1.0
    if (trend === "bear") multiplier -= 0.4
    else if (trend === "range") multiplier -= 0.15
    if (status === "大跌") multiplier -= 0.3
    else if (status === "下跌") multiplier -= 0.15
    else if (status === "大涨") multiplier += 0.1
    multiplier = Math.max(0.3, Math.min(1.3, multiplier))

    // 多空判断
    var canPick = true
    if (trend === "bear" && (status === "大跌" || status === "下跌")) canPick = false
    if (quote.changePct < -3.0) canPick = false

    return {
      status: status,
      changePct: quote.changePct,
      trend: trend || "unknown",
      volatility: "normal",
      multiplier: Math.round(multiplier * 100) / 100,
      canPick: canPick,
      current: quote.current,
      prevClose: quote.prevClose,
    }
  })
}

exports.main = async function(event, context) {
  var action = event.action
  try {
    switch (action) {
      case "get":
        return { success: true, data: await getMarketEnv() }
      default:
        return { success: false, error: "未知操作" }
    }
  } catch (err) {
    console.error("marketEnv error:", err)
    return { success: false, error: err.message }
  }
}
