/**
 * 云函数统一调用封装
 * V2: 使用 wx.cloud.callFunction 的 timeout 选项，覆盖微信SDK默认3秒超时
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
  return callFunction(name, action, data).then(function(result) {
    wx.hideLoading()
    return result
  }).catch(function(err) {
    wx.hideLoading()
    if (action === 'run') {
      console.warn('云函数 ' + name + '.run 失败，尝试读取缓存...')
      return callFunction(name, 'list', {}).then(function(cached) {
        if (cached && cached.data && cached.data.length > 0) {
          var merged = Object.assign({}, cached, { fromCache: true })
          wx.showToast({ title: '已显示缓存数据', icon: 'none', duration: 2000 })
          return merged
        }
        throw new Error('无缓存数据')
      }).catch(function(e2) {
        var msg = (err && err.errMsg) || (err && err.message) || '网络异常'
        var isTimeout = msg.indexOf('timeout') >= 0 || msg.indexOf('-504003') >= 0 || msg.indexOf('timed out') >= 0
        throw new Error(isTimeout ? '选股超时，请稍后重试' : msg)
      })
    }
    var msg = (err && err.errMsg) || (err && err.message) || '网络异常'
    var isTimeout = msg.indexOf('timeout') >= 0 || msg.indexOf('-504003') >= 0 || msg.indexOf('timed out') >= 0
    throw new Error(isTimeout ? '选股超时，请稍后重试' : msg)
  })
}

module.exports = {
  callFunction: callFunction,
  callFunctionWithTimeout: callFunctionWithTimeout,
  callFunctionWithLoading: callFunctionWithLoading,
}
