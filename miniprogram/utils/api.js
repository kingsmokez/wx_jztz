/**
 * 云函数统一调用封装
 * V3: 增加前端超时保护，在微信SDK超时前主动降级到缓存
 */

function callFunction(name, action, data) {
  if (!data) data = {}
  return new Promise(function(resolve, reject) {
    wx.cloud.callFunction({
      name: name,
      data: { action: action, data: data },
      timeout: 120000,
      success: function(res) {
        if (res.result && res.result.success) {
          resolve(res.result)
        } else {
          var errMsg = (res.result && res.result.error) || '操作失败'
          reject(new Error(errMsg))
        }
      },
      fail: function(err) {
        reject(err)
      }
    })
  })
}

function callFunctionWithTimeout(name, action, data, timeoutMs, fallback) {
  if (!data) data = {}
  if (!timeoutMs) timeoutMs = 120000
  return new Promise(function(resolve) {
    var done = false
    var timer = setTimeout(function() {
      if (!done) {
        done = true
        console.warn('云函数 ' + name + '.' + action + ' 超时 ' + timeoutMs + 'ms')
        resolve(fallback || { success: true, data: [], cached: false })
      }
    }, timeoutMs)
    callFunction(name, action, data).then(function(res) {
      if (!done) { done = true; clearTimeout(timer); resolve(res) }
    }).catch(function(err) {
      if (!done) { done = true; clearTimeout(timer); resolve(fallback || { success: true, data: [], cached: false }) }
    })
  })
}

function callFunctionWithLoading(name, action, data) {
  if (!data) data = {}
  wx.showLoading({ title: '选股中...', mask: true })
  // 前端30秒超时保护，在微信SDK超时前主动降级
  var frontendTimeout = 30000
  return new Promise(function(resolve) {
    var done = false
    var timer = setTimeout(function() {
      if (!done) {
        done = true
        wx.hideLoading()
        console.warn('云函数 ' + name + '.run 前端超时 ' + frontendTimeout + 'ms，降级到缓存')
        // 尝试读取缓存
        callFunction(name, 'list', {}).then(function(cached) {
          if (cached && cached.data && cached.data.length > 0) {
            wx.showToast({ title: '选股超时，已显示缓存', icon: 'none', duration: 2000 })
            resolve(Object.assign({}, cached, { fromCache: true }))
          } else {
            wx.showToast({ title: '选股超时，请稍后重试', icon: 'none', duration: 2000 })
            resolve({ success: true, data: [], cached: false, fromCache: false })
          }
        }).catch(function(e2) {
          wx.showToast({ title: '选股超时，请稍后重试', icon: 'none', duration: 2000 })
          resolve({ success: true, data: [], cached: false, fromCache: false })
        })
      }
    }, frontendTimeout)

    callFunction(name, action, data).then(function(result) {
      if (!done) {
        done = true
        clearTimeout(timer)
        wx.hideLoading()
        resolve(result)
      }
    }).catch(function(err) {
      if (!done) {
        done = true
        clearTimeout(timer)
        wx.hideLoading()
        if (action === 'run') {
          console.warn('云函数 ' + name + '.run 失败，尝试读取缓存...')
          callFunction(name, 'list', {}).then(function(cached) {
            if (cached && cached.data && cached.data.length > 0) {
              wx.showToast({ title: '已显示缓存数据', icon: 'none', duration: 2000 })
              resolve(Object.assign({}, cached, { fromCache: true }))
            } else {
              var msg = (err && err.errMsg) || (err && err.message) || '网络异常'
              var isTimeout = msg.indexOf('timeout') >= 0 || msg.indexOf('-504003') >= 0 || msg.indexOf('timed out') >= 0
              wx.showToast({ title: isTimeout ? '选股超时，请稍后重试' : msg, icon: 'none', duration: 2000 })
              resolve({ success: true, data: [], cached: false, fromCache: false })
            }
          }).catch(function(e2) {
            wx.showToast({ title: '网络异常', icon: 'none', duration: 2000 })
            resolve({ success: true, data: [], cached: false, fromCache: false })
          })
        } else {
          var msg = (err && err.errMsg) || (err && err.message) || '网络异常'
          wx.showToast({ title: msg, icon: 'none', duration: 2000 })
          resolve({ success: true, data: [], cached: false })
        }
      }
    })
  })
}

module.exports = {
  callFunction: callFunction,
  callFunctionWithTimeout: callFunctionWithTimeout,
  callFunctionWithLoading: callFunctionWithLoading,
}