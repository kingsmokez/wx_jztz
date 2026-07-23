/**
 * HTTP工具 - 腾讯/东财行情数据获取
 * V6: 简洁可靠版 - 单实例5000+股票数据获取 + RSI/布林带/均线计算
 */
var http = require("http")
var https = require("https")
var Iconv = null
try { Iconv = require("iconv-lite") } catch(e) { console.warn("iconv-lite not available") }


function request(url, options) {
  if (!options) options = {}
  return new Promise(function(resolve, reject) {
    var timeout = options.timeout || 5000
    var protocol = url.startsWith("https") ? https : http
    var bufs = []
    var timer = setTimeout(function() { req.destroy(); reject(new Error("timeout")) }, timeout)
    var req = protocol.get(url, { headers: options.headers || {} }, function(res) {
      res.on("data", function(chunk) { bufs.push(Buffer.from(chunk)) })
      res.on("end", function() {
        clearTimeout(timer)
        try {
          var buf = Buffer.concat(bufs)
          var encoding = options.encoding || "utf8"
          var text = Iconv ? Iconv.decode(buf, encoding) : buf.toString(encoding)
          resolve(text)
        } catch(e) { try { resolve(buf.toString("utf8")) } catch(e2) { resolve("") } }
      })
    })
    req.on("error", function(err) { clearTimeout(timer); reject(err) })
    req.on("timeout", function() { req.destroy(); clearTimeout(timer); reject(new Error("timeout")) })
  })
}

// ===== 腾讯行情单批获取（gtimg.cn, 每批最多80只）=====
async function fetchTencentQuotes(codes) {
  var results = {}
  if (!codes || codes.length === 0) return results
  try {
    var txCodes = []
    for (var ci = 0; ci < codes.length; ci++) {
      txCodes.push((codes[ci].startsWith("6") || codes[ci].startsWith("9") ? "sh" : "sz") + codes[ci])
    }
    var text = await request("https://qt.gtimg.cn/q=" + txCodes.join(","), {
      timeout: 5000,
      encoding: "gbk",
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://gu.qq.com/" }
    })
    var lines = text.split(";").filter(function(l) { return l.trim() })
    for (var li = 0; li < lines.length; li++) {
      var match = lines[li].match(/v_(\w+)="(.+)"/)
      if (!match) continue
      var parts = match[2].split("~")
      if (parts.length < 50) continue
      var code = parts[2]
      var price = parseFloat(parts[3]) || 0
      if (price <= 0) continue
      results[code] = {
        code: code, name: (parts[1] || "").trim(), price: price,
        prevClose: parseFloat(parts[4]) || 0, open: parseFloat(parts[5]) || 0,
        volume: parseFloat(parts[6]) || 0, changePct: parseFloat(parts[32]) || 0,
        high: parseFloat(parts[33]) || 0, low: parseFloat(parts[34]) || 0,
        amount: (parseFloat(parts[37]) || 0) * 10000,
        turnover: parseFloat(parts[38]) || 0, pe: parseFloat(parts[39]) || 0,
        marketCap: parseFloat(parts[44]) || 0, pb: parseFloat(parts[46]) || 0,
        volumeRatio: parseFloat(parts[49]) || 0,
        roe: parseFloat(parts[65]) || 0, eps: parseFloat(parts[52]) || 0,
        grossMargin: parseFloat(parts[66]) || 0,
        debtRatio: parseFloat(parts[67]) || 0,
        circCap: parseFloat(parts[44]) || 0
      }
    }
  } catch(e) { console.warn("腾讯行情失败:", e.message) }
  return results
}

// ===== 腾讯行情并发批量获取 =====
async function fetchTencentQuotesConcurrent(allCodes, concurrency) {
  if (!concurrency) concurrency = 10
  var results = {}
  var batchSize = 80
  var batches = []
  for (var i = 0; i < allCodes.length; i += batchSize) {
    batches.push(allCodes.slice(i, i + batchSize))
  }
  console.log("腾讯行情: " + batches.length + "批, 并发" + concurrency)
  for (var g = 0; g < batches.length; g += concurrency) {
    var promises = []
    for (var b = g; b < Math.min(g + concurrency, batches.length); b++) {
      promises.push(fetchTencentQuotes(batches[b]))
    }
    var groupResults = await Promise.all(promises)
    for (var ri = 0; ri < groupResults.length; ri++) {
      for (var k in groupResults[ri]) results[k] = groupResults[ri][k]
    }
  }
  return results
}

// ===== 东财涨幅榜（快速）=====
async function fetchEMRank(page, pageSize) {
  if (!pageSize) pageSize = 1200
  try {
    var url = "https://push2.eastmoney.com/api/qt/clist/get?pn=" + page +
      "&pz=" + pageSize + "&po=1&np=1&fltt=2&invt=2&fid=f3" +
      "&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23" +
      "&fields=f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f14,f15,f16,f17,f18,f20,f21,f23"
    var text = await request(url, {
      timeout: 6000,
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://quote.eastmoney.com/" }
    })
    var data = JSON.parse(text)
    if (!data.data || !data.data.diff) return []
    return data.data.diff.map(function(s) {
      return {
        code: String(s.f12 || ""), name: String(s.f14 || ""),
        price: s.f2 || 0, changePct: s.f3 || 0,
        turnover: s.f8 || 0, pe: s.f9 || 0,
        pb: s.f23 || 0, amount: (s.f6 || 0) / 10000,
        volumeRatio: s.f10 || 0, marketCap: s.f20 || 0,
        high: s.f15 || 0, low: s.f16 || 0, open: s.f17 || 0, roe: 0
      }
    }).filter(function(s) { return s.code && s.price > 0 })
  } catch(e) { return [] }
}

// ===== 东财全市场行情 =====
async function fetchEMAllStocks() {
  var allStocks = {}
  for (var p = 1; p <= 6; p++) {
    try {
      var batch = await fetchEMRank(p, 900)
      for (var i = 0; i < batch.length; i++) {
        var s = batch[i]
        if (!allStocks[s.code]) allStocks[s.code] = s
      }
    } catch(e) {}
  }
  return allStocks
}

// ===== RSI / 技术指标 =====
function calcRSI(closes, period) {
  if (!period) period = 14
  if (!closes || closes.length < period + 1) return 50
  var gains = [], losses = []
  for (var i = 1; i < closes.length; i++) {
    var diff = closes[i] - closes[i - 1]
    gains.push(diff > 0 ? diff : 0)
    losses.push(diff < 0 ? -diff : 0)
  }
  var avgGain = gains.slice(-period).reduce(function(a, b) { return a + b }, 0) / period
  var avgLoss = losses.slice(-period).reduce(function(a, b) { return a + b }, 0) / period
  if (avgLoss === 0) return 100
  return Math.round(100 - 100 / (1 + avgGain / avgLoss))
}

function calcEMA(closes, period) {
  if (!closes || closes.length < period) return null
  var k = 2 / (period + 1)
  var ema = closes.slice(0, period).reduce(function(a, b) { return a + b }, 0) / period
  for (var i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k)
  return ema
}

function calcMA(closes, period) {
  if (!closes || closes.length < period) return null
  return closes.slice(-period).reduce(function(a, b) { return a + b }, 0) / period
}

function calcBollPosition(closes, period) {
  if (!period) period = 20
  if (!closes || closes.length < period) return 0.5
  var slice = closes.slice(-period)
  var ma = slice.reduce(function(a, b) { return a + b }, 0) / period
  var variance = 0
  for (var i = 0; i < slice.length; i++) variance += (slice[i] - ma) * (slice[i] - ma)
  variance /= period
  var std = Math.sqrt(variance)
  if (std === 0) return 0.5
  var price = closes[closes.length - 1]
  return Math.max(0, Math.min(1, Math.round(((price - (ma - 2 * std)) / (4 * std)) * 100) / 100))
}

// ===== K线获取（RSI计算用）=====
async function fetchKlineForRSI(code) {
  var prefix = code.startsWith("6") || code.startsWith("9") ? "sh" : "sz"
  try {
    var text = await request("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=" +
      prefix + code + ",day,,,60,qfq", {
      timeout: 3000,
      encoding: "gbk",
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://gu.qq.com/" }
    })
    var data = JSON.parse(text)
    var stockData = data.data && data.data[prefix + code]
    if (!stockData) return null
    var klines = stockData.qfqday || stockData.day || []
    return klines.map(function(k) {
      return {
        date: k[0], open: parseFloat(k[1]), close: parseFloat(k[2]),
        high: parseFloat(k[3]), low: parseFloat(k[4]), volume: parseFloat(k[5]) || 0
      }
    })
  } catch(e) { return null }
}

// ===== 批量RSI计算 =====
async function batchCalcRSI(codes, concurrency) {
  if (!concurrency) concurrency = 15
  var techMap = {}
  for (var g = 0; g < codes.length; g += concurrency) {
    var group = codes.slice(g, g + concurrency)
    var promises = group.map(function(code) {
      return fetchKlineForRSI(code).then(function(klines) {
        if (!klines || klines.length < 15) return
        var closes = klines.map(function(k) { return k.close })
        var rsi = calcRSI(closes, 14)
        var ma5 = calcMA(closes, 5); var ma10 = calcMA(closes, 10); var ma20 = calcMA(closes, 20)
        var maSignal = "neutral"
        if (ma5 && ma10 && ma20 && ma5 > ma10 && ma10 > ma20) maSignal = "bull"
        else if (ma5 && ma10 && ma20 && ma5 < ma10 && ma10 < ma20) maSignal = "bear"
        var ema12 = calcEMA(closes, 12); var ema26 = calcEMA(closes, 26)
        var goldenCross = false
        if (ema12 && ema26 && ema12 > ema26) goldenCross = true
        var bollPosition = calcBollPosition(closes, 20)
        var momentum5d = 0
        if (closes.length >= 6) momentum5d = Math.round((closes[closes.length-1] - closes[closes.length-6]) / closes[closes.length-6] * 10000) / 100
        techMap[code] = { rsi: rsi, maSignal: maSignal, goldenCross: goldenCross, bollPosition: bollPosition, momentum5d: momentum5d }
      }).catch(function() {})
    })
    await Promise.all(promises)
  }
  return techMap
}

// ===== 腾讯财务数据（从行情API中已含ROE/毛利率/负债率）=====
async function fetchTencentFinancial(codes) {
  // 腾讯 gtimg API 已包含 roe/毛利率/负债率，这里做一次补充获取
  return await fetchTencentQuotes(codes)
}

// ===== 行业识别 =====
function guessIndustry(name, code) {
  if (!name) return ""
  var n = name
  var pairs = [
    ["半导体", "半导体"], ["芯片", "芯片"], ["医药", "医药"], ["医疗", "医疗"],
    ["电池", "电池"], ["光伏", "光伏"], ["锂电", "锂电池"], ["新能源", "新能源"],
    ["软件", "软件"], ["科技", "信息技术"], ["通信", "通信"],
    ["电子", "电子"], ["汽车", "汽车"], ["机械", "机械"],
    ["电气", "电气设备"], ["化工", "化工"], ["有色", "有色金属"],
    ["钢铁", "钢铁"], ["建材", "建材"], ["煤炭", "煤炭"],
    ["银行", "银行"], ["保险", "保险"], ["证券", "证券"], ["地产", "房地产"],
    ["食品", "食品"], ["饮料", "饮料"], ["酒", "白酒"], ["家电", "家电"],
    ["传媒", "传媒"], ["旅游", "旅游"], ["电力", "电力"],
    ["军工", "军工"], ["航天", "航空航天"],
    ["环保", "环保"], ["纺织", "纺织"], ["游戏", "游戏"],
    ["互联网", "互联网"], ["传媒", "文化传媒"]
  ]
  for (var i = 0; i < pairs.length; i++) {
    if (n.indexOf(pairs[i][0]) >= 0) return pairs[i][1]
  }
  return "综合"
}

module.exports = {
  request: request,
  fetchTencentQuotes: fetchTencentQuotes,
  fetchTencentQuotesConcurrent: fetchTencentQuotesConcurrent,
  fetchEMRank: fetchEMRank,
  fetchEMAllStocks: fetchEMAllStocks,
  fetchKlineForRSI: fetchKlineForRSI,
  fetchTencentFinancial: fetchTencentFinancial,
  batchCalcRSI: batchCalcRSI,
  calcRSI: calcRSI,
  calcEMA: calcEMA,
  calcMA: calcMA,
  calcBollPosition: calcBollPosition,
  guessIndustry: guessIndustry
}
