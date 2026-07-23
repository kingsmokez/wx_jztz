const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

/**
 * 板块轮动 — 对齐原版 modules/sector_rotation.py
 * 提供板块相对强度和轮动阶段检测
 */

const SECTOR_KEYWORDS = {
  '半导体': ['芯片','半导体','集成电路','GPU','算力'],
  '人工智能': ['AI','大模型','ChatGPT','深度学习','自动驾驶'],
  '新能源': ['新能源','光伏','储能','锂电','固态电池'],
  '医药': ['医药','生物','创新药','疫苗','CXO','中药'],
  '消费': ['消费','食品','白酒','家电','零售'],
  '金融': ['银行','保险','证券','地产'],
  '周期': ['化工','有色','钢铁','煤炭','石油'],
  '军工': ['军工','国防','航天','航空'],
  '汽车': ['汽车','新能源车','零部件'],
  '电子': ['电子元件','消费电子','苹果'],
}

function matchSectorFromIndustry(industry) {
  if (!industry) return '其他'
  for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS)) {
    for (const kw of keywords) {
      if (industry.includes(kw)) return sector
    }
  }
  return '其他'
}

/**
 * 计算板块加分 — 对齐原版 calculate_sector_bonus()
 */
function calculateSectorBonus(stock, hotSectors = []) {
  if (!hotSectors || hotSectors.length === 0) return { bonus: 0, reasons: [] }

  const industry = stock.industry || ''
  const name = stock.name || ''
  const searchText = industry + name
  let bonus = 0
  const reasons = []

  for (const hot of hotSectors) {
    const sectorName = hot.name || hot
    const keywords = SECTOR_KEYWORDS[sectorName] || [sectorName]
    for (const kw of keywords) {
      if (searchText.includes(kw)) {
        bonus += 5
        reasons.push(`热门板块: ${sectorName}`)
        break
      }
    }
  }

  return { bonus: Math.min(bonus, 15), reasons }
}

exports.main = async (event, context) => {
  const { action, data = {} } = event
  try {
    switch (action) {
      case 'bonus': {
        const result = calculateSectorBonus(data.stock, data.hotSectors || [])
        return { success: true, data: result }
      }
      case 'match': {
        const sector = matchSectorFromIndustry(data.industry)
        return { success: true, data: { sector } }
      }
      default: return { success: false, error: '未知操作' }
    }
  } catch (err) {
    console.error('sectorRotation error:', err)
    return { success: false, error: err.message }
  }
}
