import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import { CliError } from "../lib/errors.ts";
import { listHistory, writeAtomic } from "../lib/fsx.ts";
import { emit, success } from "../lib/output.ts";
import { HISTORY_DIR } from "../lib/paths.ts";
import { muted } from "../lib/style.ts";
import { resolveSongPath } from "../model/io.ts";

export function registerUndo(program: Command): void {
  program
    .command("undo")
    .description("Restore song.yaml to the version before the last edit (backups live in .history/)")
    .argument("[dir]", "song directory or song.yaml", ".")
    .option("--list", "list available backups instead of restoring")
    .action(async (dir: string, opts: { list?: boolean }) => {
      const { dir: songDir, file } = await resolveSongPath(dir);
      const historyDir = join(songDir, HISTORY_DIR);
      const entries = await listHistory(historyDir);
      if (opts.list) {
        emit({ data: entries.map((e) => ({ backup: join(historyDir, e) })), human: (d) => d.map((x) => x.backup).join("\n") || muted("(no backups)") });
        return;
      }
      const latest = entries.at(-1);
      if (!latest) throw new CliError({ code: "NOTHING_TO_UNDO", message: `No backups in ${historyDir}` });
      const path = join(historyDir, latest);
      await writeAtomic(file, await readFile(path));
      await rm(path);
      emit({
        data: { restored: path, file, remaining: entries.length - 1 },
        human: (d) => success(`Restored ${d.file} ${muted(`(${d.remaining} older backup(s) left)`)}`),
      });
    });
}
