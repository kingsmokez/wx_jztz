const api = require('../../utils/api')

Page({
  data: {
    marketEnv: null,
    auctionCount: 0,
    wp2Count: 0,
    strongCount: 0,
  },

  onShow() {
    this.loadMarketEnv()
    this.loadPickCounts()
  },

  loadMarketEnv: function() {
    var that = this
    api.callFunctionWithTimeout('marketEnv', 'get', {}, 15000, null).then(function(res) {
      if (res && res.data) that.setData({ marketEnv: res.data })
    }).catch(function(err) { console.error('大盘环境获取失败:', err) })
  },

  loadPickCounts: function() {
    var that = this
    Promise.all([
      api.callFunctionWithTimeout('auctionPicker', 'list', {}, 30000, null),
      api.callFunctionWithTimeout('wp2Picker', 'list', {}, 30000, null),
      api.callFunctionWithTimeout('strongPicker', 'list', {}, 30000, null),
    ]).then(function(results) {
      var auctionRes = results[0]
      var wp2Res = results[1]
      var strongRes = results[2]
      that.setData({
        auctionCount: auctionRes && auctionRes.data ? auctionRes.data.length : 0,
        wp2Count: wp2Res && wp2Res.data ? wp2Res.data.length : 0,
        strongCount: strongRes && strongRes.data ? strongRes.data.length : 0,
      })
    }).catch(function(err) { console.error('选股数据获取失败:', err) })
  },

  goAuction: function() { wx.switchTab({ url: '/pages/auction/auction' }) },
  goWp2: function() { wx.switchTab({ url: '/pages/wp2/wp2' }) },
  goStrong: function() { wx.switchTab({ url: '/pages/strong/strong' }) },

  onPullDownRefresh: function() {
    this.loadMarketEnv()
    this.loadPickCounts()
    wx.stopPullDownRefresh()
  },
})
