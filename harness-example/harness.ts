/**
 * A minimal agent harness — the code companion to ../what-is-a-harness.html.
 *
 * The slides drive a model through a raw provider SDK. This version drives
 * GitHub Copilot through @github/copilot-sdk, which spawns the Copilot CLI
 * runtime and reuses your existing Copilot login — no external LLM key.
 *
 * The big idea: the Copilot CLI runtime is ITSELF an agent. The slide version
 * had to hand-build the agent loop (call model -> run tools -> feed results
 * back -> repeat); here the runtime does that, so our job is to drive it session
 * by session and own the durable state around it. Each STEP banner below maps
 * one-to-one to a tutorial slide and notes what changed and why.
 *
 * Run it with a single command (Node >= 24):  node harness.ts
 */

// ───────────────────────────────────────────────────────────────────────────
// STEP 1 · Setup and helpers
// The slide version created a raw provider client and a `textOf()` extractor.
// Here we create a CopilotClient (it launches the CLI runtime over JSON-RPC)
// and read the response text straight off the assistant.message event that
// sendAndWait() returns.
// ───────────────────────────────────────────────────────────────────────────
import { CopilotClient, defineTool, approveAll } from "@github/copilot-sdk";
import type { AssistantMessageEvent } from "@github/copilot-sdk";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { c, log } from "./logger.ts"; // color + emoji step-by-step console output

// The agent builds the app in a sibling folder; that folder is ALSO the
// client's working directory, so the agent's built-in file/bash tools and our
// own durable state all land in the same place.
const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(HERE, "..", "harness-example-output");

// pull the plain text out of a finished assistant turn
const textOf = (m: AssistantMessageEvent | undefined): string => m?.data.content ?? "";

// ───────────────────────────────────────────────────────────────────────────
// STEP 2 · Durable state on disk
// Unchanged from the slides: the point of a harness is that state survives a
// context reset because it lives in progress.json on disk, not in the window.
// (The slides also checkpointed to git; here plain JSON writes are enough.)
// ───────────────────────────────────────────────────────────────────────────
type Feature = { id: string; title: string; done: boolean };
type State = { goal: string; features: Feature[]; notes: string[] };

const STATE_FILE = resolve(OUTPUT_DIR, "progress.json");
const loadState = (): State => JSON.parse(readFileSync(STATE_FILE, "utf8"));
const saveState = (s: State) => writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));

function saveProgress(note: string): string {
  const s = loadState();
  s.notes.push(note); // notes[] is our durable, append-only progress log
  saveState(s);
  return "progress saved";
}
function markDone(id: string): string {
  const s = loadState();
  const f = s.features.find((f) => f.id === id);
  if (!f) return `no feature ${id}`;
  f.done = true;
  saveState(s);
  return `marked ${id} done`;
}
// evaluator gaps (STEP 7) re-enter the feature list here
function reopenFeatures(gaps: string[]): void {
  const s = loadState();
  gaps.forEach((g, i) => s.features.push({ id: `fix-${s.features.length + i}`, title: g, done: false }));
  saveState(s);
}

// ───────────────────────────────────────────────────────────────────────────
// STEP 3 · Declare the tools (the hands)
// The slides hand-declared five tools. The Copilot runtime already gives the
// agent built-in file and shell tools (view / write / edit / bash), so we only
// declare the two the app itself needs: durable-state progress + feature done.
// ───────────────────────────────────────────────────────────────────────────
const tools = [
  defineTool("update_progress", {
    description: "Append a progress note to the durable state on disk.",
    parameters: z.object({ note: z.string().describe("Short progress note") }),
    handler: async ({ note }) => saveProgress(note),
  }),
  defineTool("mark_feature_done", {
    description: "Mark one feature id complete in progress.json.",
    parameters: z.object({ id: z.string().describe("Feature id, e.g. f1") }),
    handler: async ({ id }) => markDone(id),
  }),
];

// ───────────────────────────────────────────────────────────────────────────
// STEP 4 · Route tool calls to real code
// The slides needed a switch to turn "decide" into "act". With the SDK each
// tool's handler (above) IS the effect, and the built-in tools are routed by
// the runtime — so there is no dispatch table to maintain here.
// ───────────────────────────────────────────────────────────────────────────
// (intentionally empty — see the handlers on each defineTool in STEP 3)

// ───────────────────────────────────────────────────────────────────────────
// STEP 5 · The agent loop
// In the slides this was a hand-written for-loop calling the model API and
// feeding tool results back. The Copilot runtime IS that loop: sendAndWait
// runs the model, executes whatever tools it asks for, and returns only when
// the turn is done. We just create a client and resolve an Opus model.
// ───────────────────────────────────────────────────────────────────────────
const client = new CopilotClient({ workingDirectory: OUTPUT_DIR, logLevel: "error" });

let MODEL = "claude-opus-4.5"; // resolved for real in main()
const SESSION_TIMEOUT_MS = 20 * 60 * 1000;

async function runAgentTurn(system: string, prompt: string): Promise<AssistantMessageEvent | undefined> {
  const session = await client.createSession({
    model: MODEL,
    tools,
    systemMessage: { content: system },
    onPermissionRequest: approveAll, // auto-approve built-in file/bash tools
    infiniteSessions: { enabled: false }, // our reset/handoff loop is the reset
  });
  // Narrate what the agent is doing, turn by turn.
  session.on("tool.execution_start", (e) => log.tool(e.data.toolName, e.data.arguments));
  session.on("assistant.message", (e) => log.say(e.data.content ?? ""));
  try {
    return await session.sendAndWait({ prompt }, SESSION_TIMEOUT_MS);
  } finally {
    await session.disconnect(); // window ends; state is on disk
  }
}

// ───────────────────────────────────────────────────────────────────────────
// STEP 6 · Worker prompt, handoff, reset
// Each session() is a fresh window. build() keeps spawning sessions until every
// feature is done — that is the reset-and-handoff outer loop.
// ───────────────────────────────────────────────────────────────────────────
const SYSTEM = `You are a coding agent resuming a long task.
First, read progress.json with your built-in tools to see the goal, which
features are done, and the notes from previous sessions.
Pick the SINGLE highest-priority unfinished feature.
Implement it using your file and shell tools, run the server and curl it to prove
it works, then call update_progress and mark_feature_done.
Do NOT try to build everything at once.`;

const handoffPrompt = (s: State): string =>
  `Goal: ${s.goal}\n` +
  `Unfinished: ${s.features.filter((f) => !f.done).map((f) => `[${f.id}] ${f.title}`).join("; ")}\n` +
  `Recent notes:\n${s.notes.slice(-8).join("\n") || "(none yet)"}`;

async function session(): Promise<"more" | "complete"> {
  const s = loadState();
  if (s.features.every((f) => f.done)) return "complete";
  const next = s.features.find((f) => !f.done)!;
  const doneCount = s.features.filter((f) => f.done).length;
  log.phase("🔨", `Building feature ${doneCount + 1} of ${s.features.length}`);
  log.item(`${next.id}: ${next.title}`);
  await runAgentTurn(SYSTEM, handoffPrompt(s));
  return "more"; // window ends; state is on disk
}
async function build(): Promise<void> {
  while ((await session()) === "more") { /* fresh session per feature; state is on disk */ }
}

// ───────────────────────────────────────────────────────────────────────────
// STEP 7 · An independent evaluator
// A second agent with its own criteria probes the running service and returns
// JSON. Its gaps feed back through reopenFeatures() from STEP 2.
// ───────────────────────────────────────────────────────────────────────────
const CRITERIA = ["functionality", "error handling", "code clarity"];

async function evaluate(): Promise<{ pass: boolean; gaps: string[] }> {
  log.phase("🔍", "Evaluator — an independent agent probes the running server");
  const res = await runAgentTurn(
    `You are an INDEPENDENT evaluator. Start the server with your bash tool and probe
it with curl (POST /shorten, follow a redirect, hit an unknown code).
Grade it on: ${CRITERIA.join(", ")}.
Reply with ONLY JSON: {"pass": boolean, "gaps": string[]}.`,
    "Evaluate the current build against the goal in progress.json.",
  );
  try {
    return JSON.parse(textOf(res).match(/\{[\s\S]*\}/)?.[0] ?? "{}");
  } catch {
    return { pass: false, gaps: ["evaluator output was not valid JSON"] };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// STEP 8 · Seed the spec, then tie it together
// seed() writes the feature list on the first run (the "initializer").
// main() alternates build and evaluate until it passes.
// ───────────────────────────────────────────────────────────────────────────
function seed() {
  const state: State = {
    goal: "URL shortener in plain Node: POST /shorten {url}->{code}, GET /:code -> 302 redirect.",
    features: [
      { id: "f1", title: "HTTP server on PORT with a small router", done: false },
      { id: "f2", title: "POST /shorten stores the url, returns a short code", done: false },
      { id: "f3", title: "GET /:code 302-redirects to the original url", done: false },
      { id: "f4", title: "persist code->url map to store.json", done: false },
      { id: "f5", title: "404 unknown code, 400 bad input", done: false },
    ],
    notes: [],
  };
  saveState(state);
}

// Print a friendly completion message with copy-pasteable steps to test the app.
function printSuccess(): void {
  log.banner("All features complete 🎉");
  log.good("Your URL shortener is ready in " + OUTPUT_DIR);
  log.heading("Try it yourself:");
  log.cmd("cd ../harness-example-output");
  log.cmd("PORT=8787 node server.js &");
  log.cmd("# shorten a URL (returns a short code):");
  log.cmd("curl -s -XPOST localhost:8787/shorten -H 'content-type: application/json' \\");
  log.cmd("  -d '{\"url\":\"https://github.com\"}'");
  log.cmd("# follow the redirect (swap in the code you got back):");
  log.cmd("curl -si localhost:8787/<code> | grep -i location");
}

async function main() {
  log.banner("Harness demo · building a URL shortener with GitHub Copilot");
  mkdirSync(OUTPUT_DIR, { recursive: true }); // folder is generated on demand
  log.info("📁", "Output folder: " + c.dim(OUTPUT_DIR));
  log.info("🔌", "Starting the Copilot CLI runtime…");
  await client.start(); // launch the Copilot CLI runtime
  try {
    const models = await client.listModels();
    MODEL = models.find((m) => /opus/i.test(m.id))?.id ?? MODEL;
    log.info("🤖", "Model: " + c.bold(MODEL));

    if (!existsSync(STATE_FILE)) {
      seed(); // run 1 only
      const s = loadState();
      log.info("🌱", `Seeded the spec with ${s.features.length} features:`);
      s.features.forEach((f) => log.item(`[${f.id}] ${f.title}`));
    } else {
      log.info("♻️ ", "Resuming from an existing progress.json");
    }

    for (let round = 1; round <= 5; round++) {
      log.banner(`Round ${round}`);
      await build(); // worker: build until all features done
      log.good("All features built — handing off to the evaluator");
      const v = await evaluate(); // independent QA
      if (v.pass) {
        printSuccess();
        return;
      }
      log.warn(`Round ${round}: the evaluator found ${v.gaps.length} gap(s):`);
      v.gaps.forEach((g) => log.item(g));
      reopenFeatures(v.gaps); // gaps become new features, loop again
      log.info("➕", `Reopened ${v.gaps.length} gap(s) as new features — looping.`);
    }
    log.warn("Reached the round limit without a full pass — see progress.json for open gaps.");
  } finally {
    log.info("🛑", "Stopping the runtime…");
    await client.stop();
    log.info("👋", "Done.");
  }
}

main().catch((err) => {
  console.error(c.red("❌ harness crashed:"), err);
  process.exit(1);
});
