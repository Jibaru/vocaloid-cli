/**
 * The cli-build agent-first rules, enforced against the built binary (dist/cli.js) the way an
 * agent invokes it: piped stdout, no TTY. Each test names the rule it checks.
 * Run `bun run build` first; the suite fails loudly if dist/ is missing.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "dist", "cli.js");
const home = mkdtempSync(join(tmpdir(), "vocaloid-home-"));
const work = mkdtempSync(join(tmpdir(), "vocaloid-work-"));

function run(args: string[], env: Record<string, string> = {}) {
  const p = Bun.spawnSync(["node", CLI, ...args], {
    cwd: work,
    env: { ...process.env, VOCALOID_CLI_HOME: home, NO_COLOR: "", FORCE_COLOR: "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: p.exitCode, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: detecting ANSI
const ANSI = /\x1b\[/;

beforeAll(() => {
  expect(Bun.file(CLI).size).toBeGreaterThan(0);
});

describe("agent-first rules", () => {
  test("rule: JSON automatically when stdout is not a TTY", () => {
    const r = run(["init", "song-a"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.ok).toBe(true);
    expect(out.data.title).toBe("song-a");
    expect(out.meta.nextSteps.length).toBeGreaterThan(0);
  });

  test("rule: no ANSI escapes in machine output, even with FORCE_COLOR", () => {
    const r = run(["song", "inspect", "song-a"], { FORCE_COLOR: "1" });
    expect(ANSI.test(r.stdout)).toBe(false);
  });

  test("rule: schema command with a version field", () => {
    const r = run(["schema"]);
    const out = JSON.parse(r.stdout);
    expect(out.data.contractVersion).toBe("1");
    expect(out.data.commands.map((c: { name: string }) => c.name)).toContain("note add");
    const song = JSON.parse(run(["schema", "song"]).stdout);
    expect(song.data.jsonSchema.type).toBe("object");
  });

  test("rule: exit codes distinguish usage, invalid song and missing dependency", () => {
    expect(run(["song", "inspect", "does-not-exist"]).code).toBe(2);
    expect(run(["frobnicate"]).code).toBe(2);
    Bun.write(join(work, "bad", "song.yaml"), "schemaVersion: 1\ntitle: x\ntempo: 999\n");
    expect(run(["song", "validate", "bad"]).code).toBe(3);
    // Fresh VOCALOID_CLI_HOME: no engine installed.
    const r = run(["render", "song-a"]);
    expect(r.code).toBe(4);
    expect(JSON.parse(r.stdout).error.code).toBe("ENGINE_MISSING");
  });

  test("rule: errors carry code, message and an actionable hint", () => {
    const out = JSON.parse(run(["render", "song-a"]).stdout);
    expect(out.ok).toBe(false);
    expect(out.error.hint).toContain("vocaloid setup");
  });

  test("rule: data on stdout, diagnostics on stderr (usage errors never print help to stdout)", () => {
    const r = run(["note", "add", "song-a", "--bogus"]);
    expect(r.code).toBe(2);
    expect(JSON.parse(r.stdout).error.code).toBe("USAGE");
  });

  test("rule: bare invocation without a TTY returns the schema, exit 0", () => {
    const r = run([]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).data.contractVersion).toBe("1");
  });

  test("rule: --dry-run never writes", () => {
    const before = run(["note", "list", "song-a", "--track", "lead"]);
    const dry = run(["note", "add", "song-a", "--track", "lead", "--dry-run", "--params", '{"at":"3:1","pitch":"A4","dur":1,"lyric":"ら"}']);
    expect(JSON.parse(dry.stdout).data.dryRun).toBe(true);
    const after = run(["note", "list", "song-a", "--track", "lead"]);
    expect(after.stdout).toBe(before.stdout);
  });

  test("rule: edits are validated whole and backed up; undo restores", () => {
    const add = run(["note", "add", "song-a", "--track", "lead", "--params", '[{"at":"3:1","pitch":"A4","dur":1,"lyric":"ら"}]']);
    expect(JSON.parse(add.stdout).data.added[0].at).toBe("3:1");
    const count = (r: { stdout: string }) => JSON.parse(r.stdout).data.length;
    expect(count(run(["note", "list", "song-a"]))).toBe(11);
    expect(run(["undo", "song-a"]).code).toBe(0);
    expect(count(run(["note", "list", "song-a"]))).toBe(10);
  });

  test("rule: --fields filters machine output and rejects unknown fields", () => {
    const ok = JSON.parse(run(["song", "inspect", "song-a", "--fields", "title,bars"]).stdout);
    expect(Object.keys(ok.data)).toEqual(["title", "bars"]);
    expect(run(["song", "inspect", "song-a", "--fields", "nope"]).code).toBe(2);
  });
});
