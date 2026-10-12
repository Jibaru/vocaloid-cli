// Presentation primitives. One place decides whether color is allowed: shouldColor().
// Pattern follows cligentic's detect/style blocks (256-color, semantic names, visible width).

let colorOverride: boolean | undefined;

export function setColorEnabled(enabled: boolean | undefined): void {
  colorOverride = enabled;
}

/** Color only on an interactive stderr/stdout, never under NO_COLOR or machine mode. */
export function shouldColor(stream: NodeJS.WriteStream = process.stderr): boolean {
  if (colorOverride !== undefined) return colorOverride;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  return Boolean(stream.isTTY) && process.env.TERM !== "dumb";
}

const wrap =
  (open: string, close = "\x1b[0m") =>
  (text: string, stream?: NodeJS.WriteStream): string =>
    shouldColor(stream) ? `${open}${text}${close}` : text;

export const bold = wrap("\x1b[1m", "\x1b[22m");
export const dim = wrap("\x1b[2m", "\x1b[22m");
export const italic = wrap("\x1b[3m", "\x1b[23m");
// Semantic palette (256-color so themes cannot collapse red/green).
export const danger = wrap("\x1b[38;5;203m");
export const warn = wrap("\x1b[38;5;214m");
export const ok = wrap("\x1b[38;5;78m");
export const info = wrap("\x1b[38;5;117m");
export const muted = wrap("\x1b[38;5;245m");
export const accent = wrap("\x1b[38;5;44m"); // Miku teal, used for the banner only

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape matcher
const ANSI = /\x1b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

/** Width on screen, ignoring escapes. East Asian wide chars count as 2. */
export function visibleWidth(text: string): number {
  let width = 0;
  for (const char of stripAnsi(text)) {
    const cp = char.codePointAt(0) ?? 0;
    width += isWide(cp) ? 2 : 1;
  }
  return width;
}

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff)
  );
}

export function padVisible(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}

export function padStartVisible(text: string, width: number): string {
  return " ".repeat(Math.max(0, width - visibleWidth(text))) + text;
}

export interface Column<T> {
  header: string;
  get: (row: T) => string;
  align?: "left" | "right";
}

export function table<T>(rows: T[], columns: Column<T>[]): string {
  const cells = rows.map((row) => columns.map((c) => c.get(row)));
  const widths = columns.map((c, i) =>
    Math.max(visibleWidth(c.header), ...cells.map((r) => visibleWidth(r[i] ?? ""))),
  );
  const line = (values: string[]) =>
    values
      .map((v, i) => {
        const w = widths[i] ?? 0;
        return columns[i]?.align === "right" ? padStartVisible(v, w) : padVisible(v, w);
      })
      .join("  ")
      .trimEnd();
  const header = line(columns.map((c) => bold(c.header, process.stdout)));
  return [header, ...cells.map(line)].join("\n");
}
