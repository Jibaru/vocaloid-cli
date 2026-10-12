import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { Command } from "commander";
import { XMLParser } from "fast-xml-parser";
import { type VocaloidSinger, allSingers, readLocalSingers, writeLocalSingers } from "../catalog/singers.ts";
import { readVpr } from "../formats/vpr.ts";
import { CliError } from "../lib/errors.ts";
import { emit, success } from "../lib/output.ts";
import { bold, muted, table } from "../lib/style.ts";

const COMP_ID = /^[A-Z0-9]{16}$/;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

async function addSingers(entries: VocaloidSinger[]): Promise<{ added: VocaloidSinger[]; skipped: string[] }> {
  const existing = await allSingers();
  const local = await readLocalSingers();
  const added: VocaloidSinger[] = [];
  const skipped: string[] = [];
  for (const e of entries) {
    if (existing.some((s) => s.compID === e.compID) || added.some((s) => s.compID === e.compID)) {
      skipped.push(e.name);
      continue;
    }
    let id = e.id;
    let n = 2;
    while (existing.some((s) => s.id === id) || added.some((s) => s.id === id)) id = `${e.id}-${n++}`;
    added.push({ ...e, id });
  }
  if (added.length) await writeLocalSingers([...local, ...added]);
  return { added, skipped };
}

export function registerSinger(program: Command): void {
  const singer = program.command("singer").description("VOCALOID singers (compIDs) used when exporting .vpr/.vsqx");

  singer
    .command("list")
    .description("List known VOCALOID singers")
    .action(async () => {
      const rows = await allSingers();
      emit({
        data: rows,
        human: (d) =>
          table(d, [
            { header: "id", get: (s) => bold(s.id) },
            { header: "name", get: (s) => s.name },
            { header: "compID", get: (s) => muted(s.compID) },
            { header: "type", get: (s) => (s.ai ? "AI" : "classic") },
          ]),
        nextSteps: ["vocaloid singer import <a .vpr/.vsqx saved by your VOCALOID editor>"],
      });
    });

  singer
    .command("add")
    .description("Register a singer by compID (16 uppercase letters/digits, e.g. from a project file)")
    .requiredOption("--comp-id <id>", "VOCALOID compID")
    .requiredOption("--name <name>", "display name, e.g. 'Hatsune Miku V6'")
    .option("--id <slug>", "id for --singer (default: from the name)")
    .option("--ai", "VOCALOID:AI voice (VOCALOID6 AI track)")
    .action(async (opts: { compId: string; name: string; id?: string; ai?: boolean }) => {
      if (!COMP_ID.test(opts.compId)) throw new CliError({ code: "INVALID_COMP_ID", message: `"${opts.compId}" is not a 16-character compID` });
      const { added, skipped } = await addSingers([
        { id: opts.id ?? slug(opts.name), name: opts.name, compID: opts.compId, ai: Boolean(opts.ai), source: "user" },
      ]);
      if (!added.length) throw new CliError({ code: "SINGER_EXISTS", message: `${skipped.join(", ")} is already registered` });
      emit({ data: added[0]!, human: (d) => success(`Added ${bold(d.id)} (${d.compID})`), nextSteps: [`vocaloid song export . --format vpr --singer ${added[0]!.id}`] });
    });

  singer
    .command("import")
    .description("Read the singers (compID + name) out of a .vpr or .vsqx saved by your VOCALOID editor")
    .argument("<file>")
    .action(async (file: string) => {
      const ext = extname(file).toLowerCase();
      const bytes = new Uint8Array(await readFile(file).catch(() => {
        throw new CliError({ code: "FILE_NOT_FOUND", message: `Cannot read ${file}` });
      }));
      let found: VocaloidSinger[] = [];
      if (ext === ".vpr") {
        const seq = readVpr(bytes);
        const aiIds = new Set(
          (seq.tracks ?? []).flatMap((t) => (t.parts ?? []).flatMap((p) => (p.aiVoice ? [p.aiVoice.compID] : []))),
        );
        found = (seq.voices ?? []).map((v) => ({ id: slug(v.name), name: v.name, compID: v.compID, ai: aiIds.has(v.compID), source: file }));
      } else if (ext === ".vsqx") {
        const doc = new XMLParser({ cdataPropName: false }).parse(new TextDecoder().decode(bytes)) as Record<string, { vVoiceTable?: { vVoice?: unknown } }>;
        const root = doc.vsq4 ?? doc.vsq3;
        const voices = root?.vVoiceTable?.vVoice;
        const list = (Array.isArray(voices) ? voices : voices ? [voices] : []) as Record<string, string>[];
        found = list.map((v) => {
          const name = String(v.name ?? v.vVoiceName);
          return { id: slug(name), name, compID: String(v.id ?? v.compID), ai: false, source: file };
        });
      } else {
        throw new CliError({ code: "UNKNOWN_FORMAT", message: "Expected a .vpr or .vsqx file" });
      }
      found = found.filter((s) => COMP_ID.test(s.compID));
      if (!found.length) throw new CliError({ code: "NO_SINGERS", message: `No singers with a valid compID in ${file}` });
      const { added, skipped } = await addSingers(found);
      emit({
        data: { added, alreadyKnown: skipped },
        human: (d) => [success(`Imported ${d.added.length} singer(s)`), ...d.added.map((s) => `  ${bold(s.id)} ${s.name} ${muted(s.compID)}`), ...(d.alreadyKnown.length ? [muted(`already known: ${d.alreadyKnown.join(", ")}`)] : [])].join("\n"),
      });
    });
}
