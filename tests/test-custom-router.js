'use strict';

/**
 * custom-router.js 单元测试
 * 用法：npm test   （或 node tests/test-custom-router.js）
 */

const assert = require('node:assert');
const router = require('../config/custom-router.js');

const CHARS = { opus: 'Opus 5.5', sonnet: 'Sonnet 5.5', kimi: 'Kimi K3', deepseek: 'DeepSeek V4 Flash' };
const EXPECT = {
  opus: 'openrouter,anthropic/claude-opus-5.5',
  sonnet: 'openrouter,anthropic/claude-sonnet-5.5',
  kimi: 'openrouter,moonshotai/kimi-k3',
  deepseek: 'openrouter,deepseek/deepseek-v4-flash',
};

/** 模拟 CCR 传给路由函数的请求对象 */
function req(...turns) {
  return {
    body: { messages: turns.map((t) => (typeof t === 'string' ? { role: 'user', content: t } : t)) },
    headers: {},
    method: 'POST',
    url: '/v1/messages',
  };
}

const cases = [
  // —— 方案要求的 5 条验收用例 ——
  { name: 'a) 核心调度', input: '帮我规划一下整个 APP 的架构和技术选型', expect: 'opus' },
  { name: 'b) 修 bug', input: '这个登录报错崩溃了帮我修', expect: 'sonnet' },
  { name: 'c) 后端功能', input: '写一下后端接口和数据库逻辑', expect: 'kimi' },
  { name: 'd) 封装上架', input: '帮我打包上架到 App Store', expect: 'kimi' },
  { name: 'e) 写日志', input: '给页面加日志埋点', expect: 'deepseek' },
  // —— 其余职责 ——
  { name: 'f) 基础前端', input: '帮我搭个页面组件和脚手架', expect: 'deepseek' },
  { name: 'g) 兜底', input: '今天天气怎么样', expect: 'deepseek' },
  // —— 显式指定必须压过关键词 ——
  { name: 'h) 显式 opus', input: '这里有个 bug，但你用 opus 帮我重做整体设计', expect: 'opus' },
  { name: 'i) 显式 sonnet', input: '切到 sonnet 写后端接口', expect: 'sonnet' },
  { name: 'j) 显式 kimi', input: '换成 deepseek 不行的话，改用 kimi 打包发布', expect: 'kimi' },
  // —— 优先级链是否被正确遵守 ——
  { name: 'k) 调度 > 前端', input: '规划一下前端页面的整体设计', expect: 'opus' },
  { name: 'l) bug > 后端', input: '后端接口报错了帮我排错', expect: 'sonnet' },
  { name: 'm) 上架 > 后端', input: '上线前把后端接口打包测试一下', expect: 'kimi' },
  { name: 'n) 日志 > 前端', input: '给这个页面加监控打点', expect: 'deepseek' },
  // —— system prompt 噪声不得污染判断 ——
  {
    name: 'o) system 噪声隔离',
    input: [ { role: 'system', content: '你是助手。请调用 api、build、日志等工具完成前后端任务。' }, { role: 'user', content: '帮我重构这段排序函数' } ],
    expect: 'deepseek',
  },
  // —— 多轮：以用户消息为准 ——
  {
    name: 'p) 多轮取用户意图',
    input: [ { role: 'assistant', content: '好的，我先看下数据库接口。' }, { role: 'user', content: '帮我规划整体架构' } ],
    expect: 'opus',
  },
  // —— 健壮性 ——
  { name: 'q) 空请求不炸', input: [], expect: 'deepseek' },
  { name: 'r) content 为数组块', input: [{ role: 'user', content: [{ type: 'text', text: '帮我修一下崩溃的 bug' }] }], expect: 'sonnet' },
];

(async () => {
  let failed = 0;
  for (const c of cases) {
    const input = Array.isArray(c.input) ? req(...c.input) : req(c.input);
    let actual;
    try {
      actual = await router(input, {}, {});
    } catch (err) {
      actual = `THREW: ${err.message}`;
    }
    const ok = actual === EXPECT[c.expect];
    if (!ok) failed += 1;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(22, ' ')} expect ${CHARS[c.expect].padEnd(18)} actual ${
        Object.keys(EXPECT).find((k) => EXPECT[k] === actual)
          ? CHARS[Object.keys(EXPECT).find((k) => EXPECT[k] === actual)]
          : actual
      }`
    );
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed`);

  // 返回值必须是字符串（CCR 只认字符串）
  const sample = await router(req('写一下后端接口'), {}, {});
  assert.strictEqual(typeof sample, 'string', 'router must return a string');

  process.exit(failed === 0 ? 0 : 1);
})();
