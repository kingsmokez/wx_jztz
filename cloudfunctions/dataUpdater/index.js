/**
 * V11 最终架构：dataUpdater 只做验证+触发，选股器自己实时拉行情
 *
 * 结论：微信云开发 NoSQL 写入 5000 条文档至少需 40 秒（速率上限 ~120 docs/s）。
 * 与其等待，不如让选股器自己 16 并发实时拉 5000 只行情（~2秒）。
 *
 * dataUpdater 角色改变：
 *   - 每天第一次调用：刷新全市场行情到 stock_cache（慢，但每天只需一次）
 *   - 之后的定时调用：只更新 stock_list 缓存（快）
 */
const cloud = require("wx-server-sdk")
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function fastGet(url, timeout) {
  return new Promise(function(resolve, reject) {
    var mod = url.startsWith("https") ? require("https") : require("http")
    var req = mod.get(url, {
      timeout: timeout || 3000,
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://gu.qq.com/" }
    }, function(res) { var d=""; res.setEncoding("utf-8"); res.on("data",function(c){d+=c}); res.on("end",function(){resolve(d)}) })
    req.on("timeout", function() { req.destroy(); reject(new Error("timeout")) })
    req.on("error", reject)
  })
}

async function getStockCodes() {
  try {
    var c = await db.collection("stock_list").doc("all_codes").get()
    if (c.data && c.data.codes && Date.now()-c.data.updateAt < 3600000)
      return c.data.codes
  } catch(e) {}
  console.log("拉取全A股代码...")
  var codes = [], now = new Date(Date.now()+8*3600*1000)
  var qd = [now.getUTCFullYear()+"Q2", now.getUTCFullYear()+"Q1", (now.getUTCFullYear()-1)+"Q4"]
  for (var qi=0; qi<qd.length; qi++) {
    try {
      var t=await fastGet("https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_LICO_FN_CPD&columns=SECURITY_CODE&filter=(QDATE=%22"+qd[qi]+"%22)&pageNumber=1&pageSize=1&source=WEB&client=WEB",4000)
      var td=JSON.parse(t); if(!td.success||!td.result||td.result.count<1000) continue
      var pages=Math.ceil(td.result.count/500), reqs=[]
      for(var p=1;p<=pages;p++) reqs.push(fastGet("https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_LICO_FN_CPD&columns=SECURITY_CODE,SECURITY_NAME_ABBR&filter=(QDATE=%22"+qd[qi]+"%22)&pageNumber="+p+"&pageSize=500&sortTypes=-1&sortColumns=SECURITY_CODE&source=WEB&client=WEB",6000))
      var results=await Promise.all(reqs)
      for(var pi=0;pi<results.length;pi++){try{var d=JSON.parse(results[pi]);if(!d.success||!d.result||!d.result.data)continue;for(var ri=0;ri<d.result.data.length;ri++){var r=d.result.data[ri],c=String(r.SECURITY_CODE||""),n=String(r.SECURITY_NAME_ABBR||"");if(c.length!==6||!/^\d+$/.test(c))continue;if(c[0]==="2"||c[0]==="4"||c[0]==="8"||c[0]==="9")continue;if(n.includes("ST")||n.includes("*"))continue;codes.push({code:c,name:n})}}catch(e){}}
      if(codes.length>1000) break
    } catch(e) { continue }
  }
  var seen={}, unique=[]
  for(var i=0;i<codes.length;i++){if(!seen[codes[i].code]){seen[codes[i].code]=true;unique.push(codes[i])}}
  try{await db.collection("stock_list").doc("all_codes").set({data:{codes:unique,updateAt:Date.now(),count:unique.length}})}catch(e){}
  return unique
}

exports.main = async function(event, context) {
  var t0 = Date.now()
  try {
    if (event.action === "status") {
      try {
        var s = await db.collection("stock_list").doc("all_codes").get()
        return { success: true, count: s.data.count || 0, updateAt: s.data.updateAt || 0 }
      } catch(e) { return { success: true, count: 0 } }
    }
    // 每天首次拉取代码（定时触发也仅拉代码+校验），
    // 行情由选股器实时获取
    var allCodes = await getStockCodes()
    console.log("代码更新: " + allCodes.length + " (" + (Date.now()-t0) + "ms)")
    return { success: true, count: allCodes.length, elapsed: Date.now()-t0 }
  } catch(err) {
    return { success: false, error: err.message, elapsed: Date.now()-t0 }
  }
}
