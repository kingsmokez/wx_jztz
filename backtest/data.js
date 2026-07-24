/**
 * 数据获取模块 - 从东财API获取历史数据用于回测
 */
var http = require("http")
var https = require("https")
var fs = require("fs")
var path = require("path")
var { CONFIG, request } = require("./config")

var cacheDir = CONFIG.cacheDir
if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })

// ===== 获取交易日历 =====
async function fetchTradeCalendar(startDate, endDate) {
  var cacheFile = path.join(cacheDir, "calendar.json")
  if (fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, "utf8"))
  }
  var url = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
    + "?secid=1.000300&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
    + "&klt=101&fqt=1&beg=" + startDate.replace(/-/g, "") + "&end=" + endDate.replace(/-/g, "")
  try {
    var text = await request(url, { timeout: 15000 })
    var data = JSON.parse(text)
    if (!data || !data.data || !data.data.klines) return []
    var dates = data.data.klines.map(function(line) { return line.split(",")[0] })
    fs.writeFileSync(cacheFile, JSON.stringify(dates), "utf8")
    return dates
  } catch(e) {
    console.error("获取交易日历失败:", e.message)
    return []
  }
}

// ===== 获取某日涨幅榜Top300 =====
async function fetchDayRank(dateStr) {
  var cacheFile = path.join(cacheDir, "rank_" + dateStr + ".json")
  if (fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, "utf8"))
  }
  var allStocks = []
  for (var p = 1; p <= 3; p++) {
    try {
      var url = "https://push2.eastmoney.com/api/qt/clist/get"
        + "?pn=" + p + "&pz=200&po=1&np=1&fltt=2&invt=2&fid=f3"
        + "&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23"
        + "&fields=f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23,f100"
      var text = await request(url, {
        timeout: 10000,
        headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://quote.eastmoney.com/" }
      })
      var data = JSON.parse(text)
      if (!data || !data.data || !data.data.diff) continue
      var items = data.data.diff
      for (var i = 0; i < items.length; i++) {
        var s = items[i]
        var code = String(s.f12 || "")
        if (!code || code.length !== 6) continue
        var name = String(s.f14 || "")
        if (name.includes("ST") || name.includes("*") || name.includes("退")) continue
        if (code.startsWith("8") || code.startsWith("4") || code.startsWith("920")) continue
        if (code.startsWith("900") || code.startsWith("200")) continue
        allStocks.push({
          code: code, name: name,
          price: parseFloat(s.f2) || 0,
          changePct: parseFloat(s.f3) || 0,
          amplitude: parseFloat(s.f7) || 0,
          turnover: parseFloat(s.f8) || 0,
          pe: parseFloat(s.f9) || 0,
          volumeRatio: parseFloat(s.f10) || 0,
          high: parseFloat(s.f15) || 0,
          low: parseFloat(s.f16) || 0,
          open: parseFloat(s.f17) || 0,
          prevClose: parseFloat(s.f18) || 0,
          circCap: parseFloat(s.f21) || 0,
          pb: parseFloat(s.f23) || 0,
          amount: parseFloat(s.f6) || 0,
          industry: String(s.f100 || ""),
        })
      }
    } catch(e) { console.warn("涨幅榜第" + p + "页失败:", e.message) }
  }
  fs.writeFileSync(cacheFile, JSON.stringify(allStocks), "utf8")
  return allStocks
}

// ===== 获取K线数据 =====
async function fetchKline(code, startDate, endDate) {
  var cacheFile = path.join(cacheDir, "kline_" + code + ".json")
  if (fs.existsSync(cacheFile)) {
    var cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"))
    if (cached.startDate === startDate && cached.endDate === endDate) return cached.data
  }
  var market = code.startsWith("6") ? "1" : "0"
  var secid = market + "." + code
  var url = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
    + "?secid=" + secid + "&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
    + "&klt=101&fqt=1&beg=" + startDate.replace(/-/g, "") + "&end=" + endDate.replace(/-/g, "")
  try {
    var text = await request(url, { timeout: 8000 })
    var data = JSON.parse(text)
    if (!data || !data.data || !data.data.klines) return []
    var result = data.data.klines.map(function(line) {
      var parts = line.split(",")
      return {
        date: parts[0], open: parseFloat(parts[1]) || 0, close: parseFloat(parts[2]) || 0,
        high: parseFloat(parts[3]) || 0, low: parseFloat(parts[4]) || 0,
        volume: parseFloat(parts[5]) || 0, amount: parseFloat(parts[6]) || 0,
        changePct: parseFloat(parts[8]) || 0,
      }
    })
    fs.writeFileSync(cacheFile, JSON.stringify({ startDate: startDate, endDate: endDate, data: result }), "utf8")
    return result
  } catch(e) { return [] }
}

// ===== 批量获取K线（带并发控制）=====
async function fetchKlinesBatch(codes, startDate, endDate, concurrency) {
  if (!concurrency) concurrency = 5
  var results = {}
  var index = 0
  async function next() {
    while (index < codes.length) {
      var code = codes[index++]
      try {
        var klines = await fetchKline(code, startDate, endDate)
        results[code] = klines
      } catch(e) {}
    }
  }
  var workers = []
  for (var i = 0; i < concurrency; i++) workers.push(next())
  await Promise.all(workers)
  return results
}

module.exports = { fetchTradeCalendar, fetchDayRank, fetchKline, fetchKlinesBatch }
