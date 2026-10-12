import type { Command } from "commander";
import { isMap, type YAMLMap } from "yaml";
import { CliError, ExitCode } from "../lib/errors.ts";
import { emit, success } from "../lib/output.ts";
import { bold, muted, table, warn } from "../lib/style.ts";
import { type LoadedSong, loadSong, saveSongDoc } from "../model/io.ts";
import { positionTicks } from "../model/music.ts";
import { generatePart } from "../styles/generate.ts";
import { type PartSpec, STYLES, type StylePreset, findStyle } from "../styles/presets.ts";
import { notesSeq, sortNotes, tracksSeq } from "./edit-helpers.ts";

function requireStyle(id: string | undefined, loaded?: LoadedSong): StylePreset {
  const styleId = id ?? loaded?.data.style;
  if (!styleId) {
    throw new CliError({
      code: "STYLE_REQUIRED",
      message: "No style given and song.yaml has no `style`",
      hint: `Pass --style <id> (${STYLES.map((s) => s.id).join(", ")}) or set style: in song.yaml`,
    });
  }
  const style = findStyle(styleId);
  if (!style) throw new CliError({ code: "STYLE_NOT_FOUND", message: `No style "${styleId}"`, hint: "vocaloid style list" });
  return style;
}

function describeStyle(s: StylePreset) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    tempo: s.tempo,
    defaultKey: s.defaultKey,
    form: s.form,
    bars: s.form.reduce((n, f) => n + f.bars, 0),
    progressions: s.progressions,
    vocal: s.vocal,
    parts: s.parts.map((p) => ({ id: p.id, generator: p.generator, instrument: p.instrument, volume: p.volume, pan: p.pan, patterns: p.patterns })),
    tips: s.tips,
  };
}

export function registerStyle(program: Command): void {
  const style = program.command("style").description("Style presets: tempo, form, progressions and accompaniment parts");

  style
    .command("list")
    .description("List style presets")
    .action(() => {
      emit({
        data: STYLES.map((s) => ({ id: s.id, name: s.name, tempo: s.tempo, description: s.description })),
        human: (d) =>
          table(d, [
            { header: "id", get: (s) => bold(s.id) },
            { header: "bpm", get: (s) => `${s.tempo.min}-${s.tempo.max}` },
            { header: "description", get: (s) => muted(s.description) },
          ]),
        nextSteps: ["vocaloid style show jrock-vocaloid", "vocaloid init my-song --style jrock-vocaloid"],
      });
    });

  style
    .command("show")
    .description("Show a preset in full: form, progressions per section, parts and patterns")
    .argument("<id>")
    .action((id: string) => {
      const s = requireStyle(id);
      emit({
        data: describeStyle(s),
        human: (d) =>
          [
            `${bold(d.name)} ${muted(`(${d.id})`)}`,
            muted(d.description),
            `${muted("tempo")} ${d.tempo.min}-${d.tempo.max} (default ${d.tempo.default})  ${muted("key")} ${d.defaultKey}  ${muted("vocal range")} ${d.vocal.range}`,
            `${muted("form")} ${d.form.map((f) => `${f.name}:${f.bars}`).join(" → ")} ${muted(`(${d.bars} bars)`)}`,
            "",
            ...Object.entries(d.progressions).map(([k, v]) => `  ${k.padEnd(10)} ${v.join(" – ")}`),
            "",
            ...d.parts.map((p) => `  ${bold(p.id.padEnd(9))} ${p.instrument} ${muted(`${p.generator}: verse ${p.patterns.verse}, chorus ${p.patterns.chorus}`)}`),
            "",
            ...d.tips.map((t) => `${muted("tip")} ${t}`),
          ].join("\n"),
      });
    });
}

export function registerArrange(program: Command): void {
  program
    .command("arrange")
    .description("Accompany the song (drums, bass, guitars, keys) from its chords + sections with a style preset. Tracks are generated at render time; --freeze writes the notes instead")
    .argument("[dir]", "song directory or song.yaml", ".")
    .option("--style <id>", "style preset (default: song.yaml `style`)")
    .option("--part <ids>", "comma-separated preset part ids, e.g. drums,bass (default: all parts)")
    .option("--freeze", "write the generated notes into song.yaml (to hand-edit them) instead of generating at render time")
    .option("--from <pos>", "with --freeze: start position (default: song start)")
    .option("--to <pos>", "with --freeze: end position, exclusive (default: song end)")
    .option("--replace", "with --freeze: replace existing notes of those tracks inside the range")
    .option("--dry-run", "show what would change without writing")
    .action(async (dir: string, opts: { style?: string; part?: string; freeze?: boolean; from?: string; to?: string; replace?: boolean; dryRun?: boolean }) => {
      const loaded = await loadSong(dir);
      const style = requireStyle(opts.style, loaded);
      const song = loaded.compiled;
      const wanted = opts.part?.split(",").map((s) => s.trim());
      const parts: PartSpec[] = wanted
        ? wanted.map((id) => {
            const p = style.parts.find((x) => x.id === id);
            if (!p) throw new CliError({ code: "PART_NOT_FOUND", message: `Style ${style.id} has no part "${id}"`, hint: `Parts: ${style.parts.map((x) => x.id).join(", ")}` });
            return p;
          })
        : style.parts;
      const needsChords = parts.some((p) => p.generator !== "drums");
      if (needsChords && song.chords.length === 0) {
        throw new CliError({
          code: "NO_CHORDS",
          message: "The song has no `chords`; bass, guitars and keys are generated from them",
          hint: 'Add chords to song.yaml, e.g. chords: [{ at: "1:1", chord: "F#m" }, { at: "2:1", chord: "D" }] (or `vocaloid init --style` scaffolds them)',
          exitCode: ExitCode.invalidSong,
        });
      }
      if (!opts.freeze) {
        const report: { track: string; instrument: string; created: boolean; generated: number }[] = [];
        for (const part of parts) {
          let ti = loaded.data.tracks.findIndex((t) => t.id === part.id);
          const created = ti < 0;
          if (created) {
            tracksSeq(loaded.doc).add(loaded.doc.createNode({ id: part.id, kind: "instrument", instrument: part.instrument, volume: part.volume, pan: part.pan, notes: [] }));
            ti = tracksSeq(loaded.doc).items.length - 1;
          } else if (loaded.data.tracks[ti]!.kind !== "instrument") {
            throw new CliError({ code: "TRACK_KIND_MISMATCH", message: `Track "${part.id}" exists but is not an instrument track` });
          }
          const generate: Record<string, string> = { part: part.id };
          if (opts.style && opts.style !== loaded.data.style) generate.style = style.id;
          loaded.doc.setIn(["tracks", ti, "generate"], loaded.doc.createNode(generate, { flow: true }));
          report.push({ track: part.id, instrument: part.instrument, created, generated: 0 });
        }
        if (!loaded.data.style) loaded.doc.set("style", style.id);
        const saved = await saveSongDoc(loaded.file, loaded.dir, loaded.doc, { dryRun: opts.dryRun });
        for (const r of report) {
          const t = saved.compiled.tracks.find((x) => x.id === r.track);
          r.generated = t?.kind === "instrument" ? (t.generated?.notes ?? 0) : 0;
        }
        emit({
          data: { dryRun: Boolean(opts.dryRun), mode: "generate", style: style.id, parts: report },
          warnings: saved.warnings,
          human: (d) =>
            [
              d.dryRun ? warn("dry run — nothing written") : success(`Arranged with ${bold(d.style)} ${muted("(generated at render time; edit chords/sections and re-render)")}`),
              table(d.parts, [
                { header: "track", get: (p) => bold(p.track) },
                { header: "instrument", get: (p) => p.instrument },
                { header: "notes", get: (p) => String(p.generated), align: "right" },
                { header: "", get: (p) => muted(p.created ? "new track" : "") },
              ]),
            ].join("\n"),
          nextSteps: opts.dryRun ? [`vocaloid arrange ${dir}${opts.style ? ` --style ${style.id}` : ""}`] : [`vocaloid render ${dir}`],
        });
        return;
      }

      const grid = song.grid;
      const toTick = (v: string) => positionTicks(/^\d+(\.\d+)?$/.test(v) ? Number(v) : v, grid);
      const from = opts.from ? toTick(opts.from) : 0;
      const to = opts.to ? toTick(opts.to) : song.endTick;
      if (to <= from) throw new CliError({ code: "EMPTY_RANGE", message: "Nothing to arrange: the range is empty (song has no length yet?)", hint: "Add chords or set `end:` in song.yaml" });

      const report: { track: string; instrument: string; created: boolean; generated: number; replaced: number }[] = [];
      const warnings: string[] = [];
      for (const part of parts) {
        let ti = loaded.data.tracks.findIndex((t) => t.id === part.id);
        let created = false;
        if (ti < 0) {
          tracksSeq(loaded.doc).add(
            loaded.doc.createNode({ id: part.id, kind: "instrument", instrument: part.instrument, volume: part.volume, pan: part.pan, notes: [] }),
          );
          ti = tracksSeq(loaded.doc).items.length - 1;
          created = true;
        } else if (loaded.data.tracks[ti]!.kind !== "instrument") {
          throw new CliError({ code: "TRACK_KIND_MISMATCH", message: `Track "${part.id}" exists but is not an instrument track` });
        }
        const seq = notesSeq(loaded.doc, ti);
        const inRange = seq.items.filter((n) => {
          if (!isMap(n)) return false;
          const at = (n as YAMLMap).toJSON().at;
          try {
            const t = positionTicks(at, grid);
            return t >= from && t < to;
          } catch {
            return false;
          }
        });
        if (inRange.length > 0 && !opts.replace) {
          throw new CliError({
            code: "NOTES_IN_RANGE",
            message: `Track "${part.id}" already has ${inRange.length} note(s) in the range`,
            hint: "Add --replace to regenerate them, or narrow with --from/--to",
          });
        }
        seq.items = seq.items.filter((n) => !inRange.includes(n));
        // Frozen notes replace generation for this track.
        loaded.doc.deleteIn(["tracks", ti, "generate"]);
        const result = generatePart(song, part, from, to);
        warnings.push(...result.warnings);
        for (const n of result.notes) seq.add(loaded.doc.createNode(n, { flow: true }));
        sortNotes(seq, grid);
        report.push({ track: part.id, instrument: part.instrument, created, generated: result.notes.length, replaced: inRange.length });
      }
      if (!loaded.data.style) loaded.doc.set("style", style.id);
      const saved = await saveSongDoc(loaded.file, loaded.dir, loaded.doc, { dryRun: opts.dryRun });
      const uniqueWarnings = [...new Set([...warnings, ...saved.warnings])];
      emit({
        data: { dryRun: Boolean(opts.dryRun), mode: "freeze", style: style.id, range: { from: grid.label(from), to: grid.label(to) }, parts: report },
        warnings: uniqueWarnings,
        human: (d) =>
          [
            d.dryRun ? warn("dry run — nothing written") : success(`Arranged ${bold(d.style)} from ${d.range.from} to ${d.range.to}`),
            table(d.parts, [
              { header: "track", get: (p) => bold(p.track) },
              { header: "instrument", get: (p) => p.instrument },
              { header: "notes", get: (p) => String(p.generated), align: "right" },
              { header: "", get: (p) => muted([p.created ? "new track" : "", p.replaced ? `replaced ${p.replaced}` : ""].filter(Boolean).join(", ")) },
            ]),
          ].join("\n"),
        nextSteps: opts.dryRun ? [`vocaloid arrange ${dir} --style ${style.id}${opts.replace ? " --replace" : ""}`] : [`vocaloid render ${dir}`],
      });
    });
}
