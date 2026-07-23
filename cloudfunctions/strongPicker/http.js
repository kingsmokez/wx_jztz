/**
 * HTTP工具 - 东财datacenter全市场行情 + 腾讯K线
 * V7: 东财全市场5000+股票快速获取 + GBK解码修复
 */
var http = require("http")
var https = require("https")
var Iconv = null
try { Iconv = require("iconv-lite") } catch(e) {}

// 修复东财股票名称乱码：如果JSON解析后中文乱码，尝试通过GBK重新解码
function decodeName(raw) {
  if (!raw || raw === "") return ""
  var rawStr = String(raw)
  // 如果已经有中文字符，说明解码正常
  if (/[\u4e00-\u9fff]/.test(rawStr)) return rawStr
  // 尝试通过 latin1 -> GBK 回退解码修复乱码
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
        code: String(s.f12 || ""), name: decodeName(s.f14),
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

// ===== 腾讯+Sina双降级行情（当东财不可用时使用）=====
async function fetchSinaAllStocks() {
  var allStocks = {}
  // 使用新浪涨幅榜获取TOP股票（1-2页，前200只）
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
      if (items.length > 0) { console.log("新浪样本: code=" + items[0].code + " name=" + items[0].name + " chg=" + items[0].changepercent + " trade=" + items[0].trade + " turn=" + items[0].turnratio + " vol=" + items[0].volume + " nmc=" + items[0].nmc + " price=" + items[0].trade); }
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


async function fetchHS300() {
  try {
    var text = await request("https://hq.sinajs.cn/list=sh000300", {
      timeout: 3000,
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.sina.com.cn/" }
    })
    var m = text.match(/"([^"]+)"/)
    if (!m) return null
    var ps = m[1].split(",")
    if (ps.length < 5) return null
    var pc = parseFloat(ps[2]) || 0
    var cur = parseFloat(ps[3]) || 0
    if (pc <= 0) return null
    var cp = Math.round((cur - pc) / pc * 10000) / 100
    var st = "震荡"
    if (cp > 2) st = "大涨"
    else if (cp > 0.5) st = "上涨"
    else if (cp > -0.5) st = "震荡"
    else if (cp > -2) st = "下跌"
    else st = "大跌"
    return { status: st, changePct: cp, current: cur, prevClose: pc }
  } catch(e) { return null }
}
function guessIndustry(name, code) {
  if (!name) return "综合"
  var n = name
  var pairs = [
    ["半导体","电子-半导体"],["芯片","电子-半导体"],["集成电路","电子-半导体"],
    ["医药","医药生物-医药"],["医疗","医药生物-医疗"],["生物","医药生物-生物医药"],
    ["药","医药生物-医药"],["中药","医药生物-中药"],["化学制药","医药生物-化学制药"],
    ["创新药","医药生物-创新药"],["医疗器械","医药生物-医疗器械"],["疫苗","医药生物-疫苗"],
    ["电池","电力设备-电池"],["光伏","电力设备-光伏"],["锂电","电力设备-锂电池"],
    ["新能源","电力设备-新能源"],["风电","电力设备-风电"],["储能","电力设备-储能"],
    ["充电桩","电力设备-充电桩"],["固态电池","电力设备-固态电池"],
    ["软件","计算机-软件"],["数据","计算机-数据"],["智能","计算机-人工智能"],
    ["信息","计算机-信息技术"],["算力","计算机-算力"],["云计算","计算机-云计算"],
    ["大数据","计算机-大数据"],["AI","计算机-人工智能"],["人工智能","计算机-人工智能"],
    ["信创","计算机-信创"],["互联网","计算机-互联网"],["外包","计算机-IT服务"],
    ["液冷","计算机-液冷"],
    ["通信","通信-通信"],["5G","通信-5G"],["光模块","通信-光模块"],["光通信","通信-光通信"],
    ["电子","电子-电子元器件"],["电路","电子-电路板"],["元器件","电子-元器件"],
    ["消费电子","电子-消费电子"],["光学","电子-光学"],["PCB","电子-PCB"],
    ["覆铜板","电子-覆铜板"],["连接器","电子-连接器"],["传感器","电子-传感器"],
    ["半导体设备","电子-半导体设备"],["半导体材料","电子-半导体材料"],
    ["汽车","汽车-汽车"],["零部","汽车-零部件"],["整车","汽车-整车"],
    ["轮胎","汽车-轮胎"],["汽配","汽车-汽配"],["新能源车","汽车-新能源汽车"],
    ["新能源汽车","汽车-新能源汽车"],
    ["机械","机械设备-机械"],["装备","机械设备-装备"],["设备","机械设备-设备"],
    ["机器人","机械设备-机器人"],["激光","机械设备-激光"],
    ["工业母机","机械设备-工业母机"],["数控","机械设备-数控"],
    ["工程机械","机械设备-工程机械"],["农机","机械设备-农机"],
    ["减速器","机械设备-减速器"],["温控","机械设备-温控"],["3D打印","机械设备-3D打印"],
    ["电气","电力设备-电气设备"],["电网","电力设备-电网"],
    ["化工","基础化工-化工"],["化学","基础化工-化工"],["化纤","基础化工-化纤"],
    ["农药","基础化工-农药"],["化肥","基础化工-化肥"],["橡胶","基础化工-橡胶"],
    ["塑料","基础化工-塑料"],["碳纤维","基础化工-碳纤维"],["复合材料","基础化工-复合材料"],
    ["有色","有色金属-有色金属"],["稀土","有色金属-稀土"],["黄金","有色金属-黄金"],
    ["铜","有色金属-铜"],["铝","有色金属-铝"],["磁材","有色金属-磁性材料"],
    ["永磁","有色金属-永磁"],
    ["钢铁","钢铁-钢铁"],["煤炭","煤炭-煤炭"],["石油","石油石化-石油"],
    ["建材","建筑材料-建材"],["水泥","建筑材料-水泥"],["玻璃","建筑材料-玻璃"],
    ["银行","银行-银行"],["保险","非银金融-保险"],["证券","非银金融-证券"],
    ["券商","非银金融-券商"],
    ["地产","房地产-房地产"],["房","房地产-房地产"],["物业","房地产-物业"],
    ["园区","房地产-园区"],
    ["食品","食品饮料-食品"],["饮料","食品饮料-饮料"],["酒","食品饮料-酒"],
    ["白酒","食品饮料-白酒"],["乳业","食品饮料-乳业"],["调味","食品饮料-调味品"],
    ["预制菜","食品饮料-预制菜"],
    ["家电","家用电器-家电"],
    ["传媒","传媒-传媒"],["影视","传媒-影视"],["游戏","传媒-游戏"],["广告","传媒-广告"],
    ["旅游","社会服务-旅游"],["酒店","社会服务-酒店"],["餐饮","社会服务-餐饮"],
    ["教育","社会服务-教育"],["体育","社会服务-体育"],["检测","社会服务-检测"],
    ["人力","社会服务-人力资源"],
    ["军工","国防军工-军工"],["航天","国防军工-航天"],["船舶","国防军工-船舶"],
    ["无人机","国防军工-无人机"],["低空","国防军工-低空经济"],
    ["环保","环保-环保"],["水务","环保-水务"],["污水处理","环保-污水处理"],
    ["固废","环保-固废"],["节能","环保-节能"],["水处理","环保-水处理"],
    ["纺织","纺织服饰-纺织"],["服装","纺织服饰-服装"],["服饰","纺织服饰-服饰"],
    ["珠宝","纺织服饰-珠宝"],
    ["电商","商贸零售-电商"],["商贸","商贸零售-商贸"],["零售","商贸零售-零售"],
    ["百货","商贸零售-百货"],["贸易","商贸零售-贸易"],["免税","商贸零售-免税"],
    ["物流","交通运输-物流"],["快递","交通运输-快递"],["航空","交通运输-航空"],
    ["高速","交通运输-高速公路"],["公路","交通运输-公路"],
    ["航运","交通运输-航运"],["海运","交通运输-海运"],
    ["养殖","农林牧渔-养殖"],["种业","农林牧渔-种业"],["农业","农林牧渔-农业"],
    ["渔","农林牧渔-渔业"],["牧","农林牧渔-畜牧业"],["宠物","农林牧渔-宠物"],
    ["家居","轻工制造-家居"],["造纸","轻工制造-造纸"],["包装","轻工制造-包装"],
    ["印刷","轻工制造-印刷"],["木材","轻工制造-木材"],["文娱","轻工制造-文娱"],
    ["玩具","轻工制造-玩具"],["家装","轻工制造-家装"],
    ["建筑","建筑装饰-建筑"],["工程","建筑装饰-工程"],
    ["电力","公用事业-电力"],["核电","公用事业-核电"],["水电","公用事业-水电"],
    ["燃气","公用事业-燃气"],
    ["医美","美容护理-医美"],["化妆品","美容护理-化妆品"],["日化","美容护理-日化"],
  ]
  for (var i = 0; i < pairs.length; i++) {
    if (n.indexOf(pairs[i][0]) >= 0) return pairs[i][1]
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
  fetchSinaAllStocks: fetchSinaAllStocks,
  calcRSI: calcRSI,
  calcMA: calcMA,
  calcEMA: calcEMA,
  calcBollPosition: calcBollPosition,
  calcTechFromKlines: calcTechFromKlines,
  guessIndustry: guessIndustry,
  fetchHS300: fetchHS300,
  decodeName: decodeName,
}


