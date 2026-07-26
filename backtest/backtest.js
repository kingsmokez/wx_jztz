/**
 * 回测主程序 - 对近2年数据回测V73(基准)和V74(优化)策略
 * 运行: node backtest.js
 */
var common = require('./common')
var strategy = require('./strategy')
var tech = require('./tech')

var STRATEGIES = {
  V73: { name: 'V73基准', func: strategy.strategyV73, config: common.CONFIG.strategy },
  V74: { name: 'V74优化', func: strategy.strategyV74, config: { rankingScoreMin: 60, blendedScoreMin: 0 } }
}

function quickScore(stock) {
  var score = 0
  var chg = stock.changePct || 0
  var vr = stock.volumeRatio || 0
  var to = stock.turnover || 0
  if (chg >= 2 && chg <= 6) score += 30; else if (chg >= 1 && chg < 2) score += 20; else if (chg >= 0 && chg < 1) score += 10
  if (vr >= 1.5 && vr <= 3) score += 25; else if (vr >= 1 && vr < 1.5) score += 15; else if (vr > 3) score += 15
  if (to >= 1 && to <= 8) score += 20; else if (to >= 0.5 && to < 1) score += 10
  if (stock.pe > 0 && stock.pe <= 30) score += 10; else if (stock.pe > 30 && stock.pe <= 50) score += 5
  if ((stock.circCap || 0) >= 20 && (stock.circCap || 0) <= 200) score += 15
  return score
}

function calcReturn(buyPrice, klines, holdDays) {
  if (!klines || klines.length === 0) return 0
  var results = {}
  for (var h = 0; h < holdDays.length; h++) {
    var d = holdDays[h]
    if (klines.length > d) {
      var sellPrice = klines[d].close
      results[d] = (sellPrice - buyPrice) / buyPrice * 100
    } else {
      results[d] = (klines[klines.length - 1].close - buyPrice) / buyPrice * 100
    }
  }
  return results
}

function calcTrailingReturn(buyPrice, futureKlines) {
  if (!futureKlines || futureKlines.length === 0) return 0
  var maxProfit = 0
  var maxDrawdown = 0
  var currentPrice = buyPrice
  var exitPrice = buyPrice
  var exited = false
  for (var i = 0; i < futureKlines.length && i < 21; i++) {
    var k = futureKlines[i]
    if (k.high > currentPrice) currentPrice = k.high
    var profit = (currentPrice - buyPrice) / buyPrice * 100
    if (profit > maxProfit) maxProfit = profit
    var drawdown = (currentPrice - k.low) / currentPrice * 100
    if (drawdown > maxDrawdown) maxDrawdown = drawdown
    // 阶梯止盈
    if (maxProfit >= 8 && drawdown >= 3) { exitPrice = k.low; exited = true; break }
    if (maxProfit >= 5 && drawdown >= 2) { exitPrice = k.low; exited = true; break }
    if (maxProfit >= 3 && drawdown >= 1) { exitPrice = k.low; exited = true; break }
  }
  if (!exited) exitPrice = futureKlines[Math.min(futureKlines.length - 1, 20)].close
  return (exitPrice - buyPrice) / buyPrice * 100
}

async function runBacktest() {
  console.log('=== 短线强势股回测框架 V1.0 ===')
  console.log('回测区间: ' + common.CONFIG.startDate + ' ~ ' + common.CONFIG.endDate)
  console.log('每月采样: ' + common.CONFIG.sampleDaysPerMonth + ' 个交易日')
  console.log('持有周期: ' + common.CONFIG.holdDays.join(',') + ' 天')
  console.log('')

  var tradeDays = await common.getTradeDays(common.CONFIG.startDate, common.CONFIG.endDate)
  if (tradeDays.length === 0) { console.error('无法获取交易日列表'); return }

  // 每月采样
  var sampledDays = []
  var currentMonth = ''
  var monthCount = 0
  for (var i = 0; i < tradeDays.length; i++) {
    var month = tradeDays[i].slice(0, 7)
    if (month !== currentMonth) {
      currentMonth = month
      monthCount = 0
    }
    if (monthCount < common.CONFIG.sampleDaysPerMonth) {
      sampledDays.push(tradeDays[i])
      monthCount++
    }
  }
  console.log('采样交易日: ' + sampledDays.length + ' 天')
  console.log('')

  var allResults = {}
  for (var key in STRATEGIES) allResults[key] = { trades: [], totalPicks: 0, winCount: 0, totalReturn: 0, trailingReturns: [] }

  for (var di = 0; di < sampledDays.length; di++) {
    var day = sampledDays[di]
    console.log('[' + (di + 1) + '/' + sampledDays.length + '] 回测 ' + day + '...')

    // 获取涨幅榜+换手率榜(当前实时数据,非历史)
    var changeStocks = await common.fetchDayStocks('f3', 300)
    var turnoverStocks = await common.fetchDayStocks('f8', 300)
    await common.sleep(common.CONFIG.requestDelay)

    // 合并去重
    var allStocks = {}
    var codes1 = Object.keys(changeStocks)
    var codes2 = Object.keys(turnoverStocks)
    for (var i = 0; i < codes1.length; i++) allStocks[codes1[i]] = changeStocks[codes1[i]]
    for (var i = 0; i < codes2.length; i++) {
      if (!allStocks[codes2[i]]) allStocks[codes2[i]] = turnoverStocks[codes2[i]]
      else {
        var ts = turnoverStocks[codes2[i]]
        if (ts.turnover > 0 && (!allStocks[codes2[i]].turnover || allStocks[codes2[i]].turnover === 0)) allStocks[codes2[i]].turnover = ts.turnover
        if (ts.volumeRatio > 0 && (!allStocks[codes2[i]].volumeRatio || allStocks[codes2[i]].volumeRatio === 0)) allStocks[codes2[i]].volumeRatio = ts.volumeRatio
      }
    }
    var codes = Object.keys(allStocks)

    // 粗筛
    var candidates = []
    for (var i = 0; i < codes.length; i++) {
      var stock = allStocks[codes[i]]
      if (!stock || !stock.name || stock.name.indexOf('ST') >= 0 || stock.name.indexOf('退') >= 0) continue
      if (stock.price <= 3 || stock.changePct <= 0) continue
      if (stock.turnover < 0.5 && stock.volumeRatio < 0.8) continue
      if (stock.circCap > 0 && stock.circCap < 20) continue
      if (stock.code.startsWith('8') || stock.code.startsWith('4') || stock.code.startsWith('920')) continue
      var qs = quickScore(stock)
      if (qs >= 25) candidates.push({ stock: stock, quickScore: qs })
    }
    candidates.sort(function(a, b) { return b.quickScore - a.quickScore })
    candidates = candidates.slice(0, 60)

    if (candidates.length === 0) { console.log('  无候选股票'); continue }

    // 对每个策略分别筛选
    for (var skey in STRATEGIES) {
      var strat = STRATEGIES[skey]
      var picked = []
      for (var ci = 0; ci < candidates.length; ci++) {
        var stock = candidates[ci].stock
        // 获取K线(含未来数据用于计算收益)
        var klines = await common.fetchKlineForBacktest(stock.code, 80)
        if (!klines || klines.length < 30) continue
        await common.sleep(common.CONFIG.requestDelay)

        // 找到当日K线索引
        var dayIdx = -1
        for (var ki = 0; ki < klines.length; ki++) {
          if (klines[ki].date === day) { dayIdx = ki; break }
        }
        if (dayIdx < 0 || dayIdx < 30) continue

        // 用当日之前的数据做策略判断
        var histKlines = klines.slice(0, dayIdx + 1)
        var result = strat.func(stock, histKlines, strat.config)
        if (!result.pass) continue

        // 计算后续收益
        var buyPrice = klines[dayIdx].close
        var futureKlines = klines.slice(dayIdx + 1)
        var returns = calcReturn(buyPrice, futureKlines, common.CONFIG.holdDays)
        var trailingReturn = calcTrailingReturn(buyPrice, futureKlines)

        picked.push({
          day: day, code: stock.code, name: stock.name,
          buyPrice: buyPrice, score: result.score,
          returns: returns, trailingReturn: trailingReturn,
          changePct: stock.changePct, volumeRatio: result.volumeRatio,
          rsi: result.tech ? result.tech.rsi : 0,
        })

        if (picked.length >= 5) break // 每天最多选5只
      }

      // 记录结果
      var sr = allResults[skey]
      for (var pi = 0; pi < picked.length; pi++) {
        sr.trades.push(picked[pi])
        sr.totalPicks++
        // 用5天持有期计算胜率
        var ret5d = picked[pi].returns[5] || 0
        if (ret5d > 0) sr.winCount++
        sr.totalReturn += ret5d
        sr.trailingReturns.push(picked[pi].trailingReturn)
      }
      console.log('  ' + strat.name + ': 选出 ' + picked.length + ' 只')
    }
  }

  // 输出结果
  console.log('')
  console.log('=== 回测结果 ===')
  console.log('')
  for (var skey in allResults) {
    var sr = allResults[skey]
    var wr = sr.totalPicks > 0 ? (sr.winCount / sr.totalPicks * 100).toFixed(2) : 0
    var ar = sr.totalPicks > 0 ? (sr.totalReturn / sr.totalPicks).toFixed(2) : 0
    var avgTrailing = sr.trailingReturns.length > 0 ? (sr.trailingReturns.reduce(function(a, b) { return a + b }, 0) / sr.trailingReturns.length).toFixed(2) : 0
    console.log(STRATEGIES[skey].name + ':')
    console.log('  选股次数: ' + sr.totalPicks)
    console.log('  5日胜率: ' + wr + '%')
    console.log('  5日平均收益: ' + ar + '%')
    console.log('  阶梯止盈平均收益: ' + avgTrailing + '%')

    // 各持有期收益
    if (sr.trades.length > 0) {
      for (var h = 0; h < common.CONFIG.holdDays.length; h++) {
        var d = common.CONFIG.holdDays[h]
        var sum = 0, cnt = 0, wins = 0
        for (var ti = 0; ti < sr.trades.length; ti++) {
          if (sr.trades[ti].returns[d] !== undefined) {
            sum += sr.trades[ti].returns[d]
            cnt++
            if (sr.trades[ti].returns[d] > 0) wins++
          }
        }
        if (cnt > 0) {
          console.log('  ' + d + '日: 胜率=' + (wins / cnt * 100).toFixed(2) + '% 平均收益=' + (sum / cnt).toFixed(2) + '% n=' + cnt)
        }
      }
    }
    console.log('')
  }

  // 保存详细结果到文件
  var report = { date: new Date().toISOString(), summary: {}, trades: {} }
  for (var skey in allResults) {
    var sr = allResults[skey]
    report.summary[skey] = {
      totalPicks: sr.totalPicks,
      winRate5d: sr.totalPicks > 0 ? sr.winCount / sr.totalPicks * 100 : 0,
      avgReturn5d: sr.totalPicks > 0 ? sr.totalReturn / sr.totalPicks : 0,
      avgTrailingReturn: sr.trailingReturns.length > 0 ? sr.trailingReturns.reduce(function(a, b) { return a + b }, 0) / sr.trailingReturns.length : 0,
    }
    report.trades[skey] = sr.trades.slice(0, 20) // 只保存前20条
  }
  var fs = require('fs')
  fs.writeFileSync('backtest_report.json', JSON.stringify(report, null, 2), 'utf-8')
  console.log('详细报告已保存到 backtest_report.json')
}

runBacktest().catch(function(e) { console.error('回测失败:', e); process.exit(1) })
