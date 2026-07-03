# harness-example

A tiny, runnable **agent harness** — the code companion to
[`../what-is-a-harness.html`](../what-is-a-harness.html).

It drives **GitHub Copilot** (via [`@github/copilot-sdk`](https://www.npmjs.com/package/@github/copilot-sdk))
to build a small URL shortener, with an independent evaluator that grades the
result and reopens gaps until it passes. The SDK launches the Copilot CLI runtime
and reuses your existing login — **no API key, no environment variables.**

## Prerequisites

- **Node.js >= 24** (runs `.ts` directly — no build step)
- **GitHub Copilot CLI** installed and logged in — see
  [github.com/features/copilot/cli](https://github.com/features/copilot/cli).
  After installing, run `copilot` once and sign in if prompted.

## Run

```bash
npm install
node harness.ts
```

That one command runs the whole demo: seed a spec → build features in fresh
sessions → evaluate → reopen gaps → repeat until `round N: PASS`. The generated
app appears in [`../harness-example-output/`](../harness-example-output/)
(created on first run, git-ignored).

## Try the result

```bash
cd ../harness-example-output
PORT=8787 node server.js &
curl -s -XPOST localhost:8787/shorten -H 'content-type: application/json' \
  -d '{"url":"https://github.com"}'          # -> {"code":"..."}
curl -s -o /dev/null -w '%{http_code}\n' localhost:8787/<code>   # -> 302
```

## How it works

Read [`harness.ts`](./harness.ts) top to bottom — it's ~250 lines with a `STEP 1..8`
banner for each tutorial slide, each explaining what it does and how the Copilot
SDK changes it. The load-bearing pieces are all there: the loop, tools, durable
state (`progress.json` on disk), reset/handoff between fresh sessions, and an
independent evaluator. The color + emoji console output lives in
[`logger.ts`](./logger.ts) (set `NO_COLOR=1` for plain text).

## Notes

- **Model:** resolved at startup via `client.listModels()` — the first `opus`
  model (fallback `claude-opus-4.5`). Change the `MODEL` constant near STEP 5 to
  pin another.
- **Cost/time:** it's a real agent doing real work — expect a few minutes and
  some Copilot usage.
- **Reset:** `rm -rf ../harness-example-output` — it's rebuilt on the next run.
- **Re-running** resumes from `progress.json`.
