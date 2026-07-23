var config = require("./config")

App({
  onLaunch: function() {
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力")
      return
    }
    wx.cloud.init({
      env: config.envId,
      traceUser: true,
    })
    this.login()
    // 每次启动都尝试初始化数据库（幂等操作）
    this.initDatabase()
  },

  initDatabase: function() {
    wx.cloud.callFunction({
      name: "setupDB",
      data: {},
    }).then(function(res) {
      var result = res.result || {}
      console.log("数据库初始化结果:", JSON.stringify(result))
      if (result.success) {
        wx.setStorageSync("db_initialized", true)
      }
    }).catch(function(err) {
      console.warn("数据库初始化跳过:", (err && err.errMsg) || "")
    })
  },

  login: function() {
    var that = this
    wx.cloud.callFunction({
      name: "login",
      data: {},
    }).then(function(res) {
      var result = res.result || {}
      if (result.success) {
        that.globalData.openid = result.openid
        that.globalData.userInfo = result.userInfo
      }
    }).catch(function(err) {
      console.warn("登录跳过:", (err && err.errMsg) || "")
    })
  },

  globalData: {
    openid: null,
    userInfo: null,
  },
})
