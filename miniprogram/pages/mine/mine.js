var api = require('../../utils/api')

Page({
  data: {
    totalPicks: 0,
    avgScore: 0,
    highCount: 0
  },

  onShow: function() {
    this.loadStats()
  },

  loadStats: function() {
    var that = this
    Promise.all([
      api.callFunctionWithTimeout('auctionPicker', 'list', {}, 30000, null),
      api.callFunctionWithTimeout('wp2Picker', 'list', {}, 30000, null),
      api.callFunctionWithTimeout('strongPicker', 'list', {}, 30000, null),
    ]).then(function(results) {
      var auctionRes = results[0]
      var wp2Res = results[1]
      var strongRes = results[2]
      var all = []
      var addScore = function(arr, key) {
        if (arr && arr.length) {
          for (var i = 0; i < arr.length; i++) {
            all.push(arr[i][key] || arr[i].score || arr[i].finalScore || 0)
          }
        }
      }
      addScore(auctionRes && auctionRes.data, 'finalScore')
      addScore(wp2Res && wp2Res.data, 'score')
      addScore(strongRes && strongRes.data, 'totalScore')
      var total = all.length
      var sum = 0
      for (var i = 0; i < all.length; i++) sum += all[i]
      var avg = total > 0 ? Math.round(sum / total) : 0
      var high = 0
      for (var i = 0; i < all.length; i++) { if (all[i] >= 75) high++ }
      that.setData({ totalPicks: total, avgScore: avg, highCount: high })
    }).catch(function(err) {
      console.error('统计获取失败:', err)
    })
  },

  initDB: function() {
    wx.showLoading({ title: '初始化中...', mask: true })
    api.callFunction('setupDB', 'init', {}).then(function(res) {
      wx.hideLoading()
      if (res && res.success) {
        wx.showToast({ title: '初始化完成', icon: 'success' })
      } else {
        wx.showToast({ title: '初始化失败', icon: 'none' })
      }
    }).catch(function(err) {
      wx.hideLoading()
      wx.showToast({ title: '初始化失败', icon: 'none' })
    })
  },
})
