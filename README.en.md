# Claude Code Multi-Model Router

Route Claude Code to different models **by engineering responsibility**: architecture talk goes to Opus,
bug fixing to Sonnet, backend work to Kimi, front-end and instrumentation to DeepSeek.
You just talk normally; the router dispatches on keywords in the background.

Upstream is [OpenRouter](https://openrouter.ai); [`claude-code-router`](https://www.npmjs.com/package/@musistudio/claude-code-router)
runs locally as the dispatch gateway.

```
Claude Code
    │
    ▼
claude-code-router (127.0.0.1:3456)
    │   custom-router.js — matches 6 responsibility buckets
    ▼
OpenRouter
    ├── anthropic/claude-opus-5.5        core planning
    ├── anthropic/claude-sonnet-5.5      bug fixing
    ├── moonshotai/kimi-k3               backend / packaging & release
    └── deepseek/deepseek-v4-flash       front-end / logging / fallback
```

## Quick start

```bash
# 1. Install and configure (pins ccr@2.0.0, writes config.json, runs the self-test)
node scripts/install.js        # on Windows: double-click scripts/install.cmd

# 2. Set your key once (reopen the terminal for it to take effect)
setx OPENROUTER_API_KEY sk-or-xxxxxxxx        # Windows
# echo 'export OPENROUTER_API_KEY=sk-or-xxxxxxxx' >> ~/.zshrc && source ~/.zshrc   # macOS/Linux

# 3. Run
ccr start      # start the router
ccr code       # launch Claude Code inside the routed environment
```

`ccr code` points `ANTHROPIC_BASE_URL` at `127.0.0.1:3456` automatically — you do **not** need to edit
`~/.claude/settings.json`, so there is no fight with CC Switch over that file.

## Model assignments

| Priority | Trigger keywords | Model | Responsibility |
|---|---|---|---|
| 1 | architecture / planning / design / orchestration / tech selection | Opus 5.5 | Core planning |
| 2 | bug / error / fix / crash / exception / debug / regression / reproduce | Sonnet 5.5 | Bug fixing |
| 3 | package / bundle / release / sign / build / ship / App Store / review / certificate | Kimi K3 | Packaging & release |
| 4 | backend / endpoint / api / database / server-side / business logic / auth / integration | Kimi K3 | Backend features |
| 5 | log / logging / instrumentation / monitoring / telemetry / tracing | DeepSeek V4 Flash | Logging |
| 6 | front-end / page / component / scaffold / routing / UI wiring | DeepSeek V4 Flash | Basic front-end |
| — | nothing matches | DeepSeek V4 Flash | Fallback |

Evaluated top to bottom, **first hit wins**, no chaining. An explicit instruction
("do this with opus", "switch to sonnet") overrides keyword matching.

## ⚠️ Pin 2.0.0 — do not upgrade to 3.x

This is the one hard constraint in the whole setup. 3.x parses the segment before `/` in a model ID as
**its own provider identifier**, and `anthropic` / `openai` / `google` are first-class citizens there:

| Model | 3.x | 2.0.0 |
|---|---|---|
| `anthropic/claude-opus-5.5` | `conflicts with target provider`, prefix stripped | ✅ |
| `anthropic/claude-sonnet-5.5` | same | ✅ |
| `moonshotai/kimi-k3` | works (unknown prefix, treated as a literal) | ✅ |
| `deepseek/deepseek-v4-flash` | works | ✅ |

So on 3.x **Opus and Sonnet cannot be reached at all** — exactly the two roles assigned to
"core planning" and "bug fixing".

3.x has two more gotchas: config moved to SQLite (`config.json` is imported once only when the DB does
not exist, then deleted), and it silently drops `Router.default / background / think / longContext`.
It also rewrites `~/.claude/settings.json` to take over profiles.

`install.js` pins 2.0.0 for you. **Don't run `npm update` blindly** — check whether this bug still exists first.

## Editing the rules

Edit `RULES` in `config/custom-router.js`, then:

```bash
npm test
```

All 18 cases must pass (priority crossovers, system-prompt noise isolation, explicit overrides).
The router script is re-required on every request, so **no restart is needed**.

Implementation details worth knowing:

- **Only `role==="user"` messages are scanned.** Claude Code's system prompt is full of
  `api` / `build` / `log`; scanning everything causes many false hits — case `o)` guards this.
- **Explicit overrides must be paired with a verb** ("use / switch to / change to …"), otherwise
  casually mentioning "opus" triggers a switch.
- **The router must return a string** in `"provider,model"` form; returning an object counts as no match.

## Key safety

- `config.json` contains `"api_key": "$OPENROUTER_API_KEY"` — 2.x expands env vars when reading config,
  so the key lives only in the environment, **never in a file**.
- This repo contains no secrets: `.gitignore` excludes `config.json` / `.env` / `*.key`, and the repo
  ships only `config/config.example.json` with a placeholder.
- If you dislike env vars, put the key on a single line in `~/.claude-code-router/.key` (also gitignored).

## Verification

Real OpenRouter calls (2026-10-11); the `model` field in the response is what upstream actually used:

| Input | Model used |
|---|---|
| plan the architecture and tech choices for this app | `anthropic/claude-opus-5.5` |
| this login throws an error and crashes, fix it | `anthropic/claude-sonnet-5.5` |
| write the backend endpoints and database logic | `moonshotai/kimi-k3` |
| package and ship this to the App Store | `moonshotai/kimi-k3` |
| add logging instrumentation to the page | `deepseek/deepseek-v4-flash` |

5/5 correct. Earlier, a local echo server impersonating upstream captured the `Authorization` header and
`model` field, which verified "key injection + routing + protocol translation" in one pass without a real
key — a handy trick for debugging gateways.

## Cost comparison: three orchestration styles (why brief beats real-time switching)

A trap hit while building this: **the first instinct was "switch models per message in real time", but that
turned out more expensive.** The reason is context. In a single shared conversation the context accumulates,
and every turn re-sends the whole history to whatever model is current. The moment you pull an expensive model
(Opus / Sonnet) in, it **re-reads the entire bloated history** (including cheap-model chatter), so you pay the
premium rate, over and over, for tokens a cheap model could have handled.

The cheaper shape is a **brief three-step**:

1. One expensive model does **planning** and emits a brief;
2. Cheap models **implement from the brief** (each subtask carries only the brief, not the whole thread);
3. An expensive model comes back **only at the end to fix bugs** (sees just the brief + diff + errors).

Below, one medium "feature build" (1 plan + 8 implementation [4 front-end / 4 back-end] + 2 bug-fix + 2 hard
reasoning + 1 wrap-up = 14 turns). Prices are OpenRouter **2026-10-14 snapshot**:

| Model | Input $/1M | Output $/1M |
|---|---|---|
| anthropic/claude-opus-5.5 | 4.00 | 20.00 |
| anthropic/claude-sonnet-5.5 | 2.00 | 10.00 |
| moonshotai/kimi-k3 | 0.73 | 13.50 |
| deepseek/deepseek-v4-flash | 0.09 | 0.18 |

| Style | Idea | Expensive ctx read | Est. total | Note |
|---|---|---|---|---|
| **① Real-time switching** (single accumulating thread) | pick a model per message; expensive models pulled into hard turns, re-reading full history each time | **126.0K** | **$0.750** | expensive models repeatedly pay premium for context cheap models could handle |
| **② Brief three-step** ✅ | Opus writes a brief once; cheap models implement from it (scoped); Sonnet only fixes bugs at the end (focused) | **27.0K** | **$0.289** | expensive models touch only small, focused context — cheapest |
| **③ All Opus** | every turn goes to Opus, reading full context each time | **214.0K** | **$1.486** | highest unit price and the expensive model does everything — highest absolute cost |

**Result**: for the same 14-turn workload, brief saves **61%** over real-time switching and **81%** over
all-Opus. Almost the entire difference is the single line "how much context the expensive models read" —
real-time switching's trap is exactly that it spreads context to expensive models to re-read.

> Numbers are reproducible: `node scripts/cost-model.js` (edit `PRICE` to track live OpenRouter pricing,
> edit the workload assumptions to fit your own project). Note: this repo's keyword router decides *which*
> model a single request goes to; the comparison above is about *how you structure the calls* — the keyword
> router supports all three styles, and brief is the cheapest way to use it.

## Layout

```
config/
  config.example.json   main config template (placeholder key)
  custom-router.js      the 6-bucket dispatch rules ← edit this
scripts/
  install.js            cross-platform installer (pin version / write config / run tests)
  install.cmd / .sh     platform wrappers
  start-router.cmd      launcher with a key check
  cost-model.js         cost estimate for the three orchestration styles (reproducible)
tests/
  test-custom-router.js 18 routing cases
docs/
  USAGE.md / USAGE.en.md
journal/                dev log (bilingual)
```

## If you want CC Switch

Not required — `ccr code` is enough. If you do, add a custom Provider:

| Field | Value |
|---|---|
| Base URL | `http://127.0.0.1:3456` |
| Auth scheme | `x-api-key` |
| API Key | any placeholder, e.g. `local` |
| Model mapping | **leave empty** |

Do not fill in the OpenRouter address or the three-tier model mapping there — that races with the local
router over `~/.claude/settings.json`.

> 3.x once rewrote `~/.claude/settings.json` silently; it has been restored on this machine,
> backup kept as `settings.json.v3-takeover.bak`.

---

中文版: [README.md](./README.md) · Full docs: [docs/USAGE.en.md](./docs/USAGE.en.md)
