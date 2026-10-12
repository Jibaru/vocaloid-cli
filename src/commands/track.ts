import type { Command } from "commander";
import { isMap } from "yaml";
import { DEFAULT_VOICE } from "../catalog/voices.ts";
import { CliError } from "../lib/errors.ts";
import { emit, success } from "../lib/output.ts";
import { bold, muted, warn } from "../lib/style.ts";
import { loadSong, saveSongDoc } from "../model/io.ts";
import { CURVE_NAMES, type CurveName } from "../model/song.ts";
import { summarize } from "./song.ts";
import { parseJsonInput, trackIndex, tracksSeq } from "./edit-helpers.ts";

export function registerTrack(program: Command): void {
  const track = program.command("track").description("Add, edit, list and remove tracks");

  track
    .command("list")
    .description("List tracks with kind, sound, note count and mix settings")
    .argument("[dir]", "song directory or song.yaml", ".")
    .action(async (dir: string) => {
      const loaded = await loadSong(dir);
      const tracks = summarize(loaded.compiled).tracks;
      emit({
        data: tracks,
        human: (d) => d.map((t) => `${bold(t.id)} ${muted(t.kind)} ${"voice" in t ? t.voice : t.instrument} ${muted(`${t.notes} notes`)}`).join("\n"),
      });
    });

  track
    .command("add")
    .description("Add a vocal or instrument track")
    .argument("[dir]", "song directory or song.yaml", ".")
    .requiredOption("--id <id>", "track slug, e.g. lead, harmony, bass, drums")
    .requiredOption("--kind <kind>", "vocal | instrument")
    .option("--voice <id>", "voice for vocal tracks", DEFAULT_VOICE)
    .option("--language <lang>", "lyric language for vocal tracks", "ja")
    .option("--instrument <name>", 'GM program name/number or "drums" for instrument tracks')
    .option("--volume <db>", "gain in dB", "0")
    .option("--pan <n>", "-100 (left) .. 100 (right)", "0")
    .option("--dry-run", "validate without writing")
    .action(async (dir: string, opts: { id: string; kind: string; voice: string; language: string; instrument?: string; volume: string; pan: string; dryRun?: boolean }) => {
      const loaded = await loadSong(dir);
      const entry: Record<string, unknown> = { id: opts.id, kind: opts.kind };
      if (opts.kind === "vocal") {
        Object.assign(entry, { voice: opts.voice, language: opts.language });
      } else if (opts.kind === "instrument") {
        if (!opts.instrument) throw new CliError({ code: "MISSING_ARGUMENT", message: "--instrument is required for instrument tracks", hint: "vocaloid schema instruments" });
        entry.instrument = /^\d+$/.test(opts.instrument) ? Number(opts.instrument) : opts.instrument;
      } else {
        throw new CliError({ code: "INVALID_ARGUMENT", message: "--kind must be vocal or instrument" });
      }
      if (Number(opts.volume) !== 0) entry.volume = Number(opts.volume);
      if (Number(opts.pan) !== 0) entry.pan = Number(opts.pan);
      entry.notes = [];
      tracksSeq(loaded.doc).add(loaded.doc.createNode(entry));
      const saved = await saveSongDoc(loaded.file, loaded.dir, loaded.doc, { dryRun: opts.dryRun });
      emit({
        data: { dryRun: Boolean(opts.dryRun), track: entry, trackCount: saved.data.tracks.length },
        human: (d) => (d.dryRun ? warn("dry run — nothing written") : success(`Added track ${bold(opts.id)}`)),
        nextSteps: [`vocaloid note add ${dir} --track ${opts.id} --params '[...]'`],
      });
    });

  track
    .command("edit")
    .description('Change track fields, e.g. --set \'{"volume":-3,"pan":-20,"voiceColor":"Fragrance"}\'')
    .argument("[dir]", "song directory or song.yaml", ".")
    .requiredOption("--track <id>", "track id")
    .requiredOption("--set <json>", "fields to set; null removes a field (notes cannot be set here)")
    .option("--dry-run", "validate without writing")
    .action(async (dir: string, opts: { track: string; set: string; dryRun?: boolean }) => {
      const loaded = await loadSong(dir);
      const ti = trackIndex(loaded, opts.track);
      const patch = parseJsonInput("--set", opts.set) as Record<string, unknown>;
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new CliError({ code: "INVALID_ARGUMENT", message: "--set must be a JSON object" });
      if ("notes" in patch) throw new CliError({ code: "INVALID_ARGUMENT", message: "Use `vocaloid note` commands to change notes" });
      const node = tracksSeq(loaded.doc).items[ti];
      if (!isMap(node)) throw new CliError({ code: "INVALID_SONG", message: `tracks[${ti}] is not a mapping` });
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) node.delete(k);
        else node.set(k, loaded.doc.createNode(v));
      }
      await saveSongDoc(loaded.file, loaded.dir, loaded.doc, { dryRun: opts.dryRun });
      emit({
        data: { dryRun: Boolean(opts.dryRun), track: opts.track, set: patch },
        human: (d) => (d.dryRun ? warn("dry run — nothing written") : success(`Updated ${bold(d.track)}`)),
      });
    });

  track
    .command("remove")
    .description("Remove a track and all its notes")
    .argument("[dir]", "song directory or song.yaml", ".")
    .requiredOption("--track <id>", "track id")
    .option("--dry-run", "show what would be removed without writing")
    .action(async (dir: string, opts: { track: string; dryRun?: boolean }) => {
      const loaded = await loadSong(dir);
      const ti = trackIndex(loaded, opts.track);
      const notes = loaded.data.tracks[ti]!.notes.length;
      tracksSeq(loaded.doc).items.splice(ti, 1);
      await saveSongDoc(loaded.file, loaded.dir, loaded.doc, { dryRun: opts.dryRun });
      emit({
        data: { dryRun: Boolean(opts.dryRun), removed: opts.track, notes },
        human: (d) => (d.dryRun ? warn(`dry run — would remove ${d.removed} (${d.notes} notes)`) : success(`Removed ${bold(d.removed)} (${d.notes} notes)`)),
        nextSteps: opts.dryRun ? [] : ["vocaloid undo"],
      });
    });

  // Curves live under the track, so `param` is a thin, discoverable alias over track curves.
  const param = program.command("param").description("Set and list vocal automation curves (dynamics, pitchBend, breathiness, gender, tension, voicing)");

  param
    .command("list")
    .description("List the curves on a vocal track")
    .argument("[dir]", "song directory or song.yaml", ".")
    .option("--track <id>", "track id")
    .action(async (dir: string, opts: { track?: string }) => {
      const loaded = await loadSong(dir);
      const ti = trackIndex(loaded, opts.track);
      const t = loaded.compiled.tracks.find((x) => x.index === ti)!;
      if (t.kind !== "vocal") throw new CliError({ code: "NOT_A_VOCAL_TRACK", message: `"${t.id}" is not a vocal track` });
      const grid = loaded.compiled.grid;
      const data = Object.fromEntries(
        CURVE_NAMES.map((name) => [name, (t.curves[name] ?? []).map((p) => ({ at: grid.label(p.tick), value: p.value }))]),
      );
      emit({
        data,
        human: (d) =>
          Object.entries(d)
            .map(([k, pts]) => `${bold(k.padEnd(12))} ${pts.length ? pts.map((p) => `${p.at}=${p.value}`).join("  ") : muted("—")}`)
            .join("\n"),
      });
    });

  param
    .command("set")
    .description("Replace one curve with the given points (linear interpolation between points)")
    .argument("[dir]", "song directory or song.yaml", ".")
    .option("--track <id>", "track id")
    .requiredOption("--curve <name>", CURVE_NAMES.join(" | "))
    .requiredOption("--points <json>", 'e.g. \'[{"at":"1:1","value":0},{"at":"9:1","value":40}]\'; [] clears the curve')
    .option("--dry-run", "validate without writing")
    .action(async (dir: string, opts: { track?: string; curve: string; points: string; dryRun?: boolean }) => {
      if (!(CURVE_NAMES as readonly string[]).includes(opts.curve)) {
        throw new CliError({ code: "UNKNOWN_CURVE", message: `Unknown curve "${opts.curve}"`, hint: `Curves: ${CURVE_NAMES.join(", ")}` });
      }
      const loaded = await loadSong(dir);
      const ti = trackIndex(loaded, opts.track);
      if (loaded.data.tracks[ti]!.kind !== "vocal") throw new CliError({ code: "NOT_A_VOCAL_TRACK", message: "Curves apply to vocal tracks" });
      const points = parseJsonInput("--points", opts.points);
      if (!Array.isArray(points)) throw new CliError({ code: "INVALID_ARGUMENT", message: "--points must be a JSON array" });
      const path = ["tracks", ti, "curves", opts.curve as CurveName];
      if (points.length === 0) loaded.doc.deleteIn(path);
      else loaded.doc.setIn(path, loaded.doc.createNode(points.map((p) => loaded.doc.createNode(p, { flow: true }))));
      await saveSongDoc(loaded.file, loaded.dir, loaded.doc, { dryRun: opts.dryRun });
      emit({
        data: { dryRun: Boolean(opts.dryRun), track: loaded.data.tracks[ti]!.id, curve: opts.curve, points: points.length },
        human: (d) => (d.dryRun ? warn("dry run — nothing written") : success(`Set ${bold(d.curve)} on ${d.track} (${d.points} points)`)),
      });
    });
}
