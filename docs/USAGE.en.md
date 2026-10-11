# Usage

Full setup, troubleshooting, and the record of *why* these choices were made.

## 1. Prerequisites

- Node.js ≥ 18 (LTS recommended)
- An OpenRouter API key (`sk-or-...`)
- Claude Code installed (`npm i -g @anthropic-ai/claude-code`)

## 2. Install

```bash
node scripts/install.js
```

It runs through:

1. Checks Node / npm
2. **Pins `claude-code-router` to 2.0.0** (installs or downgrades as needed)
3. Writes `~/.claude-code-router/config.json` (placeholder key, no plaintext secret)
4. Copies `custom-router.js` (plus the test script)
5. Runs the 18-case routing self-test
6. Checks whether `OPENROUTER_API_KEY` is set and tells you how to set it if not

## 3. Daily use

```bash
ccr start     # start the router (port 3456)
ccr code      # launch Claude Code inside the routed environment
ccr status    # is it running
ccr restart   # after editing config.json
ccr stop
```

Editing rules in `custom-router.js` needs **no restart** — it is re-required on every request.

## 4. Version choice: why 2.0.0

The setup was first installed against the latest 3.1.3; decompiling its dist confirmed a hard blocker.

ccr 3.x parses the segment before `/` in a model ID as **its own provider identifier**.
`anthropic`, `openai`, and `google` are first-class citizens there:

| Model | 3.x result |
|---|---|
| `anthropic/claude-opus-5.5` | `conflicts with target provider`, prefix stripped |
| `anthropic/claude-sonnet-5.5` | same |
| `moonshotai/kimi-k3` | works (unknown prefix, treated as a literal) |
| `deepseek/deepseek-v4-flash` | works |

**On v3, Opus and Sonnet cannot be reached at all** — precisely the roles for "core planning" and
"bug fixing".

Two more 3.x incompatibilities:

- Config moved to **SQLite** (`AppData/Roaming/claude-code-router/config.sqlite`).
  `config.json` is imported once only when the DB does not exist, then **deleted immediately**.
  Editing the JSON afterwards has no effect.
- `Router.default / background / think / longContext` are silently dropped; only
  `builtInRules / rules / fallback` are honored.
- It rewrites `~/.claude/settings.json` to take over profiles (restored on this machine;
  backup at `settings.json.v3-takeover.bak`).

2.0.0 has no provider-namespace parsing; whatever the custom router returns is written straight into
`body.model`. All 5 cases passed on the first try.

**Check whether this bug still exists before upgrading.**

## 5. Router contract (read before editing)

`CUSTOM_ROUTER_PATH` in `config.json` points at the router script. ccr 2.x behaves like this:

```js
const fn = require(absolutePath);       // re-required on every request
const target = await fn(req, config, ctx);
if (typeof target === 'string') body.model = target;   // strings only
```

Notes:

- Return a **string** in `"provider,model"` form. An object or `undefined` counts as no match and the
  request falls back to the four `Router` slots.
- `CUSTOM_ROUTER_PATH` must be an **absolute path** — ccr does not expand `~` (install.js handles this).
- Use forward slashes `/` as separators; safer on Windows.

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `conflicts with target provider` | Wrong version; downgrade: `npm i -g @musistudio/claude-code-router@2.0.0` |
| Everything goes to one model | `CUSTOM_ROUTER_PATH` not applied, or the script returned a non-string; run `npm test` |
| Upstream `401 Missing Authentication` | `OPENROUTER_API_KEY` unset, or set but terminal not reopened |
| Rule changes have no effect | The router script hot-reloads, but `config.json` changes need `ccr restart` |
| Misfires into backend / logging | Check for system-prompt pollution; this script scans user messages only — don't break that |
| Port 3456 busy | Change `PORT` in `config.json`, or `ccr stop` then restart |

## 7. Verification trick (worth reusing)

You can validate the whole chain without a real key: run a local echo server impersonating upstream,
point `api_base_url` at it temporarily, send requests, and capture the `Authorization` header and the
`model` field it receives. That verifies "key injection + routing + protocol translation" in one pass.

```js
// echo-upstream.js core
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

## 8. Security

- The key lives only in the system environment, never in a file.
- `config.json` sits in the user home directory, not inside a git repo.
- Don't swap `$OPENROUTER_API_KEY` for a literal, and don't pass the key as a command-line argument
  (it lands in shell history).
- To tighten permissions: `icacls` on `~/.claude-code-router` (Windows) or `chmod 700` (Unix).
