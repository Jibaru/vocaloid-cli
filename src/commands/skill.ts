import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { CliError } from "../lib/errors.ts";
import { exists, writeAtomic } from "../lib/fsx.ts";
import { emit, success } from "../lib/output.ts";
import { bold, muted, ok, warn } from "../lib/style.ts";

/**
 * Installs the agent manual that matches this CLI version. The installed SKILL.md carries a
 * version marker; `skill status` (and `doctor`) report when the CLI moved on without it.
 */

const MARKER = /<!-- vocaloid-cli-skill v([\w.-]+) -->/;

async function resolveBundled(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, "..", "skills", "vocaloid"), join(here, "..", "..", "skills", "vocaloid")]) {
    if (await exists(join(candidate, "SKILL.md"))) return candidate;
  }
  throw new CliError({ code: "SKILL_NOT_BUNDLED", message: `Cannot find skills/vocaloid/SKILL.md near ${here}` });
}

export function skillTarget(agent: string, scope: string, dir?: string): string {
  if (dir) return resolve(dir);
  const base = scope === "project" ? process.cwd() : homedir();
  switch (agent) {
    case "claude":
      return join(base, ".claude", "skills", "vocaloid");
    case "codex":
      return join(base, ".codex", "skills", "vocaloid");
    case "agents":
      return join(base, ".agents", "skills", "vocaloid");
    default:
      throw new CliError({ code: "INVALID_ARGUMENT", message: `Unknown --agent "${agent}"`, hint: "Use claude, codex or agents, or pass --dir" });
  }
}

export async function installedSkillVersion(target: string): Promise<string | null> {
  try {
    return MARKER.exec(await readFile(join(target, "SKILL.md"), "utf8"))?.[1] ?? null;
  } catch {
    return null;
  }
}

export function registerSkill(program: Command): void {
  const skill = program.command("skill").description("Install the agent skill (manual) matching this CLI version");

  skill
    .command("install")
    .description("Copy the vocaloid skill into an agent's skills folder, stamped with this CLI version")
    .option("--agent <agent>", "claude | codex | agents", "claude")
    .option("--scope <scope>", "user (home directory) | project (current directory)", "user")
    .option("--dir <path>", "explicit target folder instead of --agent/--scope")
    .option("--dry-run", "show the target and files without writing")
    .action(async (opts: { agent: string; scope: string; dir?: string; dryRun?: boolean }) => {
      const source = await resolveBundled();
      const target = skillTarget(opts.agent, opts.scope, opts.dir);
      const files = (await readdir(source)).filter((f) => f.endsWith(".md"));
      const previous = await installedSkillVersion(target);
      if (!opts.dryRun) {
        for (const f of files) {
          let text = await readFile(join(source, f), "utf8");
          if (f === "SKILL.md") {
            // Marker goes after the frontmatter so the YAML header stays first.
            text = text.replace(/^(---\n[\s\S]*?\n---\n)/, `$1<!-- vocaloid-cli-skill v${pkg.version} -->\nWritten for vocaloid-cli ${pkg.version}. If \`vocaloid --version\` differs, run \`vocaloid skill install\` to refresh this skill.\n`);
          }
          await writeAtomic(join(target, f), text);
        }
      }
      emit({
        data: { dryRun: Boolean(opts.dryRun), target, files, version: pkg.version, previousVersion: previous },
        human: (d) =>
          d.dryRun
            ? `${warn("dry run")} would write ${d.files.join(", ")} to ${d.target}`
            : `${success(`Installed skill v${d.version} → ${bold(d.target)}`)}${d.previousVersion && d.previousVersion !== d.version ? muted(` (was v${d.previousVersion})`) : ""}`,
      });
    });

  skill
    .command("status")
    .description("Report whether the installed skill matches this CLI version")
    .option("--agent <agent>", "claude | codex | agents", "claude")
    .option("--scope <scope>", "user | project", "user")
    .option("--dir <path>", "explicit skill folder")
    .action(async (opts: { agent: string; scope: string; dir?: string }) => {
      const target = skillTarget(opts.agent, opts.scope, opts.dir);
      const installed = await installedSkillVersion(target);
      const upToDate = installed === pkg.version;
      emit({
        data: { target, installed, current: pkg.version, upToDate },
        human: (d) =>
          d.installed === null
            ? `${warn("not installed")} ${muted(d.target)}`
            : d.upToDate
              ? `${ok("up to date")} v${d.current} ${muted(d.target)}`
              : `${warn("outdated")} skill v${d.installed}, CLI v${d.current}`,
        nextSteps: upToDate ? [] : [`vocaloid skill install --agent ${opts.agent} --scope ${opts.scope}`],
      });
    });
}
