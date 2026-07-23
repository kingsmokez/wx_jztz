const cloud = require("wx-server-sdk")
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async function(event, context) {
  try {
    const wxContext = cloud.getWXContext()
    const openid = wxContext.OPENID || wxContext.FROM_OPENID || ""

    // 无用户上下文时（MCP测试调用），返回mock数据
    if (!openid) {
      return { success: true, openid: "test_openid", userInfo: { nickName: "测试用户" }, isMock: true }
    }

    // 查找或创建用户
    var userRes = await db.collection("users").where({ _openid: openid }).get()
    var userInfo
    if (userRes.data.length === 0) {
      userInfo = { _openid: openid, nickName: "", avatarUrl: "", createdAt: db.serverDate() }
      await db.collection("users").add({ data: userInfo })
    } else {
      userInfo = userRes.data[0]
    }

    return { success: true, openid: openid, userInfo: userInfo }
  } catch (err) {
    console.error("login error:", err)
    return { success: false, error: err.message }
  }
}
