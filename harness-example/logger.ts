/**
 * Console logging for the harness: color + emoji, so `node harness.ts` narrates
 * each step precisely. Colors auto-disable when output is not a TTY or NO_COLOR
 * is set.
 */

const NO_COLOR = !!process.env.NO_COLOR || !process.stdout.isTTY;
const paint = (code: number, s: string): string => (NO_COLOR ? s : `\x1b[${code}m${s}\x1b[0m`);

export const c = {
  bold: (s: string) => paint(1, s),
  dim: (s: string) => paint(2, s),
  cyan: (s: string) => paint(36, s),
  green: (s: string) => paint(32, s),
  yellow: (s: string) => paint(33, s),
  red: (s: string) => paint(31, s),
  gray: (s: string) => paint(90, s),
  magenta: (s: string) => paint(35, s),
  blue: (s: string) => paint(34, s),
};

const clip = (s: string, n = 100): string => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
};
const basename = (p: string): string => p.split(/[\\/]/).pop() || p;
// drop a leading `cd <dir>` (with && , ; or a newline) so bash lines read clean,
// not "bash cd /very/long/path && …"
const cleanCmd = (cmd: string): string =>
  cmd.replace(/^\s*cd\s+\S+\s*(?:&&|;)?\s*/i, "").replace(/\s+/g, " ").trim();

// Turn one tool call into a compact, color-coded line: emoji + short subject.
function toolLine(name: string, args: unknown): string {
  const a = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const str = (v: unknown): string => (typeof v === "string" ? v : "");

  if (name === "mark_feature_done") return c.green("✅ marked " + str(a.id) + " done");
  if (name === "update_progress") return c.blue("📝 progress noted");
  if (/bash|shell|terminal|exec/i.test(name)) {
    const cmd = cleanCmd(str(a.command) || str(a.cmd));
    return c.gray("💻 " + (clip(cmd, 56) || name));
  }
  if (/write|create/i.test(name)) return c.gray("✏️  write " + (basename(str(a.path)) || name));
  if (/edit|str_replace|apply/i.test(name)) return c.gray("✏️  edit " + (basename(str(a.path)) || name));
  if (/view|read|cat|open/i.test(name)) return c.gray("👀 read " + (basename(str(a.path)) || name));
  if (/grep|search|glob|find|list/i.test(name)) return c.gray("🔎 " + (str(a.pattern) || name));
  return c.gray("🔧 " + name);
}

export const log = {
  // Top-level milestones (rounds, start/finish).
  banner: (msg: string) => console.log("\n" + c.bold(c.magenta("━━━ " + msg + " ━━━"))),
  // A workflow phase within a round (building a feature, evaluating).
  phase: (emoji: string, msg: string) => console.log("\n" + emoji + "  " + c.bold(c.cyan(msg))),
  // A single labelled fact.
  info: (emoji: string, msg: string) => console.log(emoji + "  " + msg),
  // A bullet under a phase.
  item: (msg: string) => console.log("   " + c.dim("• " + msg)),
  // One tool the agent invoked.
  tool: (name: string, args: unknown) => console.log("   " + toolLine(name, args)),
  // A short line of the agent's own narration (skips raw JSON, e.g. evaluator output).
  say: (msg: string) => {
    const t = clip(msg, 96);
    if (t && !(t.startsWith("{") && t.endsWith("}"))) console.log("   " + c.dim("💬 " + t));
  },
  good: (msg: string) => console.log(c.green("✅ " + msg)),
  warn: (msg: string) => console.log(c.yellow("⚠️  " + msg)),
  // A bold sub-heading, e.g. "Try it yourself:".
  heading: (msg: string) => console.log("\n" + c.bold(msg)),
  // A copy-pasteable command (comments dimmed, commands in cyan).
  cmd: (line: string) => console.log("   " + (line.trimStart().startsWith("#") ? c.dim(line) : c.cyan(line))),
};
