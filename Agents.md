# 价值投资之王 · 微信小程序云开发版 — 项目开发规范

> 本文档是「价值投资之王」从 PC 端 Flask Web 应用迁移到微信小程序云开发的完整技术规范。
> 本期仅包含 3 个核心选股功能：**早盘集合竞价**、**尾盘强势股**、**短线强势股**。

---


## 🤝 对话约定

> **语言规则**：Codex 必须使用中文进行所有对话回复，包括问题描述、方案说明、代码注释和错误分析。
> 仅以下情况可使用英文：代码变量名、API 名称、技术专有名词（如 RSI、MACD、ROE、PE、PB）、
> npm 包名、命令行指令、JSON 配置键名、URL 路径等无法或不适合用中文表达的内容。

---
## 一、项目概述

### 1.1 功能范围

| 功能 | 云函数 | 原版模块 | 说明 |
|---|---|---|---|
| **早盘集合竞价** | `auctionPicker` | `modules/auction_picker.py` | 两阶段竞价：预筛选(趋势/量能/位置) + 确认(跳空/量比/竞价额/大盘) |
| **尾盘强势股** | `wp2Picker` | `modules/wp2_picker.py` | 涨幅/量比/换手率/成交额/市值综合评分 |
| **短线强势股** | `strongPicker` | `modules/strong_stock_picker.py` | 涨幅/换手率/量比/振幅/成交额评分 + 技术面60% + 基本面40% |

### 1.2 依赖的基础云函数

| 云函数 | 职责 | 原版对应 |
|---|---|---|
| `login` | 微信登录获取 openid | — |
| `marketEnv` | 沪深300趋势/波动率/多空判定 | `modules/market_env.py` |
| `dataFetcher` | 行情/财务/K线数据获取与缓存 | `modules/data_fetcher.py` + `modules/kline_fetcher.py` |
| `scoring` | 五因子评分引擎 | `modules/scoring.py` |
| `techIndicator` | MA/MACD/RSI/KDJ/BOLL计算 | `modules/technical.py` |
| `sectorRotation` | 板块轮动数据与加分 | `modules/sector_rotation.py` |
| `scheduledPicker` | 定时触发选股 | `modules/scheduler.py` |
| `setupDB` | 初始化数据库集合 | — |

### 1.3 项目目录

```
D:\wx_jztz/
├── Agents.md                        # 本文件
├── project.config.json              # 微信开发者工具配置
├── package.json
│
├── cloudfunctions/                  # 云函数（后端）
│   ├── login/                       # 登录
│   ├── marketEnv/                   # 市场环境
│   ├── dataFetcher/                 # 数据获取
│   │   ├── http.js                  # HTTP请求工具
│   │   ├── index.js                 # 云函数入口
│   │   └── package.json
│   ├── scoring/                     # 评分引擎 (与strongPicker/wp2Picker/auctionPicker共享)
│   │   ├── config.js                # 评分常量
│   │   ├── evaluate.js              # 核心评分逻辑
│   │   ├── index.js                 # 云函数入口
│   │   └── package.json
│   ├── techIndicator/               # 技术指标
│   ├── sectorRotation/              # 板块轮动
│   ├── auctionPicker/               # 早盘集合竞价
│   │   ├── index.js                 # 入口 + 两阶段评分
│   │   ├── http.js                  # 共享HTTP
│   │   ├── evaluate.js              # 共享评分别名
│   │   ├── config.js                # 共享配置别名
│   │   └── package.json
│   ├── wp2Picker/                   # 尾盘强势股
│   │   ├── index.js                 # 入口 + 评分
│   │   ├── http.js                  # 共享HTTP
│   │   ├── evaluate.js              # 共享评分别名
│   │   ├── config.js                # 共享配置别名
│   │   └── package.json
│   ├── strongPicker/                # 短线强势股
│   │   ├── index.js                 # 入口 + 评分
│   │   ├── http.js                  # 共享HTTP
│   │   ├── evaluate.js              # 共享评分别名
│   │   ├── config.js                # 共享配置别名
│   │   └── package.json
│   ├── scheduledPicker/             # 定时选股
│   └── setupDB/                     # 数据库初始化
│
├── miniprogram/                     # 小程序前端
│   ├── app.js                       # 入口
│   ├── app.json                     # 全局配置
│   ├── app.wxss                     # 全局样式
│   ├── config.js                    # 云环境配置
│   ├── images/                      # 图标资源
│   ├── utils/                       # 工具
│   │   ├── api.js                   # 云函数调用封装（含超时/重试/loading）
│   │   ├── format.js                # 格式化
│   │   └── constants.js             # 常量
│   ├── components/                  # 公共组件
│   │   ├── stock-card/              # 股票卡片
│   │   ├── score-badge/             # 分数徽章
│   │   ├── loading/                 # 加载动画
│   │   └── empty/                   # 空状态
│   └── pages/                       # 页面
│       ├── index/                   # 首页（大盘+三入口）
│       ├── auction/                 # 早盘集合竞价
│       ├── wp2/                     # 尾盘强势股
│       ├── strong/                  # 短线强势股
│       └── mine/                    # 我的
```

---

## 二、关键架构设计

### 2.1 云函数调用策略（重要！）

**禁止云函数嵌套调用（cloud.callFunction）**，原因：
- 云函数单次执行时间上限 **20秒**（配置可到60秒）
- 嵌套调用 A→B→C 会累加超时风险
- 外部API（东方财富/腾讯/新浪）本身有延迟

**正确做法：直接 require 本地模块**

```javascript
// ❌ 错误：通过 cloud.callFunction 嵌套调用 scoring
const res = await cloud.callFunction({ name: 'scoring', data: { action: 'evaluate' } })

// ✅ 正确：直接 require 本地模块
const { evaluateStock } = require('../scoring/evaluate')
```

### 2.2 多源数据获取策略

每个选股云函数使用**双数据源**，主源失败自动切换到备用源：

| 策略 | 主源 | 备用源 |
|---|---|---|
| **短线强势股** | 东方财富换手率榜 + 涨幅榜合并 | 东方财富涨幅榜 + 腾讯行情 |
| **尾盘强势股** | 东方财富涨幅榜 + 量比榜合并 | 腾讯行情 (降级) |
| **早盘竞价** | 新浪竞价 API (3页) | 东方财富涨幅榜 |

### 2.3 超时保护机制

每个云函数调用都包含三层保护：
1. **withTimeout**: 每个外部API调用有独立超时
2. **retryRequest**: 网络失败时自动重试2次
3. **fallback默认值**: 超时/失败时返回空数据而非崩溃

### 2.4 数据库集合关系

| 集合 | 用途 | 索引 | TTL |
|---|---|---|---|
| `users` | 用户信息 | `_openid` | 永久 |
| `pick_cache` | 选股结果缓存 | `type(升序)+date(升序)`, `openid_1` | 1天 |
| `stock_cache` | 行情数据缓存 | `_key`, `cachedAt(升序)` | 60秒 |
| `financial_cache` | 财务数据缓存 | `_key`, `cachedAt(升序)` | 3600秒 |

---

## 三、云函数详解

### 3.1 短线强势股 (`strongPicker`)

**数据源获取流程**：
```
东方财富换手率榜 (f8, top100)
  → 东方财富涨幅榜 (f3, top100) 
  → 合并去重
  → 东方财富失败? → 涨幅榜备用 + 腾讯行情补全
```

**评分逻辑** (`calcStrongScore`, 总分100):
1. 涨幅得分 (0-25): 2-4%最优，区分创业板
2. 量比得分 (0-20): 1.5-3倍最优
3. 换手率得分 (0-15): 1-8%最优
4. 振幅得分 (0-15): 3-8%最优
5. 成交额得分 (0-10): 越大越好
6. 市值得分 (0-10): 30-100亿最优
7. PE得分 (0-5): 0-20最优

**最终评分 = 技术面(60%) × 基本面(40%)**，通过 `evaluate.js` 的 `evaluateStock` 计算基本面分。

### 3.2 尾盘强势股 (`wp2Picker`)

**数据源获取流程**：
```
东方财富涨幅榜 (f3, top80)
  → 东方财富量比榜 (f10, top80)
  → 合并去重
  → 失败? → 腾讯行情备用
```

**评分逻辑** (`wp2Score`, 总分100):
1. 涨幅得分 (0-25): 2-4%最优
2. 换手率得分 (0-15): 2-8%最优
3. 成交额得分 (0-15): ≥5亿满分
4. 量比得分 (0-10): 1.5-3倍最优
5. 市值得分 (0-10): 30-100亿最优
6. 振幅得分 (0-10): 3-8%最优
7. PE得分 (0-5): 0-30最优
8. ROE得分 (0-10): ≥15满分

### 3.3 早盘集合竞价 (`auctionPicker`)

**数据源获取流程**：
```
新浪竞价API (3页, 涨幅排序)
  → 股票数据解析(gap_pct/volumeRatio/amount)
  → 失败? → 东方财富涨幅榜备用
```

**两阶段评分**：
- **Phase 1 (预筛选 40%)**: 趋势(30) + 量能(30) + 位置(20) + 换手(20)
- **Phase 2 (确认 60%)**: 跳空(25) + 量比(25) + 成交额(25) + 大盘(25)

**最终评分 = Phase1 × 0.4 + Phase2 × 0.6**
推荐级别: ≥80 强烈推荐, ≥65 推荐, ≥50 观望, <50 谨慎

### 3.4 技术指标 (`techIndicator`)

支持指标:
- MA5/MA10/MA20/MA60
- MACD (DIF/DEA/柱状图 + 金叉死叉检测)
- RSI6/RSI14
- KDJ
- BOLL (上中下轨 + 持仓位置百分比)
- 5日/20日动量

### 3.5 评分引擎 (`scoring/evaluate.js`)

五因子评分:
- 价值(36%): PE分 + PB分 + ROE分
- 质量(11%): 毛利率 + 净利率 + 负债率
- 成长(8%): 营收增长 + 利润增长
- 动量(12%): 5日涨幅 + 20日动量
- 情绪(33%): 换手率 + 量比 + 成交额

行业PE动态阈值: 半导体/医药/新能源/电子/软件等10+行业

---

## 四、云函数配置

### 4.1 超时与内存

所有云函数统一配置:
```json
{"timeout": 60, "memorySize": 512}
```

### 4.2 HTTP请求工具 (`http.js`)

- 支持 `http` 和 `https` 双协议
- 统一超时参数
- 支持自定义headers
- 支持编码设置 (gbk/sina)

### 4.3 数据源列表

| 数据源 | URL | 用途 |
|---|---|---|
| 新浪行情 | `https://hq.sinajs.cn/list=` | 沪深300大盘 |
| 腾讯行情 | `https://qt.gtimg.cn/q=` | 个股行情(备用) |
| 东方财富 | `https://push2.eastmoney.com/api/qt/clist/get` | 涨幅榜/换手率榜/量比榜 |
| 新浪竞价 | `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData` | 竞价候选 |
| 腾讯K线 | `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get` | K线数据 |
| 东方财富财务 | `https://datacenter-web.eastmoney.com/api/data/v1/get` | 财务数据 |

---

## 五、前端说明

### 5.1 页面路由

| 页面 | 路径 | TabBar | 说明 |
|---|---|---|---|
| 首页 | `pages/index/index` | ✅ | 大盘环境 + 功能入口 |
| 竞价 | `pages/auction/auction` | ✅ | 早盘集合竞价结果 |
| 尾盘 | `pages/wp2/wp2` | ✅ | 尾盘强势股结果 |
| 强势 | `pages/strong/strong` | ✅ | 短线强势股结果 |
| 我的 | `pages/mine/mine` | ✅ | 版本信息 + 数据库初始化 |

### 5.2 数据流

```
用户点击刷新 → api.callFunctionWithLoading()
  → 云函数 run 动作
    → 获取外部数据 (东方财富/腾讯/新浪)
    → 本地评分计算
    → 写入 pick_cache 缓存
    → 返回结果
  → 前端渲染
```

### 5.3 缓存策略

- 首次加载优先显示缓存 (list动作)
- 手动刷新执行完整选股 (run动作)
- 缓存按天 + 类型存储 (type + date索引)
- 前端4秒超时自动降级显示缓存

---

## 六、部署步骤

### 6.1 环境准备

1. 微信开发者工具打开 `D:\wx_jztz` 项目
2. 确保 appid 已配置 (当前: `YOUR_APPID`)
3. 云开发环境ID: `cloud1-d4gpg78un14373e96` (在 `miniprogram/config.js` 配置)

### 6.2 数据库初始化

方式一：自动初始化（建议）
- 打开小程序 → 我的 → 点击「初始化数据库」
- 或在开发者工具控制台执行:
```javascript
wx.cloud.callFunction({ name: 'setupDB', data: {} })
```

方式二：手动创建
1. 云开发控制台 → 数据库 → 新建集合
2. 创建: `users`, `pick_cache`, `stock_cache`, `financial_cache`
3. 为 `pick_cache` 创建索引: `type(升序) + date(升序)`
4. 为 `stock_cache` 创建索引: `cachedAt(升序)`

### 6.3 上传云函数

在微信开发者工具中:
1. 右键 `cloudfunctions` 目录
2. 选择「创建并部署：所有文件」
3. 等待部署完成（每个云函数约10-30秒）

### 6.4 常见问题

| 问题 | 原因 | 解决 |
|---|---|---|
| 云函数超时 `-504003` | 云函数配置 timeout 过小 | 改为60秒 |
| 外部API无数据 | 非交易时间/API限制 | 检查备用源 |
| 数据库操作失败 | 集合未创建 | 执行初始化 |
| 选股结果为空 | 筛选条件严格/数据源超时 | 手动刷新重试 |

---

## 七、注意事项

### 7.1 交易时间

- 早盘竞价数据: 9:15-9:30 最准确
- 尾盘选股: 14:30-15:00 最佳
- 非交易时间数据源可能返回空数据

### 7.2 API限制

- 东方财富API: 无明确限制，但频繁请求可能被限
- 新浪API: 稳定但速度较慢
- 腾讯API: 支持批量查询，每次最多80只

### 7.3 微信云开发限制

- 云函数最长执行时间: 60秒 (需配置)
- 云函数最大内存: 512MB
- 免费额度: 每月100万次调用 / 10万GBs
- 数据库: 每个集合最多200万条记录
