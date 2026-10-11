#!/usr/bin/env node
'use strict';

/**
 * 一键安装：把路由配置装进 ~/.claude-code-router
 *
 * 跨平台（Windows / macOS / Linux），只做三件事：
 *   1) 确保 claude-code-router@2.0.0 已全局安装
 *   2) 生成 ~/.claude-code-router/config.json（密钥用 $OPENROUTER_API_KEY 占位，不写明文）
 *   3) 复制 custom-router.js 路由规则
 *
 * 密钥永远不会落到文件里。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync, spawnSync } = require('node:child_process');

const REPO_DIR = path.resolve(__dirname, '..');
const HOME = os.homedir();
const CCR_DIR = path.join(HOME, '.claude-code-router');
const TARGET_CONFIG = path.join(CCR_DIR, 'config.json');
const TARGET_ROUTER = path.join(CCR_DIR, 'custom-router.js');
const PINNED_VERSION = '2.0.0';

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m',
  green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m',
};
const say = (s = '') => console.log(s);
const step = (s) => say(`${C.cyan}▶${C.reset} ${s}`);
const ok = (s) => say(`  ${C.green}✓${C.reset} ${s}`);
const warn = (s) => say(`  ${C.yellow}!${C.reset} ${s}`);
const fail = (s) => { say(`  ${C.red}✗${C.reset} ${s}`); process.exit(1); };

function run(cmd, opts = {}) {
  return spawnSync(cmd, { shell: true, encoding: 'utf8', ...opts });
}

/** 检测 ccr 是否可用，并读出版本号 */
function detectCcr() {
  const r = run('ccr --version');
  if (r.status !== 0) return null;
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const m = out.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : 'unknown';
}

function main() {
  say(`${C.bold}Claude Code 多模型路由 —— 安装${C.reset}\n`);

  // ---- 1. 环境检查 ----
  step('检查环境');
  const nodeVer = process.versions.node;
  ok(`Node ${nodeVer}`);
  const npm = run('npm --version');
  if (npm.status !== 0) fail('找不到 npm，请先安装 Node.js（https://nodejs.org）');
  ok(`npm ${npm.stdout.trim()}`);

  // ---- 2. 路由器版本 ----
  step(`检查 claude-code-router（锁定 ${PINNED_VERSION}）`);
  let installed = detectCcr();
  if (installed === null) {
    warn('未安装，正在全局安装…');
    const r = run(`npm install -g @musistudio/claude-code-router@${PINNED_VERSION}`, { stdio: 'inherit' });
    if (r.status !== 0) fail('安装失败，请手动执行上面那条命令看具体报错');
    installed = detectCcr();
  }
  if (installed !== PINNED_VERSION) {
    warn(`当前是 ${installed}，本方案要求 ${PINNED_VERSION}（3.x 会让 Opus/Sonnet 调不通，见 docs/USAGE.md）`);
    const r = run(`npm install -g @musistudio/claude-code-router@${PINNED_VERSION}`, { stdio: 'inherit' });
    if (r.status !== 0) fail(`降级到 ${PINNED_VERSION} 失败`);
    installed = detectCcr();
  }
  ok(`claude-code-router ${installed}`);

  // ---- 3. 写配置 ----
  step(`写入 ${TARGET_CONFIG}`);
  fs.mkdirSync(CCR_DIR, { recursive: true });

  const examplePath = path.join(REPO_DIR, 'config', 'config.example.json');
  if (!fs.existsSync(examplePath)) fail(`找不到模板：${examplePath}`);
  const config = JSON.parse(fs.readFileSync(examplePath, 'utf8'));

  // CUSTOM_ROUTER_PATH 必须是真实绝对路径（ccr 不做 ~ 展开）
  config.CUSTOM_ROUTER_PATH = TARGET_ROUTER.split(path.sep).join('/');

  // 已有配置时保留里面的 api_key 之外的一切自定义，但模型清单和路由脚本路径强制对齐
  if (fs.existsSync(TARGET_CONFIG)) {
    try {
      const prev = JSON.parse(fs.readFileSync(TARGET_CONFIG, 'utf8'));
      for (const [k, v] of Object.entries(prev)) {
        if (!(k in config)) config[k] = v;
      }
      warn('已存在 config.json，合并式覆盖（模型清单 / 路由脚本路径以仓库为准）');
    } catch {
      warn('已存在 config.json 但解析失败，将被覆盖');
    }
  }

  fs.writeFileSync(TARGET_CONFIG, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  ok('config.json 已写入');

  // ---- 4. 复制路由脚本 ----
  step(`复制路由规则到 ${TARGET_ROUTER}`);
  const routerSrc = path.join(REPO_DIR, 'config', 'custom-router.js');
  if (!fs.existsSync(routerSrc)) fail(`找不到路由脚本：${routerSrc}`);
  fs.copyFileSync(routerSrc, TARGET_ROUTER);
  ok('custom-router.js 已复制');

  // 顺手把测试脚本也放过去，方便改完规则就地自测
  const testSrc = path.join(REPO_DIR, 'tests', 'test-custom-router.js');
  if (fs.existsSync(testSrc)) {
    fs.copyFileSync(testSrc, path.join(CCR_DIR, 'test-custom-router.js'));
    ok('test-custom-router.js 已复制');
  }

  // ---- 5. 自测 ----
  step('跑路由规则自测');
  const t = run(`node "${path.join(CCR_DIR, 'test-custom-router.js')}"`);
  const tOut = `${t.stdout || ''}${t.stderr || ''}`;
  if (t.status !== 0) fail(`自测未通过：\n${tOut}`);
  ok(tOut.trim().split('\n').pop().trim());

  // ---- 6. 密钥 ----
  say('');
  step('检查 OpenRouter 密钥');
  if (process.env.OPENROUTER_API_KEY) {
    ok('检测到环境变量 OPENROUTER_API_KEY');
  } else {
    warn('环境变量 OPENROUTER_API_KEY 未设置（config.json 里是 $OPENROUTER_API_KEY 占位符，不会写明文）');
    say(`  ${C.dim}设置方式：${C.reset}`);
    if (process.platform === 'win32') {
      say('    setx OPENROUTER_API_KEY sk-or-xxxxxxxx');
      say(`    或把 key 单行写进 ${path.join(CCR_DIR, '.key')}`);
    } else {
      say("    echo 'export OPENROUTER_API_KEY=sk-or-xxxxxxxx' >> ~/.zshrc && source ~/.zshrc");
      say(`    或把 key 单行写进 ${path.join(CCR_DIR, '.key')}`);
    }
    say(`  ${C.dim}（重开终端让环境变量生效）${C.reset}`);
  }

  say(`\n${C.green}${C.bold}安装完成。${C.reset} 接下来：\n`);
  say(`  ${C.cyan}ccr start${C.reset}    启动路由器（端口 3456）`);
  say(`  ${C.cyan}ccr code${C.reset}     在路由环境下启动 Claude Code`);
  say(`\n${C.dim}完整说明见 docs/USAGE.md${C.reset}\n`);
}

main();
