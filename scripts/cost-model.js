#!/usr/bin/env node
/**
 * 三种 Claude Code 多模型路由方式的成本模型（可复现）
 *
 * 核心结论：贵模型（Opus / Sonnet）读取的上下文量，决定了整体成本。
 *  - 实时切换：贵模型每次被实时拉进来时，都要重读整段累积会话 → 贵上下文最多
 *  - brief 方式：贵模型只在「写 brief」和「最后改 bug」时看小范围上下文 → 贵上下文最少
 *  - 全程 Opus：Opus 看全部上下文每一轮 → 绝对金额最高（但贵上下文不跨模型污染）
 *
 * 价格取自 OpenRouter，运行日快照见 README 顶部说明。改 PRICE 即可更新。
 */
const PRICE = {
  opus:     { in: 4.00,  out: 20.00 },  // anthropic/claude-opus-5.5
  sonnet:   { in: 2.00,  out: 10.00 },  // anthropic/claude-sonnet-5.5
  kimi:     { in: 0.73,  out: 13.50 },  // moonshotai/kimi-k3
  deepseek: { in: 0.09,  out: 0.18 },   // deepseek/deepseek-v4-flash
};

// ---- 工作量假设（一次中等规模「功能开发」）----
const SEED = 1000;       // 初始需求上下文
const BRIEF_OUT = 3000;  // Opus 写 brief 的输出
const IMPL_OUT = 2000;   // 每个实施子任务的输出
const BUGFIX_OUT = 2500; // 每次改 bug 的输出
const TASK_IN = 500;     // 子任务说明
const DIFF = 8000;       // 改 bug 时带入的 diff
const ERRORS = 2000;     // 改 bug 时带入的错误信息

const cost = (m, i, o) => (i * PRICE[m].in + o * PRICE[m].out) / 1e6;
const add = (acc, m, i, o) => { acc[m] = acc[m] || [0, 0]; acc[m][0] += i; acc[m][1] += o; };
const total = acc => Object.keys(acc).reduce((s, m) => s + cost(m, acc[m][0], acc[m][1]), 0);
const expCtx = acc => (acc.opus ? acc.opus[0] : 0) + (acc.sonnet ? acc.sonnet[0] : 0);

// 14 轮工作量：T1 规划 / T2-9 实施 / T10-11 改bug / T12-13 难点推理 / T14 收尾
// 各轮「输出量」
const OUT = [BRIEF_OUT, IMPL_OUT,IMPL_OUT,IMPL_OUT,IMPL_OUT, IMPL_OUT,IMPL_OUT,IMPL_OUT,IMPL_OUT, BUGFIX_OUT,BUGFIX_OUT, BUGFIX_OUT,BUGFIX_OUT, BUGFIX_OUT];

// A1 实时切换：单一共享会话，上下文累积并重发；贵模型被实时拉进难点轮次
function approach1() {
  const acc = {}; let ctx = SEED;
  const who = ['opus','deepseek','deepseek','deepseek','deepseek','kimi','kimi','kimi','kimi','sonnet','sonnet','opus','opus','sonnet'];
  OUT.forEach((o, k) => { const m = who[k]; add(acc, m, ctx, o); ctx += o; });
  return acc;
}
// A3 全程 Opus：所有轮次 Opus，上下文累积
function approach3() {
  const acc = {}; let ctx = SEED;
  OUT.forEach(o => { add(acc, 'opus', ctx, o); ctx += o; });
  return acc;
}
// A2 brief：Opus 写一次 brief；便宜模型按 brief 做子任务（不跨调用累积）；
//           Sonnet 只在最后改 bug 时看 brief+diff+错误（不累积整段会话）
function approach2() {
  const acc = {};
  add(acc, 'opus', SEED, BRIEF_OUT);                       // T1 写 brief
  for (let k = 1; k <= 8; k++) {                            // T2-9 实施，scoped
    const m = k <= 4 ? 'deepseek' : 'kimi';
    add(acc, m, BRIEF_OUT + TASK_IN, IMPL_OUT);
  }
  for (let j = 0; j < 2; j++) {                             // T10-11 改 bug，focused
    add(acc, 'sonnet', BRIEF_OUT + DIFF + ERRORS, BUGFIX_OUT);
  }
  // T12-13 难点、T14 收尾：在 brief 方式里用便宜模型按 brief 消化，无需再拉贵模型
  for (let k = 0; k < 3; k++) add(acc, 'deepseek', BRIEF_OUT + TASK_IN, BUGFIX_OUT);
  return acc;
}

const a1 = approach1(), a3 = approach3(), a2 = approach2();
const c1 = total(a1), c3 = total(a3), c2 = total(a2);

const fmt = acc => Object.keys(acc)
  .map(m => `  ${m.padEnd(9)} in=${(acc[m][0]/1000).toFixed(1)}K out=${(acc[m][1]/1000).toFixed(1)}K  $${cost(m, acc[m][0], acc[m][1]).toFixed(4)}`).join('\n');

console.log('=== A1 实时切换（每模型 token，单位 K）===\n' + fmt(a1));
console.log('\n=== A2 brief（每模型 token，单位 K）===\n' + fmt(a2));
console.log('\n=== A3 全程 Opus（每模型 token，单位 K）===\n' + fmt(a3));
console.log('\n=== 汇总 ===');
console.log(`A1 实时切换 : 总 $${c1.toFixed(3)}   贵模型读上下文 ${(expCtx(a1)/1000).toFixed(1)}K`);
console.log(`A2 brief    : 总 $${c2.toFixed(3)}   贵模型读上下文 ${(expCtx(a2)/1000).toFixed(1)}K`);
console.log(`A3 全程Opus : 总 $${c3.toFixed(3)}   贵模型读上下文 ${(expCtx(a3)/1000).toFixed(1)}K`);
console.log(`\nA2(brief) 比 A1(实时切换) 省 ${((1 - c2/c1) * 100).toFixed(0)}%  —— 同样的工作量，差别只在「上下文是否累积/重发」`);
console.log(`A2(brief) 比 A3(全程Opus) 省 ${((1 - c2/c3) * 100).toFixed(0)}%`);
console.log(`A1(实时切换) 是 A3(全程Opus) 的 ${((c1/c3) * 100).toFixed(0)}%（A3 还让 Opus 包办了本可由便宜模型做的实施）`);

module.exports = { a1, a2, a3, c1, c2, c3, expCtx };
