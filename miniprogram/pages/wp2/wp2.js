var api = require('../../utils/api')

Page({
  data: { stocks: [], marketEnv: null, loading: false, pickTime: '', hasCache: false },

  onShow: function() { this.loadList() },

  loadList: function() {
    var that = this
    that.setData({ loading: true })
    api.callFunctionWithTimeout('wp2Picker', 'list', {}, 60000, { success: true, data: [], cached: false }).then(function(res) {
      var now = new Date()
      that.setData({
        stocks: (res && res.data) || [],
        marketEnv: (res && res.marketEnv) || null,
        pickTime: String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'),
        loading: false,
        hasCache: res && res.cached,
      })
    }).catch(function(err) {
      that.setData({ loading: false, stocks: [] })
      console.error('尾盘股数据加载失败:', err)
    })
  },

  refresh: function() {
    var that = this
    that.setData({ loading: true })
    api.callFunctionWithLoading('wp2Picker', 'run', { topN: 20, force: true }).then(function(res) {
      var now = new Date()
      var stockData = (res && res.data) || []
      that.setData({
        stocks: stockData,
        marketEnv: (res && res.marketEnv) || null,
        pickTime: String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'),
        loading: false,
        hasCache: (res && res.cached) || (res && res.fromCache) || false,
      })
      if (res && res.fromCache) {
        wx.showToast({ title: '选股超时，已显示缓存', icon: 'none', duration: 2500 })
      } else {
        wx.showToast({ title: '选出' + stockData.length + '只', icon: 'none' })
      }
    }).catch(function(err) {
      that.setData({ loading: false })
      wx.showToast({ title: (err && err.message) || '选股失败', icon: 'none', duration: 2500 })
    })
  },

  onPullDownRefresh: function() { this.loadList(); wx.stopPullDownRefresh() },
})
