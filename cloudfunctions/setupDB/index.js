const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 初始化云数据库集合
 * 使用方法：
 * 1. 上传并部署此云函数
 * 2. 在微信开发者工具控制台或小程序中调用：
 *    wx.cloud.callFunction({ name: 'setupDB', data: {} })
 * 
 * 或直接在云开发控制台 → 数据库 → 手动创建集合
 */
exports.main = async (event, context) => {
  const collectionNames = ['users', 'pick_cache', 'stock_cache', 'financial_cache']
  const results = {}

  for (const name of collectionNames) {
    try {
      // 尝试创建集合（添加一条临时数据避免集合被删除）
      const col = db.collection(name)
      
      // 先检查集合是否已存在
      try {
        const test = await col.limit(1).get()
        results[name] = {
          created: false,
          existing: true,
          count: test.data.length,
        }
      } catch {
        // 集合不存在，尝试创建
        try {
          // 微信云开发通过 createCollection API 创建集合（如果用 add 来"隐式创建"可能被忽略）
          // 使用 add + 之后立即 remove 来创建集合结构
          const addRes = await col.add({
            data: {
              _init: true,
              createdAt: db.serverDate(),
            }
          })
          // 删除初始化记录
          await col.doc(addRes._id).remove()
          results[name] = {
            created: true,
            existing: false,
            message: '集合创建成功',
          }
        } catch (createErr) {
          // 可能在云端已存在，尝试直接查询
          try {
            const retryRes = await col.limit(1).get()
            results[name] = {
              created: false,
              existing: true,
              count: retryRes.data.length,
            }
          } catch {
            results[name] = {
              created: false,
              existing: false,
              error: createErr.message || '创建失败',
            }
          }
        }
      }
    } catch (err) {
      results[name] = {
        created: false,
        error: err.message || '未知错误',
      }
    }
  }

  // 创建必要的索引
  try {
    // pick_cache 复合索引
    await db.collection('pick_cache').createIndex ? null : null  // 微信云开发暂不支持 API 创建索引
  } catch {}

  return {
    success: true,
    message: '数据库集合初始化完成',
    results,
    manualInstructions: `
如果某些集合创建失败，请在微信开发者工具中手动操作：
1. 打开「云开发控制台」
2. 点击「数据库」
3. 点击「+」新建集合
4. 输入集合名称：users、pick_cache、stock_cache、financial_cache
5. 为 pick_cache 创建索引：type (升序) + date (升序)
6. 为 stock_cache 创建索引：cachedAt (升序)
    `,
  }
}
