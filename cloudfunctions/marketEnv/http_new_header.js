/**
 * HTTP工具 - 腾讯/东财行情数据获取
 * V7: 支持GBK编码（腾讯行情）+ 东财全市场数据
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

