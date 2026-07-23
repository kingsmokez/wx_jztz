/**
 * 评分配置 — 与原版 scoring.py 严格对齐
 */

// 五因子权重
const FACTOR_WEIGHTS = {
  value: 0.36,
  quality: 0.11,
  growth: 0.08,
  momentum: 0.12,
  sentiment: 0.33,
}

// 行业PE合理范围 — 与原版 SECTOR_PE_RANGES 完全一致
const SECTOR_PE_RANGES = {
  semiconductor: { names: ['半导体','芯片','集成电路'], keywords: ['半导体','芯片','集成电路','GPU','算力'], peMax: 100, peLow: 28 },
  bio_pharma: { names: ['生物制品','医药','医疗服务','医疗器械','中药','医疗行业','医药制造'], keywords: ['生物制品','医药','医疗','制药','疫苗','CXO','中药','器械'], peMax: 80, peLow: 13 },
  new_energy: { names: ['电池','光伏','储能','锂电','新能源','光伏设备','风电设备'], keywords: ['电池','光伏','储能','锂电','新能源','固态','钠电','充电桩','风电'], peMax: 50, peLow: 22 },
  electronics: { names: ['电子元件','消费电子','电子'], keywords: ['电子元件','消费电子','光通信','PCB','电路板','苹果产业链'], peMax: 85, peLow: 25 },
  software_it: { names: ['软件','信息服务','通信','数字经济','软件服务'], keywords: ['软件','信息','科技','数字','云计算','大数据','AI','人工智能'], peMax: 120, peLow: 39 },
  automotive: { names: ['汽车制造','汽车零部件','汽车整车'], keywords: ['汽车制造','汽车零部件','汽车','新能源汽车'], peMax: 50, peLow: 10 },
  electrical_machinery: { names: ['电气设备','机械','专用设备'], keywords: ['电气设备','机械','重工','电力设备','专用设备'], peMax: 35, peLow: 16 },
  finance_utility: { names: ['银行','保险','证券','房地产','公用事业','券商信托','电力行业','港口水运'], keywords: ['银行','保险','证券','地产','房地产','公用','电力','水务','高速','港口','券商'], peMax: 20, peLow: 8 },
  consumer: { names: ['食品饮料','消费','旅游','免税','零售','白酒','家电','消费电子'], keywords: ['消费','食品','饮料','酒','旅游','免税','零售','家电'], peMax: 45, peLow: 14 },
  cyclical: { names: ['化工','有色金属','钢铁','建材','煤炭','石油','化工行业','化学原料'], keywords: ['化工','有色','钢铁','建材','煤炭','石油','水泥','玻璃','矿业','化学'], peMax: 30, peLow: 12 },
}

// 排除列表
const LIQUOR_NAMES = ['贵州茅台','五粮液','洋河股份','泸州老窖','山西汾酒','酒鬼酒','水井坊','古井贡酒','迎驾贡酒','今世缘','舍得酒业','老白干酒','伊力特','口子窖','金徽酒','皇台酒业','岩石股份','顺鑫农业']
const BANK_CODES = ['601398','601288','600000','600036','601166','600015','600016','601328','600919','600028','601939','601988','601318','600030']

// 评分阈值
const SCORE_SHORT_CIRCUIT_THRESHOLD = 40.0
const MIN_SCORE_TO_RETURN = 25
const INDUSTRY_MAX_PER = 2

module.exports = {
  FACTOR_WEIGHTS,
  SECTOR_PE_RANGES,
  LIQUOR_NAMES,
  BANK_CODES,
  SCORE_SHORT_CIRCUIT_THRESHOLD,
  MIN_SCORE_TO_RETURN,
  INDUSTRY_MAX_PER,
}
