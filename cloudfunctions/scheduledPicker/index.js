const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

/**
 * 定时选股 — 每天定时触发三种选股策略
 * 触发器配置:
 * - auctionMorning: 0 15 9 * * 1-5 *  (交易日9:15竞价)
 * - wp2Afternoon:  0 0 14 * * 1-5 *   (交易日14:00尾盘)
 * - strongNoon:    0 30 11 * * 1-5 *   (交易日11:30强势)
 */

exports.main = async (event, context) => {
  const triggerName = event.triggerName || ''
  console.log(`定时触发: ${triggerName}`)

  try {
    switch (triggerName) {
      case 'auctionMorning': {
        const res = await cloud.callFunction({ name: 'auctionPicker', data: { action: 'run', data: { topN: 20 } } })
        console.log('竞价选股完成:', res.result ? 'success' : 'failed')
        break
      }
      case 'wp2Afternoon': {
        const res = await cloud.callFunction({ name: 'wp2Picker', data: { action: 'run', data: { topN: 20 } } })
        console.log('尾盘选股完成:', res.result ? 'success' : 'failed')
        break
      }
      case 'strongNoon': {
        const res = await cloud.callFunction({ name: 'strongPicker', data: { action: 'run', data: { topN: 30 } } })
        console.log('强势选股完成:', res.result ? 'success' : 'failed')
        break
      }
      default:
        // 无触发器名称时执行全部
        console.log('执行全部选股...')
        await cloud.callFunction({ name: 'auctionPicker', data: { action: 'run', data: { topN: 20 } } })
        await cloud.callFunction({ name: 'wp2Picker', data: { action: 'run', data: { topN: 20 } } })
        await cloud.callFunction({ name: 'strongPicker', data: { action: 'run', data: { topN: 30 } } })
    }
  } catch (err) {
    console.error('定时选股失败:', err)
  }

  return { success: true, triggerName }
}
