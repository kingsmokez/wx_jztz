/**
 * 评分配置 — 与原版 scoring.py 严格对齐
 * V2: 修正权重为 价值35%/质量18%/成长17%/动量12%/情绪18%
 */

// 五因子权重 — 对齐原版 scoring.py
const FACTOR_WEIGHTS = {
  value: 0.35,
  quality: 0.18,
  growth: 0.17,
  momentum: 0.12,
  sentiment: 0.18,
}

// 行业PE合理范围 — 与原版 SECTOR_PE_RANGES 完全一致
const SECTOR_PE_RANGES = {
  semiconductor: { names: ['\u534a\u5bfc\u4f53','\u82af\u7247','\u96c6\u6210\u7535\u8def'], keywords: ['\u534a\u5bfc\u4f53','\u82af\u7247','\u96c6\u6210\u7535\u8def','GPU','\u7b97\u529b'], peMax: 100, peLow: 28 },
  bio_pharma: { names: ['\u751f\u7269\u5236\u54c1','\u533b\u836f','\u533b\u7597\u670d\u52a1','\u533b\u7597\u5668\u68b0','\u4e2d\u836f','\u533b\u7597\u884c\u4e1a','\u533b\u836f\u5236\u9020'], keywords: ['\u751f\u7269\u5236\u54c1','\u533b\u836f','\u533b\u7597','\u5236\u836f','\u75ab\u82d7','CXO','\u4e2d\u836f','\u5668\u68b0'], peMax: 80, peLow: 13 },
  new_energy: { names: ['\u7535\u6c60','\u5149\u4f0f','\u50a8\u80fd','\u9502\u7535','\u65b0\u80fd\u6e90','\u5149\u4f0f\u8bbe\u5907','\u98ce\u7535\u8bbe\u5907'], keywords: ['\u7535\u6c60','\u5149\u4f0f','\u50a8\u80fd','\u9502\u7535','\u65b0\u80fd\u6e90','\u56fa\u6001','\u94a0\u7535','\u5145\u7535\u6869','\u98ce\u7535'], peMax: 50, peLow: 22 },
  electronics: { names: ['\u7535\u5b50\u5143\u4ef6','\u6d88\u8d39\u7535\u5b50','\u7535\u5b50'], keywords: ['\u7535\u5b50\u5143\u4ef6','\u6d88\u8d39\u7535\u5b50','\u5149\u901a\u4fe1','PCB','\u7535\u8def\u677f','\u82f9\u679c\u4ea7\u4e1a\u94fe'], peMax: 85, peLow: 25 },
  software_it: { names: ['\u8f6f\u4ef6','\u4fe1\u606f\u670d\u52a1','\u901a\u4fe1','\u6570\u5b57\u7ecf\u6d4e','\u8f6f\u4ef6\u670d\u52a1'], keywords: ['\u8f6f\u4ef6','\u4fe1\u606f','\u79d1\u6280','\u6570\u5b57','\u4e91\u8ba1\u7b97','\u5927\u6570\u636e','AI','\u4eba\u5de5\u667a\u80fd'], peMax: 120, peLow: 39 },
  automotive: { names: ['\u6c7d\u8f66\u5236\u9020','\u6c7d\u8f66\u96f6\u90e8\u4ef6','\u6c7d\u8f66\u6574\u8f66'], keywords: ['\u6c7d\u8f66\u5236\u9020','\u6c7d\u8f66\u96f6\u90e8\u4ef6','\u6c7d\u8f66','\u65b0\u80fd\u6e90\u6c7d\u8f66'], peMax: 50, peLow: 10 },
  electrical_machinery: { names: ['\u7535\u6c14\u8bbe\u5907','\u673a\u68b0','\u4e13\u7528\u8bbe\u5907'], keywords: ['\u7535\u6c14\u8bbe\u5907','\u673a\u68b0','\u91cd\u5de5','\u7535\u529b\u8bbe\u5907','\u4e13\u7528\u8bbe\u5907'], peMax: 35, peLow: 16 },
  finance_utility: { names: ['\u94f6\u884c','\u4fdd\u9669','\u8bc1\u5238','\u623f\u5730\u4ea7','\u516c\u7528\u4e8b\u4e1a','\u5238\u5546\u4fe1\u6258','\u7535\u529b\u884c\u4e1a','\u6e2f\u53e3\u6c34\u8fd0'], keywords: ['\u94f6\u884c','\u4fdd\u9669','\u8bc1\u5238','\u5730\u4ea7','\u623f\u5730\u4ea7','\u516c\u7528','\u7535\u529b','\u6c34\u52a1','\u9ad8\u901f','\u6e2f\u53e3','\u5238\u5546'], peMax: 20, peLow: 8 },
  consumer: { names: ['\u98df\u54c1\u996e\u6599','\u6d88\u8d39','\u65c5\u6e38','\u514d\u7a0e','\u96f6\u552e','\u767d\u9152','\u5bb6\u7535','\u6d88\u8d39\u7535\u5b50'], keywords: ['\u6d88\u8d39','\u98df\u54c1','\u996e\u6599','\u9152','\u65c5\u6e38','\u514d\u7a0e','\u96f6\u552e','\u5bb6\u7535'], peMax: 45, peLow: 14 },
  cyclical: { names: ['\u5316\u5de5','\u6709\u8272\u91d1\u5c5e','\u94a2\u94c1','\u5efa\u6750','\u7164\u70ad','\u77f3\u6cb9','\u5316\u5de5\u884c\u4e1a','\u5316\u5b66\u539f\u6599'], keywords: ['\u5316\u5de5','\u6709\u8272','\u94a2\u94c1','\u5efa\u6750','\u7164\u70ad','\u77f3\u6cb9','\u6c34\u6ce5','\u73bb\u7483','\u77ff\u4e1a','\u5316\u5b66'], peMax: 30, peLow: 12 },
}

// 排除列表
const LIQUOR_NAMES = ['\u8d35\u5dde\u8305\u53f0','\u4e94\u7cae\u6db2','\u6d0b\u6cb3\u80a1\u4efd','\u6cf8\u5dde\u8001\u7a96','\u5c71\u897f\u6c7e\u9152','\u9152\u9b3c\u9152','\u6c34\u4e95\u574a','\u53e4\u4e95\u8d21\u9152','\u8fce\u9a7e\u8d21\u9152','\u4eca\u4e16\u7f18','\u820d\u5f97\u9152\u4e1a','\u8001\u767d\u5e72\u9152','\u4f0a\u529b\u7279','\u53e3\u5b50\u7a91','\u91d1\u5fbd\u9152','\u7687\u53f0\u9152\u4e1a','\u5ca9\u77f3\u80a1\u4efd','\u987a\u946b\u519c\u4e1a']
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
