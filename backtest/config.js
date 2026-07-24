/**
 * 回测框架 - 短线强势股策略
 */

var http = require("http")
var https = require("https")
var fs = require("fs")
var path = require("path")

var CONFIG = {
  startDate: "2024-07-25",
  endDate: "2026-07-25",
  holdDays: [1, 3, 5, 10],
  topN: 20,
  cacheDir: path.join(__dirname, "cache"),
  outputDir: path.join(__dirname, "results"),
}

function request(url, options) {
  if (!options) options = {}
  return new Promise(function(resolve, reject) {
    var timeout = options.timeout || 15000
    var protocol = url.startsWith("https") ? https : http
    var bufs = []
    var timer = setTimeout(function() { req.destroy(); reject(new Error("timeout")) }, timeout)
    var req = protocol.get(url, { headers: options.headers || {} }, function(res) {
      res.on("data", function(chunk) { bufs.push(Buffer.from(chunk)) })
      res.on("end", function() {
        clearTimeout(timer)
        try { resolve(Buffer.concat(bufs).toString("utf8")) } catch(e) { resolve("") }
      })
    })
    req.on("error", function(err) { clearTimeout(timer); reject(err) })
  })
}

module.exports = { CONFIG, request }
