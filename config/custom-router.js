/**
 * Claude Code 自定义路由脚本 —— 6 类工程职责分发
 *
 * 命中优先级：核心调度 > 修bug > 封装上架 > 后端功能 > 写日志 > 基础前端
 *
 * ccr 2.x 契约（本方案锁定 2.0.0，详见 docs/USAGE.md 的「版本选型」一节）：
 *   config.json 里的 CUSTOM_ROUTER_PATH 指向本文件，路由器用 require() 载入，
 *   取 module.exports 导出的函数，以 (req, config, ctx) 调用，
 *   **返回值必须是 "供应商,模型" 格式的字符串**，它会被直接写进 body.model。
 *   返回非字符串（对象 / undefined）等于没命中，请求退回 Router 里的四档兜底。
 *
 * 注意：本文件每次请求都会被重新 require，所以改完不用重启路由器。
 *
 * 匹配范围说明：
 *   只用 role==="user" 的消息做关键词匹配。Claude Code 的 system prompt 里
 *   塞满了 "api / 日志 / 构建" 这类词，全量匹配会产生大量误判。
 */

'use strict';

const PROVIDER = 'openrouter';

const MODELS = {
  opus: 'anthropic/claude-opus-5.5',
  sonnet: 'anthropic/claude-sonnet-5.5',
  kimi: 'moonshotai/kimi-k3',
  deepseek: 'deepseek/deepseek-v4-flash',
};

/** 拼出路由目标："openrouter,anthropic/claude-opus-5.5" */
const at = (slot) => `${PROVIDER},${MODELS[slot]}`;

const RULES = [
  {
    slot: '核心调度',
    target: at('opus'),
    keywords: ['架构', '方案', '思路', '调度', '整体设计', '技术选型', '规划', '拆解', '总纲'],
  },
  {
    slot: '修bug',
    target: at('sonnet'),
    keywords: ['bug', '报错', '修复', '崩溃', '异常', 'debug', '排错', '回归', '复现'],
  },
  {
    slot: '封装上架',
    target: at('kimi'),
    keywords: [
      '打包', '封装', '发布', '签名', '构建', '上架',
      '应用商店', 'app store', '审核', '证书', 'build',
    ],
  },
  {
    slot: '后端功能',
    target: at('kimi'),
    keywords: ['后端', '接口', 'api', '数据库', '服务端', '业务逻辑', '鉴权', '联调'],
  },
  {
    slot: '写日志',
    target: at('deepseek'),
    keywords: ['日志', 'log', '埋点', '监控', '打点', '追踪'],
  },
  {
    slot: '基础前端',
    target: at('deepseek'),
    keywords: ['前端', '页面', '组件', '脚手架', '路由', '界面搭建'],
  },
];

const FALLBACK_TARGET = at('deepseek');

/** 显式指定：必须与"用/切成/换成/指定"等动词搭配，避免闲聊误触发 */
const EXPLICIT = [
  { slot: 'opus', re: /(?:用|使用|切到|切成|换成|改为|指定|走|换)\s*opus/i },
  { slot: 'sonnet', re: /(?:用|使用|切到|切成|换成|改为|指定|走|换)\s*sonnet/i },
  { slot: 'kimi', re: /(?:用|使用|切到|切成|换成|改为|指定|走|换)\s*(?:kimi|k3)/i },
  { slot: 'deepseek', re: /(?:用|使用|切到|切成|换成|改为|指定|走|换)\s*deepseek/i },
];

/** 把 Anthropic 的 content 字段摊平成纯文本 */
function contentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (!block) return '';
      if (typeof block === 'string') return block;
      if (typeof block.text === 'string') return block.text;
      if (typeof block.content === 'string') return block.content;
      return '';
    })
    .join(' ');
}

function messageText(message) {
  return contentToText(message && message.content);
}

/**
 * 取出用于匹配的文本。
 * userText  —— 所有用户消息拼起来（主要依据）
 * fullText  —— 兜底再看过往 assistant 消息（仍不含 system）
 */
function collectText(req) {
  const messages = (req && req.body && Array.isArray(req.body.messages) && req.body.messages) || [];
  const userParts = [];
  const allParts = [];
  for (const m of messages) {
    const text = messageText(m);
    if (!text) continue;
    // system 永远不参与匹配：Claude Code 的 system prompt 里塞满了
    // "api / build / 日志" 这类词，一旦扫进去会污染兜底判断
    if (m.role !== 'system') allParts.push(text);
    if (m.role === 'user') userParts.push(text);
  }
  // 没有任何 user 消息时（例如子代理请求），退回全量
  const userText = userParts.join('\n').toLowerCase();
  const fullText = allParts.join('\n').toLowerCase();
  return { userText: userText || fullText, fullText };
}

/** 命中即返回，不做多模型串联 */
function match(text) {
  for (const rule of RULES) {
    if (rule.keywords.some((k) => text.includes(k.toLowerCase()))) {
      return { target: rule.target, slot: rule.slot };
    }
  }
  return null;
}

module.exports = async function route(req) {
  try {
    const { userText, fullText } = collectText(req);

    // 1) 显式指定优先
    for (const rule of EXPLICIT) {
      if (rule.re.test(userText)) return at(rule.slot);
    }

    // 2) 用户消息命中优先级链
    const hit = match(userText) || match(fullText);
    if (hit) return hit.target;

    // 3) 兜底
    return FALLBACK_TARGET;
  } catch {
    // 路由脚本抛错不能拖垮整条请求
    return FALLBACK_TARGET;
  }
};

// 便于本地自测：导出内部常量
module.exports.__internals = { MODELS, RULES, FALLBACK_TARGET, at, collectText, contentToText };
