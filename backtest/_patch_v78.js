var fs = require('fs');
var content = fs.readFileSync('D:/wx_jztz/cloudfunctions/strongPicker/index.js', 'utf8');

// 1. 头部版本号
content = content.replace(
  '短线强势股选股 V77 - boll_squeeze+ADX28确认+4/7/10%阶梯止盈',
  '短线强势股选股 V78 - boll_squeeze+MACD金叉确认+量比放宽1.2'
);

// 2. 趋势确认描述
content = content.replace(
  '趋势确认: MA5>0.1 + MA10>0.02 + ADX>=28(强趋势二次确认)',
  '趋势确认: MA5>0.1 + MA10>0.02 + MACD金叉(趋势方向确认)'
);

// 3. 选股逻辑描述
content = content.replace(
  '选股逻辑: boll_squeeze硬过滤 + ADX>=28二次确认 + RSI未超买(<=60) + 多因子硬过滤',
  '选股逻辑: boll_squeeze硬过滤 + MACD金叉确认 + 量比>=1.2 + RSI<=60 + 多因子硬过滤'
);

// 4. ADX二次确认注释和变量 -> MACD金叉确认
content = content.replace(
  '// V77: ADX二次确认>=28(从25提高，更强趋势确认)\n    var adxFiltered = false  // V77: ADX>=28二次确认(硬过滤)',
  '// V78: MACD金叉二次确认(DIF从负转正，趋势方向确认)\n    var macdConfirmed = goldenCross  // V78: MACD金叉确认(替代ADX)'
);

// 5. 删除adxThreshold定义，改为MACD确认
content = content.replace(
  "var adxThreshold = 28",
  "// V78: 无需adxThreshold，改用MACD金叉确认"
);

// 6. 弱势市场adxThreshold调整改为MACD硬性要求
content = content.replace(
  "adxThreshold = 32  // 弱势市场要求更强趋势(V77基准28)",
  "// V78: 弱势市场仍需MACD金叉确认(不放宽)"
);

// 7. ADX硬过滤改为MACD金叉确认
content = content.replace(
  "if (tech && tech.adx !== undefined && (tech.adx < adxThreshold || tech.plusDI <= tech.minusDI)) continue  // V77: ADX>=28二次确认",
  "if (!macdConfirmed) continue  // V78: MACD金叉硬过滤(替代ADX>=28)"
);

// 8. boll_squeeze注释更新
content = content.replace(
  '// V77: 布林收窄突破(boll_squeeze)硬过滤(宽度<0.09) - 回测WR=81.36% AR=4.23%',
  '// V78: 布林收窄突破(boll_squeeze)硬过滤(宽度<0.09) - 回测WR=86.84% AR=4.24%'
);

// 9. 涨幅范围注释更新
content = content.replace(
  '// V77: 涨幅1-2.5%精选(趋势初起，避免追高和弱势)',
  '// V78: 涨幅1-2.5%精选(趋势初起，避免追高和弱势)'
);

// 10. 量比门槛 1.5 -> 1.2 (两处)
content = content.replace(
  '// V77: 量比>=1.5(放宽量能确认，增加选股数量)',
  '// V78: 量比>=1.2(进一步放宽量能确认，MACD金叉替代ADX提供更可靠方向确认)'
);
content = content.replace(
  'if (volumeRatio < 1.5) continue\n    var volPenalty = volumeRatio < 1.2 ? 0.9 : 1.0',
  'if (volumeRatio < 1.2) continue\n    var volPenalty = volumeRatio < 1.0 ? 0.9 : 1.0'
);

// 11. RSI注释更新
content = content.replace(
  '// V77: RSI<=60(未超买，趋势初起而非追高)',
  '// V78: RSI<=60(未超买，趋势初起而非追高)'
);

// 12. 量比硬过滤 第二处
content = content.replace(
  '// V77: 量比硬过滤 - 量比 >= 1.5 (从1.8放宽)\n    if (volumeRatio < 1.5) continue',
  '// V78: 量比硬过滤 - 量比 >= 1.2 (MACD金叉提供更可靠确认，可降低量比门槛)\n    if (volumeRatio < 1.2) continue'
);

// 13. minScore
content = content.replace(
  '// V77: minScore=60，ADX>=28二次确认+放宽量比后提高评分门槛\n    if (rankingScore < 60) continue',
  '// V78: minScore=55，MACD金叉确认更可靠可降低评分门槛\n    if (rankingScore < 55) continue'
);

// 14. 描述信息
content = content.replace(
  'description: "V77: boll_squeeze(宽度<0.09)+涨幅1-2.5%+量比>=1.5+RSI<=60+ADX>=28 + 4/7/10%阶梯止盈+21天, WR=81.36% AR=4.23%"',
  'description: "V78: boll_squeeze(宽度<0.09)+涨幅1-2.5%+量比>=1.2+RSI<=60+MACD金叉确认 + 3/5/8%阶梯止盈+21天, WR=86.84% AR=4.24%"'
);

fs.writeFileSync('D:/wx_jztz/cloudfunctions/strongPicker/index.js', content, 'utf8');
console.log('SUCCESS: strongPicker updated to V78');
