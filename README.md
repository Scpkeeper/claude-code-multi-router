# Claude Code 多模型路由

让 Claude Code 按**工程职责**自动切换模型：聊架构走 Opus，修 bug 走 Sonnet，写后端走 Kimi，做前端和埋点走 DeepSeek。
你照常说话，路由在后台按关键词分发，一次配置之后不用再管。

上游统一走 [OpenRouter](https://openrouter.ai)，本地跑 [`claude-code-router`](https://www.npmjs.com/package/@musistudio/claude-code-router) 做分发网关。

```
Claude Code
    │
    ▼
claude-code-router (127.0.0.1:3456)
    │   custom-router.js —— 按 6 类职责匹配关键词
    ▼
OpenRouter
    ├── anthropic/claude-opus-5.5        核心调度
    ├── anthropic/claude-sonnet-5.5      修 bug
    ├── moonshotai/kimi-k3               后端功能 / 封装上架
    └── deepseek/deepseek-v4-flash       基础前端 / 写日志 / 兜底
```

## 快速开始

```bash
# 1. 装依赖与配置（会锁 ccr@2.0.0、写 config.json、跑一遍自测）
node scripts/install.js        # Windows 双击 scripts/install.cmd

# 2. 设密钥（永久生效，只需一次；重开终端生效）
setx OPENROUTER_API_KEY sk-or-xxxxxxxx        # Windows
# echo 'export OPENROUTER_API_KEY=sk-or-xxxxxxxx' >> ~/.zshrc && source ~/.zshrc   # macOS/Linux

# 3. 启动
ccr start      # 起路由器
ccr code       # 在路由环境下启动 Claude Code
```

`ccr code` 会自动把 `ANTHROPIC_BASE_URL` 指向 `127.0.0.1:3456`，**不需要**手改 `~/.claude/settings.json`，
也就不存在和 CC Switch 抢配置文件的问题。

## 模型分工

| 优先级 | 触发关键词 | 模型 | 职责 |
|---|---|---|---|
| 1 | 架构 / 方案 / 思路 / 调度 / 整体设计 / 技术选型 / 规划 / 拆解 / 总纲 | Opus 5.5 | 核心调度 |
| 2 | bug / 报错 / 修复 / 崩溃 / 异常 / debug / 排错 / 回归 / 复现 | Sonnet 5.5 | 修 bug |
| 3 | 打包 / 封装 / 发布 / 签名 / 构建 / 上架 / 应用商店 / App Store / 审核 / 证书 / build | Kimi K3 | 封装上架 |
| 4 | 后端 / 接口 / api / 数据库 / 服务端 / 业务逻辑 / 鉴权 / 联调 | Kimi K3 | 后端功能 |
| 5 | 日志 / log / 埋点 / 监控 / 打点 / 追踪 | DeepSeek V4 Flash | 写日志 |
| 6 | 前端 / 页面 / 组件 / 脚手架 / 路由 / 界面搭建 | DeepSeek V4 Flash | 基础前端 |
| — | 都不命中 | DeepSeek V4 Flash | 兜底 |

从上往下**命中即返回**，不串联。说「用 opus 做某某」「切成 sonnet」这类显式指定会压过关键词。

## ⚠️ 必须锁 2.0.0，别升 3.x

这是整套方案里唯一一个硬约束。3.x 会把模型 ID 中 `/` 前面的那截当成**它自己的供应商标识**去解析，
而 `anthropic` / `openai` / `google` 是它的一等公民：

| 模型 | 3.x 实测 | 2.0.0 |
|---|---|---|
| `anthropic/claude-opus-5.5` | `conflicts with target provider`，前缀被剥掉 | ✅ |
| `anthropic/claude-sonnet-5.5` | 同上 | ✅ |
| `moonshotai/kimi-k3` | 正常（前缀它不认识，当字面量放过） | ✅ |
| `deepseek/deepseek-v4-flash` | 正常 | ✅ |

也就是 **3.x 上 Opus 和 Sonnet 根本调不通**，恰好是分工里的「核心调度」和「修 bug」。

3.x 另外还有两个坑：配置改存 SQLite（`config.json` 只在库不存在时导入一次，导完当场删除），
且会静默丢弃 `Router.default / background / think / longContext`；它还会改写 `~/.claude/settings.json` 做 profile 接管。

`install.js` 会自动把版本钉在 2.0.0。**别随手 `npm update`** —— 要升先看这个坑还在不在。

## 改路由规则

编辑 `config/custom-router.js` 里的 `RULES` 数组，然后：

```bash
npm test
```

18 条用例全绿才算改对了（含优先级交叉、system 噪声隔离、显式指定压过关键词）。
路由脚本每次请求都会重新加载，**改完不用重启**。

几个实现细节值得知道：

- **只扫 `role==="user"` 的消息。** Claude Code 的 system prompt 里塞满了 `api` / `build` / `日志`，
  全量扫会大量误判 —— 自测里的 `o)` 用例就是专门守这条的。
- **显式指定必须搭配动词**（用 / 切成 / 换成 / 指定…），否则闲聊里提到 "opus" 也会误触发。
- **路由函数必须返回 `"供应商,模型"` 格式的字符串**，返回对象等于没命中。

## 密钥安全

- `config.json` 里写的是 `"api_key": "$OPENROUTER_API_KEY"` —— 2.x 读配置时会做环境变量展开，
  key 只存在系统环境变量里，**不进任何文件**。
- 本仓库不含任何密钥：`.gitignore` 排除了 `config.json` / `.env` / `*.key`，
  仓库里只有 `config/config.example.json` 占位模板。
- 不想用环境变量的话，也可以把 key 单行写进 `~/.claude-code-router/.key`（同样被 gitignore 排除）。

## 验证记录

真实 OpenRouter 调用（2026-10-11），响应里的 `model` 字段即上游实际使用的模型：

| 输入 | 实际使用 |
|---|---|
| 帮我规划一下整个 APP 的架构和技术选型 | `anthropic/claude-opus-5.5` |
| 这个登录报错崩溃了帮我修 | `anthropic/claude-sonnet-5.5` |
| 写一下后端接口和数据库逻辑 | `moonshotai/kimi-k3` |
| 帮我打包上架到 App Store | `moonshotai/kimi-k3` |
| 给页面加日志埋点 | `deepseek/deepseek-v4-flash` |

5/5 命中。前期还用一个本地回声服务器（假装成上游）抓过 `Authorization` 头与 `model` 字段，
在没有真 key 的情况下就能把「密钥注入 + 路由选择 + 协议转换」三段一次验完 —— 这个手法调试网关很好用。

## 成本对比：三种编排方式（为什么要 brief，而不是实时切换）

做这套路由时踩过的一个坑：**一开始想「实时按消息切换模型」，后来发现实时切换反而更贵。**
原因在上下文——在单一共享会话里，上下文是累积的，每一轮都会把当前整段历史重新发给当前模型。
一旦把贵模型（Opus / Sonnet）实时拉进来，它就**重读整段已经膨胀的历史**（里面还混着便宜模型的废话），
于是你按 premium 单价，为「本来便宜模型就能处理的 token」反复付费。

算下来更划算的形态是 **brief 三段式**：

1. 用一个贵模型做**统筹规划**，产出一份 brief；
2. 让便宜模型**拿着 brief 去具体实施**（每个子任务只带 brief，不背整段会话）；
3. 事后再用贵模型**改 bug**（只看 brief + diff + 错误，不累积整段会话）。

下面用一次中等规模「功能开发」（1 规划 + 8 实施[前端 4 / 后端 4] + 2 改 bug + 2 难点推理 + 1 收尾，共 14 轮）做估算。
价格取自 OpenRouter，**2026-10-14 快照**：

| 模型 | 输入 $/1M | 输出 $/1M |
|---|---|---|
| anthropic/claude-opus-5.5 | 4.00 | 20.00 |
| anthropic/claude-sonnet-5.5 | 2.00 | 10.00 |
| moonshotai/kimi-k3 | 0.73 | 13.50 |
| deepseek/deepseek-v4-flash | 0.09 | 0.18 |

| 方式 | 思路 | 贵模型读取上下文 | 估算总成本 | 说明 |
|---|---|---|---|---|
| **① 实时切换**（单会话累积／重发） | 每轮按消息选模型，贵模型被实时拉进难点轮次，每次重读整段历史 | **126.0K** | **$0.750** | 贵模型反复为「本来便宜模型能处理的上下文」付 premium |
| **② brief 三段式** ✅ | Opus 写一次 brief；便宜模型按 brief 实施（scoped）；Sonnet 只在最后改 bug（focused） | **27.0K** | **$0.289** | 贵模型只碰小范围上下文，最省 |
| **③ 全程 Opus** | 所有轮次都给 Opus，每一轮读全量上下文 | **214.0K** | **$1.486** | 单价最高且贵模型包办了一切，绝对金额最高 |

**结论**：同样的 14 轮工作量，brief 比实时切换省 **61%**，比全程 Opus 省 **81%**。
差别几乎全在「贵模型读取的上下文量」这一项——实时切换的坑就是把上下文摊给贵模型重读。

> 数字来源可复现：`node scripts/cost-model.js`（改 `PRICE` 即可随 OpenRouter 实时价更新，改工作量假设即可套你自己的项目）。
> 注意：本仓库的关键词路由解决的是「单次请求派给哪个模型」，而上面的对比讲的是「调用结构怎么排」——
> 关键词路由三种编排方式都支持，brief 是其中最省的一种用法。

## 目录结构

```
config/
  config.example.json   主配置模板（密钥为占位符）
  custom-router.js      6 类职责分发规则 ← 改这里
scripts/
  install.js            跨平台一键安装（锁版本 / 写配置 / 跑自测）
  install.cmd / .sh     平台包装
  start-router.cmd      带 key 检查的启动脚本
  cost-model.js         三种编排方式的成本估算（可复现）
tests/
  test-custom-router.js 18 条路由用例
docs/
  USAGE.md / USAGE.en.md
journal/                开发日志（中英双语）
```

## 想用 CC Switch 的话

不用也行（`ccr code` 已经够）。要用就在 CC Switch 里新建一个自定义 Provider：

| 字段 | 值 |
|---|---|
| Base URL | `http://127.0.0.1:3456` |
| Auth scheme | `x-api-key` |
| API Key | 任意占位符，如 `local` |
| 模型映射 | **留空** |

别在 CC Switch 里填 OpenRouter 地址或三档模型映射 —— 会和本地路由器抢 `~/.claude/settings.json`。

> 3.x 曾偷偷改写过 `~/.claude/settings.json`，本机已还原，备份为 `settings.json.v3-takeover.bak`。

---

English version: [README.en.md](./README.en.md) · 完整说明：[docs/USAGE.md](./docs/USAGE.md)
