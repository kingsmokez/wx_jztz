/**
 * 常量定义 — 与原版 scoring.py 严格对齐
 */

const FACTOR_WEIGHTS = {
  value: 0.36, quality: 0.11, growth: 0.08, momentum: 0.12, sentiment: 0.33,
}

const PICK_TYPES = { AUCTION: 'auction', WP2: 'wp2', STRONG: 'strong' }

const PICK_TYPE_NAMES = { auction: '早盘竞价', wp2: '尾盘强势', strong: '短线强势' }

const SECTOR_PE_RANGES = {
  semiconductor: { names: ['半导体','芯片','集成电路'], peMax: 100, peLow: 28 },
  bio_pharma: { names: ['生物制品','医药','医疗器械','中药'], peMax: 80, peLow: 13 },
  new_energy: { names: ['电池','光伏','储能','新能源'], peMax: 50, peLow: 22 },
  electronics: { names: ['电子元件','消费电子','电子'], peMax: 85, peLow: 25 },
  software_it: { names: ['软件','信息服务','AI','人工智能'], peMax: 120, peLow: 39 },
  automotive: { names: ['汽车制造','汽车零部件'], peMax: 50, peLow: 10 },
  electrical: { names: ['电气设备','机械','专用设备'], peMax: 35, peLow: 16 },
  finance: { names: ['银行','保险','证券','房地产'], peMax: 20, peLow: 8 },
  consumer: { names: ['食品饮料','消费','白酒','家电'], peMax: 45, peLow: 14 },
  cyclical: { names: ['化工','有色','钢铁','煤炭','石油'], peMax: 30, peLow: 12 },
}

module.exports = {
  FACTOR_WEIGHTS, PICK_TYPES, PICK_TYPE_NAMES, SECTOR_PE_RANGES,
}
