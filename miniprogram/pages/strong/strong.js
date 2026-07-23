var api = require("../../utils/api")

Page({
  data: { stocks: [], marketEnv: null, loading: false, pickTime: "", hasCache: false, avgChange: "--", avgScore: "--", goldenCount: 0, pullbackCount: 0 },

  onShow: function() { this.loadList() },

  computeStats: function(stocks) {
    if (!stocks || stocks.length === 0) return { avgChange: "--", avgScore: "--", goldenCount: 0, pullbackCount: 0 }
    var totalChg = 0, totalScore = 0, goldenCount = 0, pullbackCount = 0
    for (var i = 0; i < stocks.length; i++) {
      totalChg += parseFloat(stocks[i].changePct) || 0
      totalScore += parseFloat(stocks[i].totalScore) || 0
      if (stocks[i].goldenCross) goldenCount++
      if (stocks[i].pullbackStable) pullbackCount++
    }
    return {
      avgChange: (totalChg / stocks.length).toFixed(1) + "%",
      avgScore: Math.round(totalScore / stocks.length),
      goldenCount: goldenCount,
      pullbackCount: pullbackCount,
    }
  },

  loadList: function() {
    var that = this
    that.setData({ loading: true })
    api.callFunctionWithTimeout("strongPicker", "list", {}, 60000, { success: true, data: [], cached: false }).then(function(res) {
      var now = new Date()
      var stocks = (res && res.data) || []
      var stats = that.computeStats(stocks)
      that.setData({
        stocks: stocks,
        marketEnv: (res && res.marketEnv) || null,
        pickTime: String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0"),
        loading: false,
        hasCache: res && res.cached,
        avgChange: stats.avgChange,
        avgScore: stats.avgScore,
        goldenCount: stats.goldenCount,
        pullbackCount: stats.pullbackCount,
      })
    }).catch(function(err) {
      that.setData({ loading: false, stocks: [] })
      console.error("强势股数据加载失败:", err)
    })
  },

  refresh: function() {
    var that = this
    that.setData({ loading: true })
    api.callFunctionWithLoading("strongPicker", "run", { topN: 20, force: true }).then(function(res) {
      var now = new Date()
      var stockData = (res && res.data) || []
      var stats = that.computeStats(stockData)
      that.setData({
        stocks: stockData,
        marketEnv: (res && res.marketEnv) || null,
        pickTime: String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0"),
        loading: false,
        hasCache: (res && res.cached) || (res && res.fromCache) || false,
        avgChange: stats.avgChange,
        avgScore: stats.avgScore,
        goldenCount: stats.goldenCount,
        pullbackCount: stats.pullbackCount,
      })
      if (res && res.fromCache) {
        wx.showToast({ title: "选股超时，已显示缓存", icon: "none", duration: 2500 })
      } else {
        wx.showToast({ title: "选出" + stockData.length + "只", icon: "none" })
      }
    }).catch(function(err) {
      that.setData({ loading: false })
      wx.showToast({ title: (err && err.message) || "选股失败", icon: "none", duration: 2500 })
    })
  },

  onPullDownRefresh: function() { this.loadList(); wx.stopPullDownRefresh() },
})
