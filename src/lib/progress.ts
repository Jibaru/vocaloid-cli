import { isMachine } from "./output.ts";
import { muted } from "./style.ts";

/**
 * Progress always goes to stderr. Humans get a redrawn line on a TTY; `--progress json`
 * emits NDJSON events ({"event":"progress",...}) that an agent can stream; otherwise silent.
 */

let mode: "auto" | "json" | "none" = "auto";

export function setProgressMode(value: string | undefined): void {
  if (value === "json" || value === "none" || value === "auto") mode = value;
}

export interface ProgressEvent {
  task: string;
  done: number;
  total?: number;
  unit?: "bytes" | "tracks" | "steps";
  message?: string;
}

let lastDraw = 0;
const lastPercent = new Map<string, number>();

export function progress(ev: ProgressEvent): void {
  if (mode === "json") {
    // At most one event per task per whole percent (plus the first and last): a 550 MB download
    // would otherwise stream ~20k lines into the agent's context.
    const pct = ev.total ? Math.floor((ev.done / ev.total) * 100) : ev.done;
    if (lastPercent.get(ev.task) === pct && !(ev.total !== undefined && ev.done >= ev.total)) return;
    lastPercent.set(ev.task, pct);
    process.stderr.write(`${JSON.stringify({ event: "progress", ...ev })}\n`);
    return;
  }
  if (mode === "none" || isMachine() || !process.stderr.isTTY) return;
  const now = Date.now();
  const finished = ev.total !== undefined && ev.done >= ev.total;
  if (!finished && now - lastDraw < 100) return;
  lastDraw = now;
  const fmt = (n: number) => (ev.unit === "bytes" ? `${(n / 1e6).toFixed(1)} MB` : String(n));
  const pct = ev.total ? ` ${Math.floor((ev.done / ev.total) * 100)}%` : "";
  const bar = ev.total ? ` ${renderBar(ev.done / ev.total)}` : "";
  const of = ev.total ? `/${fmt(ev.total)}` : "";
  process.stderr.write(`\r\x1b[2K${muted("›")} ${ev.task}${bar} ${fmt(ev.done)}${of}${pct}${ev.message ? ` ${muted(ev.message)}` : ""}`);
  if (finished) process.stderr.write("\n");
}

function renderBar(ratio: number, width = 24): string {
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * width);
  return `${"█".repeat(filled)}${muted("░".repeat(width - filled))}`;
}

export function step(task: string, message: string): void {
  if (mode === "json") {
    process.stderr.write(`${JSON.stringify({ event: "step", task, message })}\n`);
    return;
  }
  if (mode === "none" || isMachine()) return;
  process.stderr.write(`${muted("›")} ${task} ${muted(message)}\n`);
}
