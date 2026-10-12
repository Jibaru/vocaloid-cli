import { CliError, ExitCode } from "./errors.ts";
import { danger, muted, ok as okStyle, warn } from "./style.ts";

export const CONTRACT_VERSION = "1";

interface OutputContext {
  machine: boolean;
  fields?: string[];
}

const ctx: OutputContext = { machine: !process.stdout.isTTY };

/** Resolved once, from the root command hook. Non-TTY stdout always means JSON. */
export function configureOutput(opts: { json?: boolean; fields?: string }): void {
  ctx.machine = Boolean(opts.json) || !process.stdout.isTTY;
  ctx.fields = opts.fields
    ?.split(",")
    .map((f) => f.trim())
    .filter(Boolean);
}

export function isMachine(): boolean {
  return ctx.machine;
}

export interface Emit<T> {
  data: T;
  /** Human rendering. Omitted means a compact JSON dump for humans too. */
  human?: (data: T) => string;
  nextSteps?: string[];
  warnings?: string[];
}

function pickFields(data: unknown, fields: string[]): unknown {
  const pick = (obj: unknown): unknown => {
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return obj;
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      if (f in (obj as Record<string, unknown>)) out[f] = (obj as Record<string, unknown>)[f];
    }
    return out;
  };
  const unknownFields = (obj: unknown) =>
    obj && typeof obj === "object" && !Array.isArray(obj)
      ? fields.filter((f) => !(f in (obj as Record<string, unknown>)))
      : [];
  const sample = Array.isArray(data) ? data[0] : data;
  const missing = sample === undefined ? [] : unknownFields(sample);
  if (missing.length > 0) {
    throw new CliError({
      code: "UNKNOWN_FIELD",
      message: `Unknown field(s) for --fields: ${missing.join(", ")}`,
      hint: `Available: ${Object.keys(sample as object).join(", ")}`,
    });
  }
  return Array.isArray(data) ? data.map(pick) : pick(data);
}

export function emit<T>(out: Emit<T>): void {
  // --fields applies before the mode branch so agents and humans get the same filter.
  const data = ctx.fields?.length ? (pickFields(out.data, ctx.fields) as T) : out.data;
  if (ctx.machine) {
    const meta: Record<string, unknown> = { contractVersion: CONTRACT_VERSION };
    if (out.nextSteps?.length) meta.nextSteps = out.nextSteps;
    if (out.warnings?.length) meta.warnings = out.warnings;
    process.stdout.write(`${JSON.stringify({ ok: true, data, meta }, null, 2)}\n`);
    return;
  }
  const text = out.human && !ctx.fields?.length ? out.human(data) : JSON.stringify(data, null, 2);
  process.stdout.write(`${text}\n`);
  for (const w of out.warnings ?? []) process.stderr.write(`${okStyleWarn(w)}\n`);
  if (out.nextSteps?.length) {
    process.stderr.write(`\n${muted("Next:")}\n`);
    for (const step of out.nextSteps) process.stderr.write(`  ${muted("$")} ${step}\n`);
  }
}

function okStyleWarn(message: string): string {
  return `${warn("warning")} ${message}`;
}

export function emitError(err: unknown): number {
  const e =
    err instanceof CliError
      ? err
      : new CliError({
          code: "INTERNAL",
          message: err instanceof Error ? err.message : String(err),
          hint: "This is a bug in vocaloid-cli. Re-run with VOCALOID_DEBUG=1 for a stack trace.",
          exitCode: ExitCode.internal,
        });
  if (process.env.VOCALOID_DEBUG && err instanceof Error) process.stderr.write(`${err.stack}\n`);
  if (ctx.machine) {
    const error: Record<string, unknown> = { code: e.code, message: e.message };
    if (e.hint) error.hint = e.hint;
    if (e.details?.length) error.details = e.details;
    process.stdout.write(
      `${JSON.stringify({ ok: false, error, meta: { contractVersion: CONTRACT_VERSION } }, null, 2)}\n`,
    );
  } else {
    process.stderr.write(`${danger("error")} ${muted(e.code)} ${e.message}\n`);
    for (const d of e.details?.slice(0, 20) ?? []) {
      process.stderr.write(`  ${muted("•")} ${d.path ? `${d.path}: ` : ""}${d.message}\n`);
    }
    if (e.hint) process.stderr.write(`${muted(e.hint)}\n`);
  }
  return e.exitCode;
}

/** Progress and status lines for humans; always stderr, never in machine data. */
export function status(message: string): void {
  if (!ctx.machine) process.stderr.write(`${muted("›")} ${message}\n`);
}

export function success(message: string): string {
  return `${okStyle("✓")} ${message}`;
}
