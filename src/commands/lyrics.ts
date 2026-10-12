import type { Command } from "commander";
import { isMap } from "yaml";
import { CliError } from "../lib/errors.ts";
import { emit, success } from "../lib/output.ts";
import { bold, muted, table, warn } from "../lib/style.ts";
import { loadSong, saveSongDoc } from "../model/io.ts";
import { type LyricUnit, splitLyrics } from "../model/lyrics.ts";
import { pitchName, positionTicks } from "../model/music.ts";
import { notesSeq, parseIndices, trackIndex } from "./edit-helpers.ts";

function split(language: string, text: string): LyricUnit[] {
  const { units, unparsed } = splitLyrics(language, text);
  if (unparsed.length) {
    throw new CliError({
      code: "LYRICS_UNPARSED",
      message: `Cannot split ${unparsed.map((u) => `"${u}"`).join(", ")} into morae`,
      hint:
        language === "ja"
          ? "Write the reading in hiragana or romaji (kanji has no unambiguous reading), e.g. 君の声 → きみのこえ"
          : "Use letters only; hyphenate to force syllables (fi-re)",
    });
  }
  return units;
}

export function registerLyrics(program: Command): void {
  const lyrics = program.command("lyrics").description("Split lyric lines into per-note units and fit them onto notes");

  lyrics
    .command("split")
    .description("Show how a line divides into notes (one unit per note) without touching a song")
    .requiredOption("--text <text>", "lyric line")
    .option("--language <lang>", "ja | en | es | ko | zh | de", "ja")
    .action((opts: { text: string; language: string }) => {
      const units = split(opts.language, opts.text);
      emit({
        data: { language: opts.language, count: units.length, units: units.map((u) => u.text) },
        human: (d) => `${bold(String(d.count))} notes: ${d.units.join(" · ")}`,
      });
    });

  lyrics
    .command("fit")
    .description("Assign a lyric line to consecutive vocal notes (one unit per note), in position order")
    .argument("[dir]", "song directory or song.yaml", ".")
    .option("--track <id>", "vocal track id (optional if there is one track)")
    .requiredOption("--text <text>", "lyric line; Japanese in hiragana/romaji, English as words")
    .option("--from <pos>", 'first note at or after this position, e.g. "9:1"')
    .option("--index <list>", "exact note indices to fill, e.g. 12-19")
    .option("--partial", "allow fewer lyric units than target notes (remaining notes keep their lyric)")
    .option("--dry-run", "show the assignment without writing")
    .action(async (dir: string, opts: { track?: string; text: string; from?: string; index?: string; partial?: boolean; dryRun?: boolean }) => {
      const loaded = await loadSong(dir);
      const ti = trackIndex(loaded, opts.track);
      const track = loaded.compiled.tracks.find((t) => t.index === ti)!;
      if (track.kind !== "vocal") throw new CliError({ code: "NOT_A_VOCAL_TRACK", message: `"${track.id}" is not a vocal track` });
      const units = split(track.language, opts.text);
      const ordered = track.notes; // sorted by position
      let targets = ordered;
      let exact = false;
      if (opts.index) {
        const wanted = new Set(parseIndices(opts.index, notesSeq(loaded.doc, ti).items.length));
        targets = ordered.filter((n) => wanted.has(n.index));
        exact = true;
      } else if (opts.from) {
        const from = positionTicks(/^\d+(\.\d+)?$/.test(opts.from) ? Number(opts.from) : opts.from, loaded.compiled.grid);
        targets = ordered.filter((n) => n.tick >= from).slice(0, units.length);
      }
      if (units.length > targets.length || (exact && units.length < targets.length && !opts.partial)) {
        throw new CliError({
          code: "LYRICS_MISMATCH",
          message: `${units.length} lyric unit(s) for ${targets.length} note(s)`,
          hint:
            units.length > targets.length
              ? `Add ${units.length - targets.length} note(s), merge morae, or target more notes. Units: ${units.map((u) => u.text).join(" ")}`
              : "Add --partial to leave the remaining notes unchanged, or add more lyrics",
          details: [{ message: `units: ${units.map((u) => u.text).join(" ")}` }],
        });
      }
      const seq = notesSeq(loaded.doc, ti);
      const assigned = units.map((u, i) => {
        const n = targets[i]!;
        const node = seq.items[n.index];
        if (isMap(node)) node.set("lyric", u.text);
        return { index: n.index, at: loaded.compiled.grid.label(n.tick), pitch: pitchName(n.midi), from: n.lyric, lyric: u.text };
      });
      const saved = await saveSongDoc(loaded.file, loaded.dir, loaded.doc, { dryRun: opts.dryRun });
      const untouched = targets.length - units.length;
      emit({
        data: { dryRun: Boolean(opts.dryRun), track: track.id, assigned, untouchedNotes: untouched },
        warnings: [...saved.warnings, ...(untouched > 0 && !exact ? [`${untouched} note(s) after the line kept their old lyric`] : [])],
        human: (d) =>
          [
            d.dryRun ? warn("dry run — nothing written") : success(`Fitted ${d.assigned.length} unit(s) on ${bold(d.track)}`),
            table(d.assigned, [
              { header: "#", get: (r) => muted(String(r.index)), align: "right" },
              { header: "at", get: (r) => r.at },
              { header: "pitch", get: (r) => r.pitch },
              { header: "lyric", get: (r) => bold(r.lyric) },
              { header: "was", get: (r) => muted(r.from) },
            ]),
          ].join("\n"),
        nextSteps: opts.dryRun ? [] : [`vocaloid render ${dir} --only ${track.id}`],
      });
    });
}
