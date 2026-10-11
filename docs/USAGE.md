# 使用说明

完整步骤、排错清单、以及「为什么这么选」的记录。

## 一、前置

- Node.js ≥ 18（推荐 LTS）
- 一个 OpenRouter API Key（`sk-or-...`）
- 已装 Claude Code（`npm i -g @anthropic-ai/claude-code`）

## 二、安装

```bash
node scripts/install.js
```

它会依次做：

1. 检查 Node / npm
2. **把 `claude-code-router` 钉在 2.0.0**（版本不对会自动装/降级）
3. 生成 `~/.claude-code-router/config.json`（密钥占位符，不写明文）
4. 复制 `custom-router.js`（和自测脚本）
5. 跑一遍 18 条路由自测
6. 检查 `OPENROUTER_API_KEY` 是否设置，没设置就告诉你怎么设

## 三、日常用法

```bash
ccr start     # 起路由器（端口 3456）
ccr code      # 在路由环境下启动 Claude Code
ccr status    # 看是否在运行
ccr restart   # 改了 config.json 之后重启
ccr stop
```

改 `custom-router.js` 里的规则**不用重启** —— 它每次请求都会重新加载。

## 四、版本选型：为什么是 2.0.0

方案最初按最新版 3.1.3 装过一轮，反编译 dist 逐个核对后确认有硬伤。

ccr 3.x 会把模型 ID 里 `/` 前面那截当成**自己的供应商标识**去解析。`anthropic`、`openai`、`google`
是它的一等公民，于是：

| 模型 | 3.x 结果 |
|---|---|
| `anthropic/claude-opus-5.5` | 报错 `conflicts with target provider`，前缀被剥掉 |
| `anthropic/claude-sonnet-5.5` | 同上 |
| `moonshotai/kimi-k3` | 正常（这个前缀它不认识，当字面量放过） |
| `deepseek/deepseek-v4-flash` | 正常 |

**v3 上 Opus 和 Sonnet 根本调不通。** 而那两个恰好是分工里的「核心调度」和「修 bug」。

3.x 另外两处不兼容：

- 配置改存 **SQLite**（`AppData/Roaming/claude-code-router/config.sqlite`）。
  `config.json` 只在库不存在时导入一次，**导完当场删除**。改 JSON 不会生效。
- 会静默丢弃 `Router.default / background / think / longContext`，只认 `builtInRules / rules / fallback`。
- 会改写 `~/.claude/settings.json` 做 profile 接管（本机已还原，备份 `settings.json.v3-takeover.bak`）。

2.0.0 没有那层供应商命名空间解析，自定义路由返回的字符串直接写进 `body.model`，5 条用例一次通过。

**升级前先确认这个坑还在不在。**

## 五、路由契约（改脚本前必读）

`config.json` 里 `CUSTOM_ROUTER_PATH` 指向路由脚本。ccr 2.x 的行为：

```js
const fn = require(绝对路径);          // 每次请求都重新 require
const target = await fn(req, config, ctx);
if (typeof target === 'string') body.model = target;   // 只认字符串
```

要点：

- 返回值必须是 `"供应商,模型"` 格式的**字符串**。返回对象 / `undefined` 等于没命中，退回 `Router` 四档兜底。
- `CUSTOM_ROUTER_PATH` 要写**绝对路径**，ccr 不做 `~` 展开（install.js 已处理）。
- 路径分隔符用正斜杠 `/`，Windows 上更稳。

## 六、排错

| 现象 | 原因 / 处理 |
|---|---|
| `conflicts with target provider` | 版本不对，退回 2.0.0：`npm i -g @musistudio/claude-code-router@2.0.0` |
| 所有请求都走同一个模型 | `CUSTOM_ROUTER_PATH` 没生效或返回了非字符串；跑 `npm test` 确认脚本本身对 |
| 上游返回 `401 Missing Authentication` | `OPENROUTER_API_KEY` 没设，或设完没重开终端 |
| 改了规则没变化 | 路由脚本热加载，但 `config.json` 改动需要 `ccr restart` |
| 误判成后端/日志 | 检查是不是 system prompt 污染；本脚本只扫 user 消息，改动时别破坏这条 |
| 端口 3456 被占 | 改 `config.json` 的 `PORT`，或 `ccr stop` 后重启 |

## 七、验证手法（复用价值高）

没有真 key 也能把链路验完：起一个本地回声服务器假装上游，把 `config.json` 的
`api_base_url` 临时指到它，然后打请求，抓它收到的 `Authorization` 头和 `model` 字段。
一次就能验证「密钥注入 + 路由选择 + 协议转换」三段。

```js
// echo-upstream.js 核心
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const j = JSON.parse(body || '{}');
    console.log(j.model, '|', req.headers.authorization);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'echo', type: 'message', role: 'assistant',
      model: j.model, content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 } }));
  });
}).listen(3999);
```

## 八、安全

- key 只在系统环境变量里，不进任何文件。
- config.json 在用户目录下，不在 git 仓库里。
- 别把 `$OPENROUTER_API_KEY` 换成明文，也别把 key 贴进命令行参数（会进 shell history）。
- 想收紧权限：对 `~/.claude-code-router` 用 `icacls`（Windows）或 `chmod 700`（Unix）限制成仅当前用户。
