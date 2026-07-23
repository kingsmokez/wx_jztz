/**
 * HTTP工具 - 东财datacenter全市场行情 + 腾讯K线
 * V7: 东财全市场5000+股票快速获取 + GBK解码修复
 */
var http = require("http")
var https = require("https")
var Iconv = null
try { Iconv = require("iconv-lite") } catch(e) {}

function request(url, options) {
  if (!options) options = {}
  return new Promise(function(resolve, reject) {
    var timeout = options.timeout || 8000
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
        } catch(e) { resolve(buf.toString("utf8")) }
      })
    })
    req.on("error", function(err) { clearTimeout(timer); reject(err) })
  })
}

// ===== 东财全市场行情（datacenter，每页1000只，6页覆盖全市场）=====
async function fetchEMAllStocks(progressCallback) {
  var allStocks = {}
  var totalPages = 6
  for (var p = 1; p <= totalPages; p++) {
    try {
      var url = "https://push2.eastmoney.com/api/qt/clist/get" +
        "?pn=" + p + "&pz=1000&po=1&np=1&fltt=2&invt=2&fid=f3" +
        "&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23" +
        "&fields=f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23,f24,f25,f62"
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
        allStocks[code] = {
          code: code,
          name: String(s.f14 || ""),
          price: parseFloat(s.f2) || 0,
          changePct: parseFloat(s.f3) || 0,
          changeAmt: parseFloat(s.f4) || 0,
          volume: parseFloat(s.f5) || 0,
          amount: parseFloat(s.f6) || 0,
          amplitude: parseFloat(s.f7) || 0,
          turnover: parseFloat(s.f8) || 0,
          pe: parseFloat(s.f9) || 0,
          volumeRatio: parseFloat(s.f10) || 0,
          market: String(s.f13 || "0"),
          high: parseFloat(s.f15) || 0,
          low: parseFloat(s.f16) || 0,
          open: parseFloat(s.f17) || 0,
          prevClose: parseFloat(s.f18) || 0,
          totalCap: parseFloat(s.f20) || 0,
          circCap: parseFloat(s.f21) || 0,
          pb: parseFloat(s.f23) || 0,
        }
      }
      if (progressCallback) progressCallback(p, totalPages, Object.keys(allStocks).length)
    } catch(e) { console.warn("东财第" + p + "页失败:", e.message) }
  }
  return allStocks
}

// ===== 东财涨幅榜（快速获取Top N）=====
async function fetchEMRank(page, pageSize) {
  if (!pageSize) pageSize = 200
  try {
    var url = "https://push2.eastmoney.com/api/qt/clist/get" +
      "?pn=" + page + "&pz=" + pageSize + "&po=1&np=1&fltt=2&invt=2&fid=f3" +
      "&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23" +
      "&fields=f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23"
    var text = await request(url, {
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://quote.eastmoney.com/" }
    })
    var data = JSON.parse(text)
    if (!data || !data.data || !data.data.diff) return []
    return data.data.diff.map(function(s) {
      return {
        code: String(s.f12 || ""), name: String(s.f14 || ""),
        price: parseFloat(s.f2) || 0, changePct: parseFloat(s.f3) || 0,
        changeAmt: parseFloat(s.f4) || 0, volume: parseFloat(s.f5) || 0,
        amount: parseFloat(s.f6) || 0, amplitude: parseFloat(s.f7) || 0,
        turnover: parseFloat(s.f8) || 0, pe: parseFloat(s.f9) || 0,
        volumeRatio: parseFloat(s.f10) || 0, market: String(s.f13 || "0"),
        high: parseFloat(s.f15) || 0, low: parseFloat(s.f16) || 0,
        open: parseFloat(s.f17) || 0, prevClose: parseFloat(s.f18) || 0,
        totalCap: parseFloat(s.f20) || 0, circCap: parseFloat(s.f21) || 0,
        pb: parseFloat(s.f23) || 0,
      }
    })
  } catch(e) { return [] }
}

// ===== 批量获取腾讯K线数据（用于RSI/MA/布林带计算）=====
async function fetchKlinesConcurrent(codes, concurrency) {
  if (!concurrency) concurrency = 20
  var results = {}
  for (var g = 0; g < codes.length; g += concurrency) {
    var group = codes.slice(g, g + concurrency)
    var promises = group.map(function(code) {
      return _fetchOneKline(code).then(function(klines) {
        if (klines && klines.length >= 14) results[code] = klines
      }).catch(function() {})
    })
    await Promise.all(promises)
  }
  return results
}

async function _fetchOneKline(code) {
  var prefix = code.startsWith("6") || code.startsWith("9") ? "sh" : "sz"
  try {
    var text = await request(
      "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=" + prefix + code + ",day,,,60,qfq",
      { timeout: 4000, headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://gu.qq.com/" } }
    )
    var data = JSON.parse(text)
    var stockData = data.data && data.data[prefix + code]
    if (!stockData) return null
    var klines = stockData.qfqday || stockData.day || []
    return klines.map(function(k) {
      return { date: k[0], open: parseFloat(k[1]), close: parseFloat(k[2]), high: parseFloat(k[3]), low: parseFloat(k[4]), volume: parseFloat(k[5]) || 0 }
    })
  } catch(e) { return null }
}

// ===== 技术指标计算 =====
function calcRSI(closes, period) {
  if (!period) period = 14
  if (!closes || closes.length <= period) return 50
  var gains = 0, losses = 0
  for (var i = closes.length - period; i < closes.length; i++) {
    var diff = closes[i] - closes[i - 1]
    if (diff >= 0) gains += diff; else losses -= diff
  }
  var avgGain = gains / period, avgLoss = losses / period
  if (avgLoss === 0) return 100
  var rs = avgGain / avgLoss
  return Math.round(100 - 100 / (1 + rs))
}

function calcMA(closes, period) {
  if (!closes || closes.length < period) return null
  return Math.round(closes.slice(-period).reduce(function(a, b) { return a + b }, 0) / period * 100) / 100
}

function calcEMA(closes, period) {
  if (!closes || closes.length < period) return null
  var k = 2 / (period + 1)
  var ema = closes.slice(0, period).reduce(function(a, b) { return a + b }, 0) / period
  for (var i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k)
  return Math.round(ema * 100) / 100
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
  return Math.round(Math.max(0, Math.min(1, (closes[closes.length - 1] - (ma - 2 * std)) / (4 * std))) * 100) / 100
}

function calcTechFromKlines(klines) {
  if (!klines || klines.length < 15) return null
  var closes = klines.map(function(k) { return k.close })
  var rsi = calcRSI(closes, 14)
  var ma5 = calcMA(closes, 5), ma10 = calcMA(closes, 10), ma20 = calcMA(closes, 20)
  var maSignal = "neutral"
  if (ma5 && ma10 && ma20) {
    if (ma5 > ma10 && ma10 > ma20) maSignal = "bull"
    else if (ma5 < ma10 && ma10 < ma20) maSignal = "bear"
  }
  var ema12 = calcEMA(closes, 12), ema26 = calcEMA(closes, 26)
  var goldenCross = ema12 && ema26 && ema12 > ema26
  var bollPosition = calcBollPosition(closes, 20)
  var momentum5d = 0
  if (closes.length >= 6) momentum5d = Math.round((closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6] * 10000) / 100
  var macd = ema12 && ema26 ? Math.round((ema12 - ema26) * 1000) / 1000 : 0
  return { rsi: rsi, maSignal: maSignal, goldenCross: goldenCross, bollPosition: bollPosition, momentum5d: momentum5d, macd: macd, ma5: ma5, ma10: ma10, ma20: ma20 }
}

// ===== 腾讯批量行情（补充PE/PB/量比/市值等）=====
async function fetchTencentBatch(codes, batchSize) {
  if (!batchSize) batchSize = 80
  var results = {}
  for (var i = 0; i < codes.length; i += batchSize) {
    var batch = codes.slice(i, i + batchSize)
    var txCodes = batch.map(function(c) { return (c.startsWith("6") || c.startsWith("9") ? "sh" : "sz") + c })
    try {
      var text = await request("https://qt.gtimg.cn/q=" + txCodes.join(","), {
        timeout: 6000,
        encoding: "gbk",
        headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://gu.qq.com/" }
      })
      var lines = text.split(";")
      for (var li = 0; li < lines.length; li++) {
        var match = lines[li].match(/v_(\w+)="(.+)"/)
        if (!match) continue
        var parts = match[2].split("~")
        if (parts.length < 50) continue
        var code = parts[2]
        results[code] = {
          pe: parseFloat(parts[39]) || 0,
          pb: parseFloat(parts[46]) || 0,
          marketCap: parseFloat(parts[44]) || 0,
          circCap: parseFloat(parts[44]) || 0,
          turnover: parseFloat(parts[38]) || 0,
          volumeRatio: parseFloat(parts[49]) || 0,
          roe: parseFloat(parts[65]) || 0,
          grossMargin: parseFloat(parts[66]) || 0,
          debtRatio: parseFloat(parts[67]) || 0,
          eps: parseFloat(parts[52]) || 0,
        }
      }
    } catch(e) { console.warn("腾讯第" + (i / batchSize + 1) + "批失败:", e.message) }
  }
  return results
}

// ===== 东财板块分类（datacenter）=====
async function fetchSectorMap() {
  // 从东财获取每只股票的行业分类
  return {}
}

// ===== 行业推断（基于股票名称）=====
function guessIndustry(name, code) {
  if (!name) return "综合"
  var n = name
  var pairs = [
    ["半导体", "半导体"], ["芯片", "芯片"], ["集成", "集成电路"],
    ["医药", "医药"], ["医疗", "医疗"], ["生物", "生物医药"],
    ["电池", "电池"], ["光伏", "光伏"], ["锂", "锂电池"],
    ["新能源", "新能源"], ["风电", "风电"],
    ["软件", "软件"], ["数据", "大数据"], ["智能", "人工智能"],
    ["通信", "通信"], ["5G", "5G"], ["光模块", "光通信"],
    ["电子", "电子"], ["电路", "电子"],
    ["汽车", "汽车"], ["零部", "汽配"],
    ["机械", "机械"], ["设备", "机械设备"],
    ["电气", "电气设备"],
    ["化工", "化工"], ["材料", "新材料"],
    ["有色", "有色金属"], ["稀土", "稀土"],
    ["钢铁", "钢铁"], ["建材", "建材"],
    ["煤炭", "煤炭"], ["石油", "石油"],
    ["银行", "银行"], ["保险", "保险"], ["证券", "证券"],
    ["地产", "房地产"],
    ["食品", "食品"], ["饮料", "饮料"], ["酒", "白酒"],
    ["家电", "家电"],
    ["传媒", "传媒"], ["影视", "影视"], ["游戏", "游戏"],
    ["旅游", "旅游"], ["酒店", "酒店餐饮"],
    ["电力", "电力"], ["电网", "电力"],
    ["军工", "军工"], ["航天", "航空航天"], ["船舶", "军工"],
    ["环保", "环保"], ["水务", "公用事业"],
    ["纺织", "纺织服装"],
    ["互联网", "互联网"], ["电商", "电子商务"],
    ["算力", "算力"], ["存储", "存储芯片"],
    ["机器人", "机器人"], ["无人机", "无人机"],
    ["低空", "低空经济"],
    ["中药", "中药"], ["化学制药", "化学制药"],
    ["物流", "物流"], ["快递", "物流"],
    ["教育", "教育"],
    ["养殖", "养殖"], ["种业", "农业"],
    ["建材", "建材"], ["家装", "家居"],
  ]
  for (var i = 0; i < pairs.length; i++) {
    if (n.indexOf(pairs[i][0]) >= 0) return pairs[i][1]
  }
  // 代码判断
  if (code) {
    if (code.startsWith("600") || code.startsWith("601") || code.startsWith("603") || code.startsWith("605")) return "沪市主板"
    if (code.startsWith("000") || code.startsWith("001") || code.startsWith("002") || code.startsWith("003")) return "深市主板"
    if (code.startsWith("300") || code.startsWith("301")) return "创业板"
    if (code.startsWith("688")) return "科创板"
  }
  return "综合"
}

module.exports = {
  request: request,
  fetchEMAllStocks: fetchEMAllStocks,
  fetchEMRank: fetchEMRank,
  fetchKlinesConcurrent: fetchKlinesConcurrent,
  fetchTencentBatch: fetchTencentBatch,
  fetchSectorMap: fetchSectorMap,
  calcRSI: calcRSI,
  calcMA: calcMA,
  calcEMA: calcEMA,
  calcBollPosition: calcBollPosition,
  calcTechFromKlines: calcTechFromKlines,
  guessIndustry: guessIndustry,
}
