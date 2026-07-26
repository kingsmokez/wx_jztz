/**
 * HTTP工具 V8 - 优化版，解决超时问题
 * 核心优化：
 *   1. 不再全量获取6000只股票，改为按需获取Top200-300
 *   2. 新增 fetchEMTopStocks() 替代 fetchEMAllStocks()
 *   3. 新增 fetchEMByField() 按指定字段排序获取
 *   4. GBK解码修复
 *   5. 东财行业分类字段 f100 正确解析
 */
var http = require("http")
var https = require("https")
var Iconv = null
try { Iconv = require("iconv-lite") } catch(e) {}

// ===== GBK解码修复 =====
function decodeName(raw) {
  if (!raw || raw === "") return ""
  var rawStr = String(raw)
  if (/[\u4e00-\u9fff]/.test(rawStr)) return rawStr
  try {
    var buf = Buffer.from(rawStr, "latin1")
    if (Iconv) {
      var decoded = Iconv.decode(buf, "gbk")
      if (/[\u4e00-\u9fff]/.test(decoded)) return decoded
    }
  } catch(e) {}
  return rawStr
}

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

// ===== 解析东财股票数据 =====
function parseEMStock(s) {
  if (!s) return null
  var code = String(s.f12 || "")
  if (!code || code.length !== 6) return null
  return {
    code: code,
    name: decodeName(s.f14),
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
    industry: decodeName(s.f100) || "",
  }
}

// ===== 东财全市场行情（原版6页，保留但标注不推荐）=====
async function fetchEMAllStocks() {
  var allStocks = {}
  for (var p = 1; p <= 6; p++) {
    try {
      var url = "https://push2.eastmoney.com/api/qt/clist/get" +
        "?pn=" + p + "&pz=1000&po=1&np=1&fltt=2&invt=2&fid=f3" +
        "&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23" +
        "&fields=f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23,f100"
      var text = await request(url, {
        timeout: 10000,
        headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://quote.eastmoney.com/" }
      })
      var data = JSON.parse(text)
      if (!data || !data.data || !data.data.diff) continue
      var items = data.data.diff
      for (var i = 0; i < items.length; i++) {
        var stock = parseEMStock(items[i])
        if (stock) allStocks[stock.code] = stock
      }
    } catch(e) { console.warn("东财第" + p + "页失败:", e.message) }
  }
  return allStocks
}

// ===== 东财Top股票（优化版：只获取2页Top300，替代全量6页）=====
async function fetchEMTopStocks(pages, pageSize) {
  if (!pages) pages = 2
  if (!pageSize) pageSize = 200
  var allStocks = {}
  for (var p = 1; p <= pages; p++) {
    try {
      var url = "https://push2.eastmoney.com/api/qt/clist/get" +
        "?pn=" + p + "&pz=" + pageSize + "&po=1&np=1&fltt=2&invt=2&fid=f3" +
        "&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23" +
        "&fields=f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23,f100"
      var text = await request(url, {
        timeout: 8000,
        headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://quote.eastmoney.com/" }
      })
      var data = JSON.parse(text)
      if (!data || !data.data || !data.data.diff) continue
      var items = data.data.diff
      for (var i = 0; i < items.length; i++) {
        var stock = parseEMStock(items[i])
        if (stock) allStocks[stock.code] = stock
      }
    } catch(e) { console.warn("东财涨幅榜第" + p + "页失败:", e.message) }
  }
  return allStocks
}

// ===== 按指定字段排序获取Top股票 =====
// fid: f3=涨幅, f8=换手率, f10=量比, f6=成交额
async function fetchEMByField(fid, topN) {
  if (!topN) topN = 200
  var allStocks = {}
  var pages = Math.ceil(topN / 200)
  for (var p = 1; p <= pages; p++) {
    try {
      var url = "https://push2.eastmoney.com/api/qt/clist/get" +
        "?pn=" + p + "&pz=200&po=1&np=1&fltt=2&invt=2&fid=" + fid +
        "&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23" +
        "&fields=f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23,f100"
      var text = await request(url, {
        timeout: 10000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": "https://quote.eastmoney.com/",
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          "Connection": "keep-alive"
        }
      })
      var data = JSON.parse(text)
      if (!data || !data.data || !data.data.diff) continue
      var items = data.data.diff
      for (var i = 0; i < items.length; i++) {
        var stock = parseEMStock(items[i])
        if (stock) allStocks[stock.code] = stock
      }
    } catch(e) { console.warn("东财排序" + fid + "第" + p + "页失败:", e.message) }
  }
  return allStocks
}

// ===== 东财涨幅榜（兼容旧接口）=====
async function fetchEMRank(page, pageSize) {
  if (!pageSize) pageSize = 200
  try {
    var url = "https://push2.eastmoney.com/api/qt/clist/get" +
      "?pn=" + page + "&pz=" + pageSize + "&po=1&np=1&fltt=2&invt=2&fid=f3" +
      "&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23" +
      "&fields=f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23,f100"
    var text = await request(url, {
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://quote.eastmoney.com/" }
    })
    var data = JSON.parse(text)
    if (!data || !data.data || !data.data.diff) return []
    return data.data.diff.map(function(s) { return parseEMStock(s) }).filter(Boolean)
  } catch(e) { return [] }
}

// ===== K线并发获取（优化版：并发30，单只4秒超时）=====
async function fetchKlinesConcurrent(codes, concurrency) {
  if (!concurrency) concurrency = 30
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
      { timeout: 5000, headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://gu.qq.com/" } }
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

// ===== 腾讯批量行情 =====
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

// ===== 东财财务数据备用（补充ROE/毛利率/负债率）=====
async function fetchFinancialBatch(codes) {
  if (!codes || codes.length === 0) return {}
  var result = {}
  var batchSize = 30
  for (var b = 0; b < codes.length; b += batchSize) {
    var batch = codes.slice(b, b + batchSize)
    try {
      var codeList = batch.map(function(c) { return '"' + c + '"' }).join(',')
      var url = 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_LICO_FN_CPD' +
        '&columns=SECURITY_CODE,NEWEST_ROE,GROSS_PROFIT_RATIO,DEBT_ASSET_RATIO' +
        '&filter=(SECURITY_CODE%20in%20(' + encodeURIComponent(codeList) + '))' +
        '&pageSize=200&source=WEB&client=WEB'
      var text = await request(url, {
        timeout: 5000,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://data.eastmoney.com/' }
      })
      var data = JSON.parse(text)
      if (data.result && data.result.data && data.result.data.length > 0) {
        for (var i = 0; i < data.result.data.length; i++) {
          var item = data.result.data[i]
          var code = String(item.SECURITY_CODE || '')
          if (code) {
            result[code] = {
              roe: parseFloat(item.NEWEST_ROE) || 0,
              grossMargin: parseFloat(item.GROSS_PROFIT_RATIO) || 0,
              debtRatio: parseFloat(item.DEBT_ASSET_RATIO) || 0
            }
          }
        }
      }
    } catch(e) {
      console.warn('[财务备用] 第' + Math.floor(b / batchSize + 1) + '批失败:', e.message)
    }
  }
  console.log('[财务备用] 获取 ' + Object.keys(result).length + '/' + codes.length + ' 只财务数据')
  return result
}

// ===== V31新增: ATR =====
function calcATR(klines, period) {
  if (!klines || klines.length < period + 1) return 0
  var trs = []
  for (var i = klines.length - period; i < klines.length; i++) {
    var k = klines[i], prev = klines[i - 1]
    var tr = Math.max(k.high - k.low, Math.abs(k.high - prev.close), Math.abs(k.low - prev.close))
    trs.push(tr)
  }
  var sum = 0
  for (var i = 0; i < trs.length; i++) sum += trs[i]
  return sum / period
}

// ===== V31新增: ADX (平均趋向指数) =====
function calcADX(klines, period) {
  if (!klines || klines.length < period * 2 + 1) return { adx: 0, plusDI: 0, minusDI: 0 }
  var plusDM = [], minusDM = [], trs = []
  for (var i = 1; i < klines.length; i++) {
    var cur = klines[i], prev = klines[i - 1]
    var upMove = cur.high - prev.high
    var downMove = prev.low - cur.low
    var pdm = (upMove > downMove && upMove > 0) ? upMove : 0
    var mdm = (downMove > upMove && downMove > 0) ? downMove : 0
    var tr = Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close))
    plusDM.push(pdm); minusDM.push(mdm); trs.push(tr)
  }
  var smoothTR = trs.slice(-period).reduce(function(a, b) { return a + b }, 0)
  var smoothPlusDM = plusDM.slice(-period).reduce(function(a, b) { return a + b }, 0)
  var smoothMinusDM = minusDM.slice(-period).reduce(function(a, b) { return a + b }, 0)
  if (smoothTR === 0) return { adx: 0, plusDI: 0, minusDI: 0 }
  var plusDI = (smoothPlusDM / smoothTR) * 100
  var minusDI = (smoothMinusDM / smoothTR) * 100
  var dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI || 1) * 100
  return { adx: dx, plusDI: plusDI, minusDI: minusDI }
}

// ===== V31新增: OBV (能量潮) =====
function calcOBV(klines) {
  if (!klines || klines.length === 0) return { obv: 0, obvSlope5: 0, obvTrend: 0 }
  var obv = 0
  var obvArr = [0]
  for (var i = 1; i < klines.length; i++) {
    if (klines[i].close > klines[i - 1].close) obv += klines[i].volume
    else if (klines[i].close < klines[i - 1].close) obv -= klines[i].volume
    obvArr.push(obv)
  }
  var obvSlope5 = 0
  if (obvArr.length >= 6) {
    var recent5 = obvArr.slice(-5)
    obvSlope5 = (recent5[4] - recent5[0]) / (recent5[0] || 1)
  }
  var obvTrend = 0
  if (obvArr.length >= 21) {
    var recent20 = obvArr.slice(-20)
    var avgFirst5 = (recent20[0] + recent20[1] + recent20[2] + recent20[3] + recent20[4]) / 5
    var avgLast5 = (recent20[15] + recent20[16] + recent20[17] + recent20[18] + recent20[19]) / 5
    obvTrend = avgLast5 > avgFirst5 ? 1 : (avgLast5 < avgFirst5 ? -1 : 0)
  }
  return { obv: obv, obvSlope5: obvSlope5, obvTrend: obvTrend }
}

// ===== V31新增: 均线斜率 =====
function calcMASlope(closes, period) {
  if (!closes || closes.length < period + 2) return 0
  var ma1 = calcMA(closes.slice(0, -1), period)
  var ma2 = calcMA(closes.slice(0, -2), period)
  if (ma2 === 0) return 0
  return (ma1 - ma2) / ma2 * 100
}

// ===== V31新增: 形态识别 =====
function detectCupHandle(klines) {
  if (!klines || klines.length < 25) return 0
  var recent = klines.slice(-25)
  var highs = recent.map(function(k) { return k.high })
  var maxHighIdx = 0
  for (var i = 1; i < highs.length - 3; i++) { if (highs[i] > highs[maxHighIdx]) maxHighIdx = i }
  var maxHigh = highs[maxHighIdx]
  var price = recent[recent.length - 1].close
  if (maxHighIdx < 3 || maxHighIdx > 22) return 0
  var afterHigh = recent.slice(maxHighIdx)
  var minLow = Infinity
  for (var i = 0; i < afterHigh.length; i++) { if (afterHigh[i].low < minLow) minLow = afterHigh[i].low }
  var pullback = (maxHigh - minLow) / maxHigh * 100
  if (pullback < 5 || pullback > 20) return 0
  var pullbackVols = afterHigh.slice(0, -1).map(function(k) { return k.volume })
  var avgPullbackVol = pullbackVols.reduce(function(a, b) { return a + b }, 0) / pullbackVols.length
  var beforeHighVols = recent.slice(0, maxHighIdx).map(function(k) { return k.volume })
  var avgBeforeVol = beforeHighVols.reduce(function(a, b) { return a + b }, 0) / beforeHighVols.length
  if (avgBeforeVol === 0) return 0
  var volRatio = avgPullbackVol / avgBeforeVol
  if (price >= maxHigh * 0.98 && volRatio < 1.0) return 5
  if (price >= maxHigh * 0.98 && volRatio < 1.2) return 3
  return 0
}

function detectBreakout(klines) {
  if (!klines || klines.length < 15) return 0
  var recent = klines.slice(-15)
  var platform = recent.slice(-11, -1)
  var maxHigh = -Infinity, minLow = Infinity
  for (var i = 0; i < platform.length; i++) {
    if (platform[i].high > maxHigh) maxHigh = platform[i].high
    if (platform[i].low < minLow) minLow = platform[i].low
  }
  var platformRange = (maxHigh - minLow) / maxHigh * 100
  if (platformRange > 4) return 0
  var today = recent[recent.length - 1]
  var avgVol = platform.reduce(function(a, b) { return a + b.volume }, 0) / platform.length
  if (avgVol === 0) return 0
  var todayVolRatio = today.volume / avgVol
  if (today.close > maxHigh && todayVolRatio >= 1.5) return 5
  if (today.close > maxHigh * 0.99 && todayVolRatio >= 1.3) return 3
  return 0
}

function detectPullbackRestart(klines) {
  if (!klines || klines.length < 10) return 0
  var recent = klines.slice(-10)
  var surgeIdx = -1
  for (var i = 0; i < recent.length - 3; i++) {
    var chg = (recent[i].close - recent[i].open) / recent[i].open * 100
    if (chg >= 3 && i > 0 && recent[i].volume > recent[i - 1].volume * 1.5) { surgeIdx = i; break }
  }
  if (surgeIdx === -1) return 0
  var pullback = recent.slice(surgeIdx + 1, -1)
  if (pullback.length < 1 || pullback.length > 4) return 0
  var avgPullbackVol = 0
  for (var i = 0; i < pullback.length; i++) avgPullbackVol += pullback[i].volume
  avgPullbackVol = avgPullbackVol / pullback.length
  var surgeVol = recent[surgeIdx].volume
  if (surgeVol === 0) return 0
  if (avgPullbackVol / surgeVol > 0.8) return 0
  var today = recent[recent.length - 1]
  var todayChg = (today.close - today.open) / today.open * 100
  if (todayChg >= 1 && today.volume > avgPullbackVol * 1.3) return 5
  if (todayChg >= 0.5 && today.volume > avgPullbackVol * 1.2) return 3
  return 0
}

function detectConsecutiveUp(klines) {
  if (!klines || klines.length < 6) return 0
  var recent = klines.slice(-5)
  var upCount = 0, totalChg = 0
  var vols = []
  for (var i = 0; i < recent.length; i++) {
    var chg = (recent[i].close - recent[i].open) / recent[i].open * 100
    if (chg > 0) { upCount++; totalChg += chg }
    vols.push(recent[i].volume)
  }
  if (upCount >= 3 && totalChg <= 12) {
    var volIncreasing = vols[vols.length - 1] > vols[0] * 0.9
    if (volIncreasing && upCount >= 4) return 5
    if (volIncreasing) return 3
  }
  return 0
}

function detectBottomReversal(klines) {
  if (!klines || klines.length < 25) return 0
  var recent = klines.slice(-25)
  var today = recent[recent.length - 1]
  var minClose = Infinity, minIdx = 0
  for (var i = 0; i < recent.length - 1; i++) {
    if (recent[i].close < minClose) { minClose = recent[i].close; minIdx = i }
  }
  if (minIdx < recent.length - 20 || minIdx > recent.length - 5) return 0
  var firstClose = recent[0].close
  var dropFrom20 = (firstClose - minClose) / firstClose * 100
  if (dropFrom20 < 8) return 0
  var todayChg = (today.close - today.open) / today.open * 100
  if (todayChg < 3) return 0
  var avgVol = recent.slice(0, -1).reduce(function(a, b) { return a + b.volume }, 0) / (recent.length - 1)
  if (avgVol === 0) return 0
  var volRatio = today.volume / avgVol
  if (volRatio >= 2) return 5
  if (volRatio >= 1.5) return 3
  return 0
}

function detectMASupport(klines) {
  if (!klines || klines.length < 60) return 0
  var closes = klines.map(function(k) { return k.close })
  var ma5 = calcMA(closes, 5), ma10 = calcMA(closes, 10), ma20 = calcMA(closes, 20)
  var price = closes[closes.length - 1]
  if (!(ma5 > ma10 && ma10 > ma20)) return 0
  var ratio = price / ma10
  if (ratio >= 0.97 && ratio <= 1.03) {
    var today = klines[klines.length - 1]
    if (today.close > today.open) return 5
    return 3
  }
  ratio = price / ma20
  if (ratio >= 0.97 && ratio <= 1.03) {
    var today = klines[klines.length - 1]
    if (today.close > today.open) return 3
  }
  return 0
}

function detectPatterns(klines) {
  return {
    cupHandle: detectCupHandle(klines),
    breakout: detectBreakout(klines),
    pullbackRestart: detectPullbackRestart(klines),
    consecutiveUp: detectConsecutiveUp(klines),
    bottomReversal: detectBottomReversal(klines),
    maSupport: detectMASupport(klines),
  }
}

// ===== V31: 量价配合度 (0-100) =====
function calcVolumePriceCoord(klines) {
  if (!klines || klines.length < 10) return { score: 50, trend: "neutral" }
  var recent = klines.slice(-10)
  var upWithVol = 0, upNoVol = 0, downWithVol = 0, downNoVol = 0
  for (var i = 1; i < recent.length; i++) {
    var priceUp = recent[i].close > recent[i - 1].close
    var volUp = recent[i].volume > recent[i - 1].volume
    if (priceUp && volUp) upWithVol++
    else if (priceUp && !volUp) upNoVol++
    else if (!priceUp && volUp) downWithVol++
    else downNoVol++
  }
  var total = recent.length - 1
  var coordRatio = upWithVol / total
  var divergeRatio = upNoVol / total
  var score = 50
  if (coordRatio >= 0.5) score = 80 + (coordRatio - 0.5) * 40
  else if (coordRatio >= 0.3) score = 60 + (coordRatio - 0.3) * 100
  else if (divergeRatio >= 0.5) score = 20
  else score = 40
  var trend = "neutral"
  if (coordRatio >= 0.4) trend = "bullish"
  else if (divergeRatio >= 0.4) trend = "bearish_divergence"
  return { score: Math.min(100, Math.max(0, Math.round(score))), trend: trend, upWithVol: upWithVol, upNoVol: upNoVol }
}

// ===== V31: 趋势加速 =====
function calcTrendAcceleration(closes) {
  if (!closes || closes.length < 20) return { accelerating: false, score: 0, accelRatio: 0 }
  var recentSlope = calcMASlope(closes, 5)
  var prevCloses = closes.slice(0, -3)
  var prevSlope = calcMASlope(prevCloses, 5)
  if (prevSlope === 0 && recentSlope === 0) return { accelerating: false, score: 0, accelRatio: 0 }
  var accelRatio = (recentSlope - prevSlope) / (Math.abs(prevSlope) || 0.001)
  var accelerating = false
  var score = 0
  if (recentSlope > 0 && accelRatio > 0.5) {
    accelerating = true
    if (accelRatio > 2) score = 100
    else if (accelRatio > 1) score = 80
    else score = 60
  } else if (recentSlope > 0 && accelRatio > 0) {
    score = 30
  }
  return { accelerating: accelerating, score: score, accelRatio: accelRatio, recentSlope: recentSlope, prevSlope: prevSlope }
}

// ===== V31: 缩量整理突破 =====
function detectConsolidationBreakout(klines) {
  if (!klines || klines.length < 25) return { detected: false, score: 0 }
  var recent = klines.slice(-25)
  var today = recent[recent.length - 1]
  var todayChg = (today.close - today.open) / today.open * 100
  var bestScore = 0
  for (var start = recent.length - 16; start <= recent.length - 6; start++) {
    if (start < 0) continue
    var range = recent.slice(start, -1)
    if (range.length < 5) continue
    var smallChgCount = 0
    var volDeclining = true
    var rangeHigh = -Infinity, rangeLow = Infinity
    for (var i = 0; i < range.length; i++) {
      var chg = Math.abs((range[i].close - range[i].open) / range[i].open * 100)
      if (chg <= 2.5) smallChgCount++
      rangeHigh = Math.max(rangeHigh, range[i].high)
      rangeLow = Math.min(rangeLow, range[i].low)
      if (i > 0 && range[i].volume > range[i - 1].volume * 1.1) volDeclining = false
    }
    var rangeAmplitude = (rangeHigh - rangeLow) / rangeLow * 100
    if (rangeAmplitude > 15) continue
    if (smallChgCount / range.length < 0.6) continue
    var breakout = today.close > rangeHigh && todayChg >= 1.5
    var avgVol = 0
    for (var i = 0; i < range.length; i++) avgVol += range[i].volume
    avgVol /= range.length
    var volRatio = avgVol > 0 ? today.volume / avgVol : 0
    var score = 0
    if (breakout && volRatio >= 1.5) score = 100
    else if (breakout && volRatio >= 1.2) score = 70
    else if (today.close > rangeHigh * 0.98 && todayChg >= 1 && volRatio >= 1.3) score = 50
    if (volDeclining && score > 0) score = Math.min(100, score + 10)
    if (score > bestScore) bestScore = score
  }
  return { detected: bestScore >= 50, score: bestScore }
}

// ===== V31: K线形态组合 =====
function calcCandlePatterns(klines) {
  if (!klines || klines.length < 5) return { score: 0, patterns: [] }
  var recent = klines.slice(-5)
  var today = recent[recent.length - 1]
  var score = 0
  var detected = []
  var todayBody = Math.abs(today.close - today.open)
  var todayRange = today.high - today.low
  if (today.close > today.open && todayRange > 0 && todayBody / todayRange > 0.7) {
    var avgVol = 0
    for (var i = 0; i < recent.length - 1; i++) avgVol += recent[i].volume
    avgVol /= (recent.length - 1)
    if (avgVol > 0 && today.volume / avgVol >= 1.5) { score += 12; detected.push("big_yang") }
  }
  if (recent.length >= 3) {
    var threeUp = true
    for (var i = recent.length - 3; i < recent.length; i++) {
      if (recent[i].close <= recent[i].open) { threeUp = false; break }
    }
    if (threeUp) { score += 8; detected.push("three_white") }
  }
  var lowerShadow = Math.min(today.open, today.close) - today.low
  if (todayRange > 0 && lowerShadow / todayRange > 0.4) { score += 5; detected.push("long_lower_shadow") }
  if (recent.length >= 2) {
    var gap = today.open - recent[recent.length - 2].close
    if (gap > 0 && today.close > today.open) { score += 6; detected.push("gap_up") }
  }
  return { score: Math.min(30, score), patterns: detected }
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
  for (var i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k)
  }
  return Math.round(ema * 100) / 100
}

function calcBollPosition(price, closes) {
  if (!closes || closes.length < 20 || !price || price <= 0) return 0.5
  var slice = closes.slice(-20)
  var ma = slice.reduce(function(a, b) { return a + b }, 0) / slice.length
  var variance = 0
  for (var i = 0; i < slice.length; i++) variance += (slice[i] - ma) * (slice[i] - ma)
  var std = Math.sqrt(variance / slice.length)
  if (std === 0) return 0.5
  var upper = ma + 2 * std
  var lower = ma - 2 * std
  return Math.round(Math.min(1, Math.max(0, (price - lower) / (upper - lower))) * 100) / 100
}

function calcTechFromKlines(klines) {
  if (!klines || klines.length < 14) return null
  var closes = klines.map(function(k) { return k.close })
  var ma5 = calcMA(closes, 5)
  var ma10 = calcMA(closes, 10)
  var ma20 = calcMA(closes, 20)
  var ma60 = calcMA(closes, Math.min(60, closes.length))
  var price = closes[closes.length - 1]
  var rsi = calcRSI(closes, 14)

  // MACD
  var ema12 = calcEMA(closes, 12)
  var ema26 = calcEMA(closes, 26)
  var dif = ema12 && ema26 ? ema12 - ema26 : 0
  var prevEma12 = calcEMA(closes.slice(0, -1), 12)
  var prevEma26 = calcEMA(closes.slice(0, -1), 26)
  var prevDif = prevEma12 && prevEma26 ? prevEma12 - prevEma26 : 0
  var goldenCross = dif > 0 && prevDif <= 0
  var macdObj = { dif: dif, dea: ema26, macd: 2 * (dif - ema26), golden: goldenCross }

  // MA信号
  var maSignal = "neutral"
  if (ma5 && ma10 && ma20 && ma5 > ma10 && ma10 > ma20) maSignal = "bull"
  else if (ma5 && ma10 && ma20 && ma5 < ma10 && ma10 < ma20) maSignal = "bear"

  // 布林带位置
  var bollPosition = calcBollPosition(price, closes)
  // 布林带宽度(V69: boll_squeeze检测用)
  var bollWidth = 0.1
  if (closes.length >= 20) {
    var bollSlice = closes.slice(-20)
    var bollMa = bollSlice.reduce(function(a, b) { return a + b }, 0) / bollSlice.length
    var bollVar = 0
    for (var bi = 0; bi < bollSlice.length; bi++) bollVar += (bollSlice[bi] - bollMa) * (bollSlice[bi] - bollMa)
    var bollStd = Math.sqrt(bollVar / bollSlice.length)
    if (bollMa > 0) bollWidth = Math.round((2 * bollStd) / bollMa * 10000) / 10000
  }

  // 5日动量
  var momentum5d = 0
  if (closes.length >= 6) momentum5d = (price / closes[closes.length - 6] - 1) * 100

  // V31新增: ADX/OBV/形态/量价配合度/趋势加速/缩量突破/K线形态
  var adxObj = klines.length >= 30 ? calcADX(klines, 14) : { adx: 0, plusDI: 0, minusDI: 0 }
  var obvObj = klines.length >= 21 ? calcOBV(klines) : { obv: 0, obvSlope5: 0, obvTrend: 0 }
  var ma5Slope = calcMASlope(closes, 5)
  var ma10Slope = calcMASlope(closes, 10)
  var patterns = klines.length >= 25 ? detectPatterns(klines) : null
  var vpCoord = klines.length >= 10 ? calcVolumePriceCoord(klines) : { score: 50, trend: "neutral" }
  var trendAccel = closes.length >= 20 ? calcTrendAcceleration(closes) : { accelerating: false, score: 0, accelRatio: 0 }
  var consolidationBreakout = klines.length >= 25 ? detectConsolidationBreakout(klines) : { detected: false, score: 0 }
  var candlePatterns = klines.length >= 5 ? calcCandlePatterns(klines) : { score: 0, patterns: [] }

  // 20日动量
  var momentum20 = closes.length >= 21 ? (price / closes[closes.length - 21] - 1) * 100 : 0

  return {
    rsi: rsi, ma5: ma5, ma10: ma10, ma20: ma20, ma60: ma60,
    dif: Math.round(dif * 100) / 100, goldenCross: goldenCross, macdObj: macdObj,
    maSignal: maSignal, bollPosition: bollPosition, bollWidth: bollWidth, momentum5d: momentum5d, momentum20: momentum20,
    macd: goldenCross ? 1 : (dif < prevDif ? -1 : 0),
    adx: adxObj.adx, plusDI: adxObj.plusDI, minusDI: adxObj.minusDI,
    obvTrend: obvObj.obvTrend, obvSlope5: obvObj.obvSlope5,
    ma5Slope: ma5Slope, ma10Slope: ma10Slope, patterns: patterns,
    vpCoord: vpCoord, trendAccel: trendAccel,
    consolidationBreakout: consolidationBreakout, candlePatterns: candlePatterns,
  }
}

// ===== 东财行业分类 =====
async function fetchSectorMap() { return {} }

// ===== 行业推断（基于股票名称+代码）=====
var INDUSTRY_MAP = [
  // === 申万二级行业精确匹配（API返回的BOARD_NAME）===
  // 农林牧渔
  ["种植业","农林牧渔-种植业"],["渔业","农林牧渔-渔业"],["林业","农林牧渔-林业"],
  ["饲料","农林牧渔-饲料"],["农产品加工","农林牧渔-农产品加工"],["农业综合","农林牧渔-农业综合"],
  ["动物保健","农林牧渔-动物保健"],
  // 基础化工
  ["农化制品","基础化工-农化制品"],["化学制品","基础化工-化学制品"],["化学原料","基础化工-化学原料"],
  ["塑料","基础化工-塑料"],["橡胶","基础化工-橡胶"],["纤维","基础化工-纤维"],
  ["聚氨酯","基础化工-聚氨酯"],["民爆制品","基础化工-民爆制品"],["涂料","基础化工-涂料"],
  ["钛白粉","基础化工-钛白粉"],["氟化工","基础化工-氟化工"],["磷化工","基础化工-磷化工"],
  ["纯碱","基础化工-纯碱"],["氯碱","基础化工-氯碱"],["有机硅","基础化工-有机硅"],
  ["膜材料","基础化工-膜材料"],["碳纤维","基础化工-碳纤维"],["粘胶","基础化工-粘胶"],
  // 钢铁
  ["普钢","钢铁-普钢"],["特钢","钢铁-特钢"],["钢铁","钢铁-钢铁"],
  // 有色金属
  ["工业金属","有色金属-工业金属"],["贵金属","有色金属-贵金属"],
  ["小金属","有色金属-小金属"],["金属新材料","有色金属-金属新材料"],
  ["能源金属","有色金属-能源金属"],["铝","有色金属-铝"],["铜","有色金属-铜"],
  ["黄金","有色金属-黄金"],["锂","有色金属-锂"],["稀土","有色金属-稀土"],
  ["钴","有色金属-钴"],["镍","有色金属-镍"],["锡","有色金属-锡"],
  // 电子
  ["半导体","电子-半导体"],["消费电子","电子-消费电子"],["光学光电子","电子-光学光电子"],
  ["元件","电子-元件"],["电子化学品","电子-电子化学品"],["印制电路板","电子-PCB"],
  ["集成电路","电子-集成电路"],["分立器件","电子-分立器件"],["面板","电子-面板"],
  ["LED","电子-LED"],["被动元件","电子-被动元件"],["连接器","电子-连接器"],
  ["PCB","电子-PCB"],
  // 家用电器
  ["白色家电","家用电器-白电"],["黑色家电","家用电器-黑电"],["小家电","家用电器-小家电"],
  ["厨卫电器","家用电器-厨卫电器"],["家电零部件","家用电器-零部件"],["照明设备","家用电器-照明"],
  ["家电","家用电器-家电"],
  // 食品饮料
  ["白酒","食品饮料-白酒"],["啤酒","食品饮料-啤酒"],["乳品","食品饮料-乳品"],
  ["调味发酵品","食品饮料-调味品"],["零食","食品饮料-零食"],["预加工食品","食品饮料-预制食品"],
  ["软饮料","食品饮料-软饮料"],["保健品","食品饮料-保健品"],["烘焙食品","食品饮料-烘焙"],
  ["肉制品","食品饮料-肉制品"],["其他食品","食品饮料-其他食品"],
  ["食品","食品饮料-食品"],["饮料","食品饮料-饮料"],["调味品","食品饮料-调味品"],
  // 纺织服饰
  ["品牌服饰","纺织服饰-品牌服饰"],["纺织制造","纺织服饰-纺织制造"],
  ["服装","纺织服饰-服装"],["纺织","纺织服饰-纺织"],["鞋帽","纺织服饰-鞋帽"],
  // 轻工制造
  ["家居","轻工制造-家居"],["造纸","轻工制造-造纸"],["包装印刷","轻工制造-包装印刷"],
  ["文娱用品","轻工制造-文娱用品"],["家具","轻工制造-家具"],["包装","轻工制造-包装"],
  // 医药生物
  ["化学制药","医药生物-化学制药"],["中药","医药生物-中药"],["生物制品","医药生物-生物制品"],
  ["医疗器械","医药生物-医疗器械"],["医药商业","医药生物-医药商业"],
  ["医疗服务","医药生物-医疗服务"],["CXO","医药生物-CXO"],["疫苗","医药生物-疫苗"],
  ["血液制品","医药生物-血液制品"],["体外诊断","医药生物-体外诊断"],
  ["医疗耗材","医药生物-医疗耗材"],["制药","医药生物-制药"],["医药","医药生物-医药"],
  // 公用事业
  ["火力发电","公用事业-火电"],["水力发电","公用事业-水电"],["核力发电","公用事业-核电"],
  ["风力发电","公用事业-风电"],["光伏发电","公用事业-光伏发电"],["热力服务","公用事业-热力"],
  ["电能综合服务","公用事业-综合能源"],["燃气","公用事业-燃气"],
  ["电力","公用事业-电力"],["水电","公用事业-水电"],["核电","公用事业-核电"],
  // 交通运输
  ["铁路公路","交通运输-铁路公路"],["物流","交通运输-物流"],["航运","交通运输-航运"],
  ["港口","交通运输-港口"],["航空机场","交通运输-航空机场"],["公交","交通运输-公交"],
  ["快递","交通运输-快递"],["航空","交通运输-航空"],
  // 房地产
  ["房地产开发","房地产-开发"],["房地产服务","房地产-服务"],["物业","房地产-物业"],
  ["地产","房地产-房地产"],
  // 银行
  ["国有大行","银行-国有大行"],["股份行","银行-股份行"],["城商行","银行-城商行"],
  ["农商行","银行-农商行"],["银行","银行-银行"],
  // 非银金融
  ["证券","非银金融-证券"],["保险","非银金融-保险"],["多元金融","非银金融-多元金融"],
  ["券商","非银金融-券商"],["期货","非银金融-期货"],["信托","非银金融-信托"],
  // 商贸零售
  ["一般零售","商贸零售-零售"],["互联网电商","商贸零售-电商"],["专业连锁","商贸零售-连锁"],
  ["贸易","商贸零售-贸易"],["旅游零售","商贸零售-旅游零售"],
  ["电商","商贸零售-电商"],["零售","商贸零售-零售"],["百货","商贸零售-百货"],
  // 社会服务
  ["旅游及景区","社会服务-旅游"],["酒店餐饮","社会服务-酒店餐饮"],
  ["教育","社会服务-教育"],["专业服务","社会服务-专业服务"],
  ["人力资源","社会服务-人力资源"],["旅游","社会服务-旅游"],["酒店","社会服务-酒店"],
  // 通信
  ["通信设备","通信-通信设备"],["通信服务","通信-通信服务"],
  ["电信运营","通信-电信运营"],["通信","通信-通信"],["5G","通信-5G"],
  // 计算机
  ["软件开发","计算机-软件"],["IT服务","计算机-IT服务"],["计算机设备","计算机-设备"],
  ["云服务","计算机-云服务"],["信息安全","计算机-信息安全"],
  ["软件","计算机-软件"],["信息","计算机-信息技术"],["科技","计算机-科技服务"],
  ["AI","计算机-人工智能"],["人工智能","计算机-人工智能"],
  // 传媒
  ["游戏","传媒-游戏"],["影视院线","传媒-影视"],["数字媒体","传媒-数字媒体"],
  ["营销代理","传媒-营销"],["出版","传媒-出版"],["电视广播","传媒-电视广播"],
  ["传媒","传媒-传媒"],["影视","传媒-影视"],
  // 国防军工
  ["航空装备","国防军工-航空装备"],["航天装备","国防军工-航天装备"],
  ["军工电子","国防军工-军工电子"],["地面兵装","国防军工-地面兵装"],
  ["航海装备","国防军工-航海装备"],
  ["军工","国防军工-军工"],["航天","国防军工-航天"],["船舶","国防军工-船舶"],
  // 汽车
  ["乘用车","汽车-乘用车"],["商用车","汽车-商用车"],["汽车零部件","汽车-零部件"],
  ["摩托车","汽车-摩托车"],["汽车服务","汽车-服务"],
  ["汽车","汽车-汽车"],["零部件","汽车-零部件"],["整车","汽车-整车"],
  // 机械设备
  ["通用设备","机械设备-通用设备"],["专用设备","机械设备-专用设备"],
  ["轨交设备","机械设备-轨交设备"],["自动化设备","机械设备-自动化"],
  ["工程机械","机械设备-工程机械"],["仪器仪表","机械设备-仪器仪表"],
  ["机械","机械设备-通用设备"],["设备","机械设备-专用设备"],["仪表","仪器仪表-仪器仪表"],
  // 电力设备
  ["电池","电力设备-电池"],["光伏设备","电力设备-光伏"],["风电设备","电力设备-风电"],
  ["电机","电力设备-电机"],["输变电设备","电力设备-输变电"],
  ["锂电专用设备","电力设备-锂电设备"],
  ["光伏","电力设备-光伏"],["储能","电力设备-储能"],["锂电","电力设备-锂电池"],
  ["充电","电力设备-充电桩"],["风电","电力设备-风电"],["新能源","电力设备-新能源"],
  // 建筑材料
  ["水泥","建筑材料-水泥"],["玻璃","建筑材料-玻璃"],["装修建材","建筑材料-装修建材"],
  ["建材","建筑材料-建材"],
  // 建筑装饰
  ["专业工程","建筑装饰-专业工程"],["房屋建设","建筑装饰-房屋建设"],
  ["装修装饰","建筑装饰-装修装饰"],["建筑","建筑装饰-建筑"],["工程","建筑装饰-工程"],
  // 环保
  ["环境治理","环保-环境治理"],["环保设备","环保-环保设备"],
  ["水务","环保-水务"],["环保","环保-环保"],
  // 石油石化
  ["油服工程","石油石化-油服工程"],["炼化化工","石油石化-炼化化工"],
  ["石油加工","石油石化-石油加工"],["石油贸易","石油石化-石油贸易"],
  ["石油","石油石化-石油"],["石化","石油石化-石化"],["天然气","石油石化-天然气"],
  // 综合
  ["综合","综合-综合"],
  // === 名称关键词模糊匹配（兜底）===
  ["化工","基础化工-化工"],["化肥","基础化工-化肥"],["农药","基础化工-农药"],
  ["有色","有色金属-有色金属"],["养殖","农林牧渔-养殖"],["种业","农林牧渔-种业"],
  ["农业","农林牧渔-农业"],["乳","食品饮料-乳业"],["调味","食品饮料-调味品"],
  ["地产","房地产-房地产"],["核电","公用事业-核电"],["消费电子","电子-消费电子"],
  ["电子","电子-电子元件"],
  // === 名称关键词补充映射（兜底用）===
  ["能源","公用事业-电力"],  ["热电","公用事业-火电"],
  ["水电","公用事业-水电"],
  ["核电","公用事业-核电"],
  ["风电","公用事业-风电"],
  ["光伏","电力设备-光伏"],
  ["燃气","公用事业-燃气"],
  ["煤","煤炭-煤炭"],
  ["钢铁","钢铁-普钢"],
  ["铝","有色金属-铝"],
  ["铜","有色金属-铜"],
  ["锂","有色金属-锂"],
  ["银行","银行-银行"],
  ["证券","非银金融-证券"],
  ["保险","非银金融-保险"],
  ["地产","房地产-开发"],
  ["建设","建筑装饰-专业工程"],
  ["建筑","建筑装饰-专业工程"],
  ["物流","交通运输-物流"],
  ["医药","医药生物-化学制药"],
  ["药","医药生物-化学制药"],
  ["医疗","医药生物-医疗器械"],
  ["食品","食品饮料-食品"],
  ["调味","食品饮料-调味品"],
  ["养殖","农林牧渔-养殖业"],
  ["饲料","农林牧渔-饲料"],
  ["化工","基础化工-化学制品"],
  ["橡胶","基础化工-橡胶"],
  ["纺织","纺织服饰-纺织制造"],
  ["服装","纺织服饰-品牌服饰"],
  ["纸","轻工制造-造纸"],
  ["家居","轻工制造-家居"],
  ["家具","轻工制造-家具"],
  ["包装","轻工制造-包装"],
  ["机械","机械设备-通用设备"],
  ["设备","机械设备-通用设备"],
  ["汽车","汽车-汽车"],
  ["通信","通信-通信设备"],
  ["传媒","传媒-传媒"],
  ["游戏","传媒-游戏"],
  ["教育","社会服务-教育"],
  ["旅游","社会服务-旅游"],
  ["酒店","社会服务-酒店"],
  ["零售","商贸零售-零售"],
  ["贸易","商贸零售-贸易"],
  ["环保","环保-环保"],
  ["水务","环保-水务"],
  ["芯","电子-半导体"],
  ["半导","电子-半导体"],
  ["集成","电子-集成电路"],
  ["软件","计算机-软件开发"],
  ["信息","计算机-IT服务"],
  ["科技","计算机-IT服务"],
  ["数据","计算机-IT服务"],
  ["智能","计算机-IT服务"],
  // === 更多名称关键词补充（解决"综合"行业问题）===
  ["国光","农林牧渔-农化制品"],["热力","公用事业-热力"],["热电","公用事业-火电"],
  ["世茂","公用事业-热力"],["联产","公用事业-火电"],["供热","公用事业-热力"],
  ["农药","农林牧渔-农化制品"],["化肥","基础化工-化肥农药"],["植保","农林牧渔-农化制品"],
  ["植物","农林牧渔-农化制品"],["调节剂","农林牧渔-农化制品"],
  ["煤电","公用事业-火电"],["火电","公用事业-火电"],["发电","公用事业-电力"],
  ["电力","公用事业-电力"],  ["水务","环保-水务"],["环保","环保-环境治理"],
  ["新材料","基础化工-化学制品"],["材料","基础化工-化学制品"],
  ["光电","电子-光学光电子"],  ["通信","通信-通信设备"],["通讯","通信-通信设备"],
  ["互联网","计算机-互联网服务"],["网络","计算机-互联网服务"],
  ["传媒","传媒-传媒"],["影视","传媒-影视"],["广告","传媒-营销传播"],
  ["租赁","非银金融-租赁"],["信托","非银金融-信托"],
  ["期货","非银金融-期货"],["基金","非银银金融-基金"]
]

// ===== 批量获取行业板块（东财datacenter API）=====
async function fetchIndustryBatch(codes) {
  if (!codes || codes.length === 0) return {}
  var result = {}
  var totalStart = Date.now()
  var MAX_INDUSTRY_TIME = 20000

  var batchSize = 50
  for (var b = 0; b < codes.length; b += batchSize) {
    if (Date.now() - totalStart > MAX_INDUSTRY_TIME) {
      console.warn("[行业API] 总超时保护触发，跳过剩余批量查询")
      break
    }
    var batchCodes = codes.slice(b, b + batchSize)
    try {
      var codeList = batchCodes.map(function(c) { return '"' + c + '"' }).join(',')
      var url = "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_LICO_FN_CPD" +
        "&columns=SECURITY_CODE,BOARD_NAME" +
        "&filter=(SECURITY_CODE%20in%20(" + encodeURIComponent(codeList) + "))" +
        "&pageSize=200&source=WEB&client=WEB"
      var text = await request(url, {
        timeout: 8000,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Referer": "https://data.eastmoney.com/", "Accept": "application/json" }
      })
      var data = JSON.parse(text)
      if (data.result && data.result.data && data.result.data.length > 0) {
        var seen = {}
        for (var i = 0; i < data.result.data.length; i++) {
          var item = data.result.data[i]
          var code = String(item.SECURITY_CODE || "")
          var boardName = String(item.BOARD_NAME || "")
          if (code && boardName && !seen[code]) {
            boardName = boardName.replace(/[ⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+$/g, "")
            result[code] = boardName
            seen[code] = true
          }
        }
      }
    } catch(e) {
      console.warn("[行业API-批量] 第" + Math.floor(b / batchSize + 1) + "批失败:", e.message)
    }
  }
  console.log("[行业API-批量] 成功 " + Object.keys(result).length + "/" + codes.length + " 只, 耗时 " + (Date.now() - totalStart) + "ms")

  var failed = codes.filter(function(c) { return !result[c] })
  if (failed.length > 0 && Date.now() - totalStart < MAX_INDUSTRY_TIME) {
    var maxOneByOne = Math.min(failed.length, 20)
    console.log("[行业API-逐个] 尝试 " + maxOneByOne + "/" + failed.length + " 只失败股票")
    var concurrency = 10
    var idx = 0
    async function fetchOne(code) {
      try {
        var url = "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_LICO_FN_CPD" +
          "&columns=SECURITY_CODE,BOARD_NAME&filter=(SECURITY_CODE=%22" + code + "%22)" +
          "&pageSize=1&source=WEB&client=WEB"
        var text = await request(url, {
          timeout: 3000,
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Referer": "https://data.eastmoney.com/" }
        })
        var data = JSON.parse(text)
        if (data.result && data.result.data && data.result.data.length > 0) {
          var boardName = String(data.result.data[0].BOARD_NAME || "")
          if (boardName) {
            boardName = boardName.replace(/[ⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+$/g, "")
            result[code] = boardName
          }
        }
      } catch(e) {}
    }
    while (idx < maxOneByOne && Date.now() - totalStart < MAX_INDUSTRY_TIME) {
      var batch = []
      for (var j = 0; j < concurrency && idx < maxOneByOne; j++) {
        batch.push(fetchOne(failed[idx++]))
      }
      await Promise.all(batch)
    }
    console.log("[行业API-逐个] 补充后共 " + Object.keys(result).length + "/" + codes.length + " 只")
  }

  var stillFailed = codes.filter(function(c) { return !result[c] })
  if (stillFailed.length > 0 && Date.now() - totalStart < MAX_INDUSTRY_TIME) {
    var maxF10 = Math.min(stillFailed.length, 10)
    console.log("[行业API-F10] 尝试 " + maxF10 + "/" + stillFailed.length + " 只仍未获取行业股票")
    var f10Idx = 0
    async function fetchF10One(code) {
      try {
        var prefix = (code.startsWith("6") || code.startsWith("9")) ? "SH" : "SZ"
        var url = "https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax?code=" + prefix + code
        var text = await request(url, {
          timeout: 4000,
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Referer": "https://emweb.securities.eastmoney.com/" }
        })
        var m = text.match(/"EM2016":"([^"]+)"/)
        if (m && m[1]) {
          var em2016 = m[1]
          var parts = em2016.split("-")
          if (parts.length >= 2) {
            result[code] = parts[0] + "-" + parts[1]
          } else {
            result[code] = em2016
          }
        }
      } catch(e) {}
    }
    while (f10Idx < maxF10 && Date.now() - totalStart < MAX_INDUSTRY_TIME) {
      var f10Batch = []
      for (var k = 0; k < 5 && f10Idx < maxF10; k++) {
        f10Batch.push(fetchF10One(stillFailed[f10Idx++]))
      }
      await Promise.all(f10Batch)
    }
    console.log("[行业API-F10] 补充后共 " + Object.keys(result).length + "/" + codes.length + " 只")
  }

  var thirdFailed = codes.filter(function(c) { return !result[c] })
  if (thirdFailed.length > 0 && Date.now() - totalStart < MAX_INDUSTRY_TIME) {
    var maxEM = Math.min(thirdFailed.length, 20)
    console.log("[行业API-行情] 尝试 " + maxEM + "/" + thirdFailed.length + " 只仍未获取行业股票")
    var emIdx = 0
    async function fetchEMIndustry(code) {
      try {
        var secid = code.startsWith("6") ? "1." + code : "0." + code
        var url = "https://push2.eastmoney.com/api/qt/stock/get?secid=" + secid +
          "&fields=f100&ut=fa5fd1943c73938dc84456f6acb3b54"
        var text = await request(url, {
          timeout: 3000,
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Referer": "https://quote.eastmoney.com/" }
        })
        var data = JSON.parse(text)
        if (data.data && data.data.f100) {
          var f100 = String(data.data.f100)
          if (f100 && f100 !== "-" && f100 !== "") {
            result[code] = f100
          }
        }
      } catch(e) {}
    }
    while (emIdx < maxEM && Date.now() - totalStart < MAX_INDUSTRY_TIME) {
      var emBatch = []
      for (var m2 = 0; m2 < 10 && emIdx < maxEM; m2++) {
        emBatch.push(fetchEMIndustry(thirdFailed[emIdx++]))
      }
      await Promise.all(emBatch)
    }
    console.log("[行业API-行情] 补充后共 " + Object.keys(result).length + "/" + codes.length + " 只")
  }

  console.log("[行业API] 最终获取 " + Object.keys(result).length + "/" + codes.length + " 只行业, 总耗时 " + (Date.now() - totalStart) + "ms")
  return result
}

function guessIndustry(name, code, emIndustry, apiIndustry) {
  // === 优先级1：API实时获取的行业（东财datacenter申万行业）===
  if (apiIndustry && apiIndustry !== "" && apiIndustry !== "-") {
    if (apiIndustry === "综合") {
      // "综合"太笼统，先尝试名称关键词匹配获取更精确的行业
      if (name) {
        var n0 = String(name)
        for (var i = 0; i < INDUSTRY_MAP.length; i++) {
          if (n0.indexOf(INDUSTRY_MAP[i][0]) >= 0 && INDUSTRY_MAP[i][1] !== "综合-综合") return INDUSTRY_MAP[i][1]
        }
      }
      // 名称匹配不到，返回"综合-综合"
      return "综合-综合"
    }
    // 先精确匹配apiIndustry本身
    for (var i = 0; i < INDUSTRY_MAP.length; i++) {
      if (INDUSTRY_MAP[i][0] === apiIndustry) return INDUSTRY_MAP[i][1]
    }
    // 再模糊匹配（拼接name增加上下文）
    var n1 = (name || "") + apiIndustry
    for (var i = 0; i < INDUSTRY_MAP.length; i++) {
      if (n1.indexOf(INDUSTRY_MAP[i][0]) >= 0) return INDUSTRY_MAP[i][1]
    }
    // 没匹配到映射，直接返回API行业名
    return apiIndustry
  }

  // === 优先级2：东财行情返回的行业（f100字段）===
  if (emIndustry && emIndustry !== "" && emIndustry !== "-") {
    if (emIndustry === "综合") {
      // "综合"太笼统，先尝试名称关键词匹配
      if (name) {
        var n0b = String(name)
        for (var i = 0; i < INDUSTRY_MAP.length; i++) {
          if (n0b.indexOf(INDUSTRY_MAP[i][0]) >= 0 && INDUSTRY_MAP[i][1] !== "综合-综合") return INDUSTRY_MAP[i][1]
        }
      }
      return "综合-综合"
    }
    // 已经是"大类-小类"格式直接返回
    if (emIndustry.indexOf("-") >= 0) return emIndustry
    // 先精确匹配
    for (var i = 0; i < INDUSTRY_MAP.length; i++) {
      if (INDUSTRY_MAP[i][0] === emIndustry) return INDUSTRY_MAP[i][1]
    }
    // 再模糊匹配
    var n2 = (name || "") + emIndustry
    for (var i = 0; i < INDUSTRY_MAP.length; i++) {
      if (n2.indexOf(INDUSTRY_MAP[i][0]) >= 0) return INDUSTRY_MAP[i][1]
    }
    return emIndustry
  }

  // === 优先级3：根据名称关键词推断 ===
  if (name) {
    var n3 = String(name)
    for (var i = 0; i < INDUSTRY_MAP.length; i++) {
      if (n3.indexOf(INDUSTRY_MAP[i][0]) >= 0) return INDUSTRY_MAP[i][1]
    }
  }

  // === 优先级4：根据代码前缀推断 ===
  if (code) {
    var c = String(code)
    if (c.startsWith("688")) return "电子-半导体"
    if (c.startsWith("300")) return "计算机-科技服务"
    if (c.startsWith("002")) return "基础化工-化学制品"
    if (c.startsWith("000")) return "房地产-开发"
    if (c.startsWith("601")) return "银行-国有大行"
    if (c.startsWith("600")) return "银行-股份行"
  }

  return "其他"
}
// ===== 新浪降级行情 =====
﻿
// ===== 新浪全量股票（降级备用）=====
async function fetchSinaAllStocks() {
  var allStocks = {}
  var errors = 0
  for (var p = 2; p <= 5; p++) {
    try {
      var url = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData" +
        "?page=" + p + "&num=100&sort=changepercent&asc=0&node=hs_a&symbol=&_s_r_a=page"
      var text = await request(url, {
        timeout: 8000,
        headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.sina.com.cn/" }
      })
      if (!text || text === "null" || text === "" || text.indexOf("[") !== 0) break
      var items = JSON.parse(text)
      if (!items || items.length === 0) break
      for (var i = 0; i < items.length; i++) {
        var s = items[i]
        var code = String(s.code || "")
        if (!code || code.length !== 6) continue
        var changePct = parseFloat(s.changepercent) || 0
        var price = parseFloat(String(s.trade).replace(/,/g, "")) || 0
        if (price <= 0) continue
        allStocks[code] = {
          code: code, name: String(s.name || ""),
          price: price, changePct: changePct,
          changeAmt: parseFloat(String(s.pricechange).replace(/,/g, "")) || 0,
          volume: (parseFloat(String(s.volume).replace(/,/g, "")) || 0) / 100,
          amount: parseFloat(String(s.amount).replace(/,/g, "")) || 0,
          amplitude: Math.abs(changePct), turnover: parseFloat(s.turnratio) || 0,
          pe: parseFloat(s.per) || 0, volumeRatio: 0,
          market: String(s.symbol || "").indexOf("sh") === 0 ? "1" : "0",
          high: parseFloat(String(s.high).replace(/,/g, "")) || 0,
          low: parseFloat(String(s.low).replace(/,/g, "")) || 0,
          open: parseFloat(String(s.open).replace(/,/g, "")) || 0,
          prevClose: parseFloat(String(s.settlement).replace(/,/g, "")) || 0,
          totalCap: (parseFloat(String(s.mktcap).replace(/,/g, "")) || 0) / 10000,
          circCap: (parseFloat(String(s.nmc).replace(/,/g, "")) || 0) / 10000,
          pb: parseFloat(s.pb) || 0,
        }
      }
    } catch(e) { errors++; if (errors >= 3) break }
  }
  console.log("新浪降级行情: " + Object.keys(allStocks).length + " 只")
  return allStocks
}
// ===== 沪深300大盘数据（双源）=====
async function fetchHS300() {
  // 源1: 新浪行情
  try {
    var text = await request("https://hq.sinajs.cn/list=sh000300", {
      timeout: 3000,
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.sina.com.cn/" }
    })
    var m = text.match(/"([^"]+)"/)
    if (m) {
      var ps = m[1].split(",")
      if (ps.length >= 5) {
        var pc = parseFloat(ps[2]) || 0
        var cur = parseFloat(ps[3]) || 0
        if (pc > 0 && cur > 0) {
          var cp = Math.round((cur - pc) / pc * 10000) / 100
          var st = cp > 2 ? "大涨" : cp > 0.5 ? "上涨" : cp > -0.5 ? "震荡" : cp > -2 ? "下跌" : "大跌"
          console.log("[沪深300-新浪] " + st + " " + cp + "%")
          return { status: st, changePct: cp, current: cur, prevClose: pc }
        }
      }
    }
  } catch(e) { console.warn("[沪深300-新浪] 失败:", e.message) }

  // 源2: 东财指数行情
  try {
    var text = await request("https://push2.eastmoney.com/api/qt/stock/get?secid=1.000300&fields=f43,f44,f45,f46,f47,f170", {
      timeout: 3000,
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://quote.eastmoney.com/" }
    })
    var data = JSON.parse(text)
    if (data && data.data) {
      var cur = (data.data.f43 || 0) / 100
      var pc = (data.data.f46 || 0) / 100
      var cp = (data.data.f170 || 0) / 100
      if (cur > 0) {
        var st = cp > 2 ? "大涨" : cp > 0.5 ? "上涨" : cp > -0.5 ? "震荡" : cp > -2 ? "下跌" : "大跌"
        console.log("[沪深300-东财] " + st + " " + cp + "%")
        return { status: st, changePct: cp, current: cur, prevClose: pc }
      }
    }
  } catch(e) { console.warn("[沪深300-东财] 失败:", e.message) }

  // 源3: 腾讯行情（最稳定的备用源）
  try {
    var text = await request("https://qt.gtimg.cn/q=sh000300", {
      timeout: 3000,
      encoding: "gbk",
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://gu.qq.com/" }
    })
    var match = text.match(/v_[^=]+="([^"]+)"/)
    if (match) {
      var parts = match[1].split("~")
      if (parts.length >= 33) {
        var cur = parseFloat(parts[3]) || 0
        var prevClose = parseFloat(parts[4]) || 0
        var cp = parseFloat(parts[32]) || 0
        if (cur > 0 && prevClose > 0) {
          var st = cp > 2 ? "大涨" : cp > 0.5 ? "上涨" : cp > -0.5 ? "震荡" : cp > -2 ? "下跌" : "大跌"
          console.log("[沪深300-腾讯] " + st + " " + cp + "%")
          return { status: st, changePct: cp, current: cur, prevClose: prevClose }
        }
      }
    }
  } catch(e) { console.warn("[沪深300-腾讯] 失败:", e.message) }

  console.warn("[沪深300] 所有源失败")
  return null
}

async function fetchStockList(sortField, topN) {
  if (!topN) topN = 200
  console.log("[多源] 开始获取股票列表, sortField=" + sortField + ", topN=" + topN)
  var stocks = {}
  var listStart = Date.now()
  var MAX_LIST_TIME = 20000  // 总超时20秒

  // === 源1: 东财push2 API ===
  try {
    console.log("[源1] 尝试东财push2...")
    var emResult = await fetchEMByField(sortField, topN)
    var emCount = Object.keys(emResult).length
    console.log("[源1] 东财返回: " + emCount + " 只, 耗时 " + (Date.now() - listStart) + "ms")
    if (emCount >= 20) {
      console.log("[源1] 东财数据充足，使用东财")
      return emResult
    }
    if (emCount > 0) stocks = emResult
  } catch(e) { console.warn("[源1] 东财失败:", e.message) }

  // 超时保护
  if (Date.now() - listStart > MAX_LIST_TIME) {
    console.warn("[多源] 源1后已超时，返回已有数据")
    return stocks
  }

  // === 源2: 新浪涨幅榜 + 腾讯详情 ===
  try {
    console.log("[源2] 尝试新浪涨幅榜+腾讯详情...")
    var sinaResult = await fetchSinaRankWithTencent(topN)
    var sinaCount = Object.keys(sinaResult).length
    console.log("[源2] 新浪+腾讯返回: " + sinaCount + " 只, 耗时 " + (Date.now() - listStart) + "ms")
    if (sinaCount >= 20) {
      for (var k in sinaResult) { stocks[k] = sinaResult[k] }
      console.log("[源2] 合并后: " + Object.keys(stocks).length + " 只")
      return stocks
    }
    if (sinaCount > 0) {
      for (var k in sinaResult) { stocks[k] = sinaResult[k] }
    }
  } catch(e) { console.warn("[源2] 新浪+腾讯失败:", e.message) }

  // 超时保护
  if (Date.now() - listStart > MAX_LIST_TIME) {
    console.warn("[多源] 源2后已超时，返回已有数据")
    return stocks
  }

  // === 源3: 腾讯热门股票批量 ===
  try {
    console.log("[源3] 尝试腾讯热门批量...")
    var txResult = await fetchTencentHotStocks(topN)
    var txCount = Object.keys(txResult).length
    console.log("[源3] 腾讯热门返回: " + txCount + " 只")
    for (var k in txResult) { stocks[k] = txResult[k] }
  } catch(e) { console.warn("[源3] 腾讯热门失败:", e.message) }

  console.log("[多源] 最终合并: " + Object.keys(stocks).length + " 只, 总耗时 " + (Date.now() - listStart) + "ms")
  return stocks
}

// ===== 新浪涨幅榜 + 腾讯详情补全 =====
async function fetchSinaRankWithTencent(topN) {
  var allStocks = {}
  var pages = Math.ceil(topN / 80)
  var allCodes = []

  // 第1步：新浪获取涨幅榜代码列表
  for (var p = 1; p <= pages; p++) {
    try {
      var url = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData" +
        "?page=" + p + "&num=80&sort=changepercent&asc=0&node=hs_a&symbol=&_s_r_a=page"
      var text = await request(url, {
        timeout: 8000,
        headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.sina.com.cn/" }
      })
      if (!text || text === "null" || text === "" || text.indexOf("[") !== 0) continue
      var items = JSON.parse(text)
      if (!items || items.length === 0) continue
      for (var i = 0; i < items.length; i++) {
        var s = items[i]
        var code = String(s.code || "")
        if (!code || code.length !== 6) continue
        var price = parseFloat(String(s.trade).replace(/,/g, "")) || 0
        if (price <= 0) continue
        // 过滤北交所
        if (code.startsWith("920") || code.startsWith("8")) continue
        allStocks[code] = {
          code: code, name: String(s.name || ""),
          price: price, changePct: parseFloat(s.changepercent) || 0,
          amount: parseFloat(String(s.amount).replace(/,/g, "")) || 0,
          turnover: parseFloat(s.turnratio) || 0,
          pe: parseFloat(s.per) || 0, volumeRatio: 0,
          circCap: (parseFloat(String(s.nmc).replace(/,/g, "")) || 0) / 10000,
          pb: parseFloat(s.pb) || 0,
        }
        allCodes.push(code)
      }
    } catch(e) { console.warn("新浪第" + p + "页失败:", e.message) }
  }
  console.log("[新浪] 获取 " + allCodes.length + " 只代码")

  // 第2步：腾讯批量补全量比/ROE/毛利率等
  if (allCodes.length > 0) {
    var tencentData = await fetchTencentBatch(allCodes, 80)
    console.log("[腾讯补全] " + Object.keys(tencentData).length + " 只")
    for (var code in allStocks) {
      var td = tencentData[code]
      if (td) {
        if (td.volumeRatio && td.volumeRatio > 0) allStocks[code].volumeRatio = td.volumeRatio
        if (td.roe) allStocks[code].roe = td.roe
        if (td.grossMargin) allStocks[code].grossMargin = td.grossMargin
        if (td.debtRatio) allStocks[code].debtRatio = td.debtRatio
        if (td.pe && td.pe > 0) allStocks[code].pe = td.pe
        if (td.pb && td.pb > 0) allStocks[code].pb = td.pb
        if (td.circCap && td.circCap > 0) allStocks[code].circCap = td.circCap
        if (td.turnover && td.turnover > 0) allStocks[code].turnover = td.turnover
      }
    }
  }
  return allStocks
}

// ===== 腾讯热门股票批量获取 ====
// 使用沪深主要指数成分股+涨幅榜热门
async function fetchTencentHotStocks(topN) {
  var hotCodes = [
    "600519","601318","600036","601398","600809","600900","601012","600276","600309","600585",
    "600887","601166","601888","600048","601669","600031","601225","600346","600438","600570",
    "000858","002594","000333","300750","002475","000001","002714","000568","002352","000725",
    "002049","002415","000651","002230","002241","000002","002142","000063","002371","002607",
    "300059","300015","300124","300014","300033","300024","300027","300017","300003","300009",
    "600000","600009","600010","600011","600015","600016","600018","600019","600023","600025",
    "600028","600029","600030","600032","600035","600037","600038","600039","600040","600046",
    "000100","000402","000423","000425","000501","000503","000504","000505","000506","000507",
    "300001","300002","300004","300005","300006","300007","300008","300010","300011","300012",
    "601688","601857","601988","601989","601998","601939","601398","601288","601328","601390",
    "000001","000002","000063","000066","000069","000100","000157","000333","000338","000338",
    "002001","002007","002008","002024","002027","002032","002044","002049","002050","002056",
    "600009","600016","600019","600025","600028","600029","600030","600031","600036","600048",
    "300014","300015","300024","300033","300059","300122","300124","300136","300142","300146",
    "601012","601088","601111","601138","601166","601225","601229","601236","601238","601288",
    "600519","600521","600523","600525","600526","600527","600528","600529","600530","600531",
    "000538","000539","000540","000541","000543","000544","000545","000546","000547","000548",
    "002128","002129","002130","002131","002132","002133","002134","002135","002136","002137",
    "300201","300207","300212","300214","300223","300226","300229","300232","300234","300238",
    "601318","601328","601336","601348","601360","601369","601375","601377","601380","601388"
  ]
  // 去重
  var uniqueCodes = []
  var seen = {}
  for (var i = 0; i < hotCodes.length; i++) {
    if (!seen[hotCodes[i]] && hotCodes[i].length === 6) {
      seen[hotCodes[i]] = true
      uniqueCodes.push(hotCodes[i])
    }
  }
  // 只取前topN个
  var codes = uniqueCodes.slice(0, Math.min(topN, uniqueCodes.length))
  console.log("[腾讯热门] 请求 " + codes.length + " 只")

  var results = {}
  var batchSize = 80
  for (var b = 0; b < codes.length; b += batchSize) {
    var batch = codes.slice(b, b + batchSize)
    var txCodes = batch.map(function(c) { return (c.startsWith("6") || c.startsWith("9") ? "sh" : "sz") + c })
    try {
      var text = await request("https://qt.gtimg.cn/q=" + txCodes.join(","), {
        timeout: 6000,
        encoding: "gbk",
        headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://gu.qq.com/" }
      })
      var lines = text.split(";")
      for (var li = 0; li < lines.length; li++) {
        var match = lines[li].match(/v_\w+="([^"]+)"/)
        if (!match) continue
        var parts = match[1].split("~")
        if (parts.length < 50) continue
        var code = parts[2]
        var price = parseFloat(parts[3]) || 0
        if (price <= 0) continue
        var changePct = parseFloat(parts[32]) || 0
        var prevClose = parseFloat(parts[4]) || 0
        results[code] = {
          code: code,
          name: String(parts[1] || ""),
          price: price,
          changePct: changePct,
          turnover: parseFloat(parts[38]) || 0,
          volumeRatio: parseFloat(parts[49]) || 0,
          pe: parseFloat(parts[39]) || 0,
          pb: parseFloat(parts[46]) || 0,
          circCap: parseFloat(parts[44]) || 0,
          roe: parseFloat(parts[65]) || 0,
          grossMargin: parseFloat(parts[66]) || 0,
          debtRatio: parseFloat(parts[67]) || 0,
          high: parseFloat(parts[33]) || 0,
          low: parseFloat(parts[34]) || 0,
          open: prevClose > 0 ? prevClose + (price - prevClose) : price,
          prevClose: prevClose,
          amount: parseFloat(parts[37]) || 0,
          industry: "",
        }
      }
    } catch(e) { console.warn("腾讯热门第" + (b / batchSize + 1) + "批失败:", e.message) }
  }
  console.log("[腾讯热门] 解析 " + Object.keys(results).length + " 只")
  return results
}
module.exports = {
  fetchStockList: fetchStockList,
  fetchSinaRankWithTencent: fetchSinaRankWithTencent,
  fetchTencentHotStocks: fetchTencentHotStocks,
  request: request,
  fetchEMAllStocks: fetchEMAllStocks,
  fetchEMTopStocks: fetchEMTopStocks,
  fetchEMByField: fetchEMByField,
  fetchEMRank: fetchEMRank,
  fetchKlinesConcurrent: fetchKlinesConcurrent,
  fetchTencentBatch: fetchTencentBatch,
  fetchFinancialBatch: fetchFinancialBatch,
  fetchSectorMap: fetchSectorMap,
  fetchSinaAllStocks: fetchSinaAllStocks,
  calcRSI: calcRSI,
  calcMA: calcMA,
  calcEMA: calcEMA,
  calcBollPosition: calcBollPosition,
  calcTechFromKlines: calcTechFromKlines,
  calcADX: calcADX,
  calcOBV: calcOBV,
  calcMASlope: calcMASlope,
  calcATR: calcATR,
  detectPatterns: detectPatterns,
  calcVolumePriceCoord: calcVolumePriceCoord,
  calcTrendAcceleration: calcTrendAcceleration,
  detectConsolidationBreakout: detectConsolidationBreakout,
  calcCandlePatterns: calcCandlePatterns,
  fetchIndustryBatch: fetchIndustryBatch,
  guessIndustry: guessIndustry,
  fetchHS300: fetchHS300,
  decodeName: decodeName,
  parseEMStock: parseEMStock,
}
