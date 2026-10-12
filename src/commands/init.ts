import { mkdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { Command } from "commander";
import { DEFAULT_VOICE } from "../catalog/voices.ts";
import { CliError } from "../lib/errors.ts";
import { exists, writeAtomic } from "../lib/fsx.ts";
import { emit, success } from "../lib/output.ts";
import { SONG_FILE } from "../lib/paths.ts";
import { bold, muted } from "../lib/style.ts";
import { parseKey, romanToChord } from "../model/chords.ts";
import { parseSongText } from "../model/io.ts";
import { STYLES, type StylePreset, findStyle } from "../styles/presets.ts";

/** Full song skeleton from a style: form as sections, one chord per bar, empty lead, empty parts. */
export function styledSong(
  style: StylePreset,
  opts: { title: string; voice: string; language: string; key?: string; tempo?: number },
): string {
  const key = opts.key ?? style.defaultKey;
  const { majorTonic } = parseKey(key);
  const tempo = opts.tempo ?? style.tempo.default;
  const sections: string[] = [];
  const chords: string[] = [];
  let bar = 1;
  for (const section of style.form) {
    sections.push(`  - { name: ${JSON.stringify(section.name)}, kind: ${section.kind}, at: "${bar}:1" }`);
    const prog = style.progressions[section.kind];
    for (let i = 0; i < section.bars; i++) {
      chords.push(`  - { at: "${bar + i}:1", chord: ${JSON.stringify(romanToChord(prog[i % prog.length]!, majorTonic))} }`);
    }
    bar += section.bars;
  }
  const colors = Object.entries(style.vocal.voiceColors)
    .map(([kind, color]) => `${kind}: ${color}`)
    .join(", ");
  return `# song.yaml — ${style.name} skeleton. Schema: \`vocaloid schema song\`.
# Pitch: C4 = MIDI 60. "bar:beat" positions are 1-based; numeric durations are quarter notes.
# 1) \`vocaloid arrange\` fills the instrument parts from the chords below.
# 2) Write the lead melody + lyrics (vocal range ${style.vocal.range}; voice colors: ${colors || "Root"}).
schemaVersion: 1
title: ${JSON.stringify(opts.title)}
style: ${style.id}
key: ${key}
tempo: ${tempo}
timeSignature: 4/4
end: "${bar}:1"
sections:
${sections.join("\n")}
chords:
${chords.join("\n")}
tracks:
  - id: lead
    kind: vocal
    voice: ${opts.voice}
    language: ${opts.language}
    notes: []
`;
}

/** A short, renderable starter: 2 bars of melody so `vocaloid render` works immediately. */
export function starterSong(title: string, voice: string, language: "ja" | "en"): string {
  const lyrics =
    language === "ja"
      ? ["き", "み", "の", "こ", "え", "が", "き", "こ", "え", "る"]
      : ["I", "can", "hear", "your", "voice", "+", "to", "night", "+", "+"];
  const melody = ["A4", "B4", "C#5", "E5", "F#5", "E5", "C#5", "B4", "A4", "A4"];
  const durs = ["1/8", "1/8", "1/8", "1/8", "1/4", "1/8", "1/8", "1/8", "1/8", "1/2"];
  let beat = 0;
  const notes = lyrics.map((lyric, i) => {
    const at = beat;
    const d = durs[i]!;
    const [n, m] = d.split("/").map(Number);
    beat += (n! / m!) * 4;
    return `      - { at: ${at}, pitch: ${melody[i]}, dur: "${d}", lyric: "${lyric}" }`;
  });
  return `# song.yaml — source of truth for vocaloid-cli. Schema: \`vocaloid schema song\`.
# Pitch: C4 = MIDI 60 (middle C). Numeric positions/durations are quarter notes;
# "bar:beat" positions are 1-based; "a/b" durations are fractions of a whole note.
schemaVersion: 1
title: ${JSON.stringify(title)}
key: A major
tempo: 150
timeSignature: 4/4
sections:
  - { name: intro, at: "1:1" }
tracks:
  - id: lead
    kind: vocal
    voice: ${voice}
    language: ${language}
    notes:
${notes.join("\n")}
    curves:
      dynamics:
        - { at: 0, value: 0 }
`;
}

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Create a new song directory with a renderable starter song.yaml")
    .argument("<dir>", "directory to create (or an existing empty one)")
    .option("--title <title>", "song title (defaults to the directory name)")
    .option("--voice <id>", "voice id for the lead track", DEFAULT_VOICE)
    .option("--language <lang>", "lyric language for the lead track: ja | en", "ja")
    .option("--style <id>", `scaffold a full song skeleton from a style preset (${STYLES.map((s) => s.id).join(", ")})`)
    .option("--key <key>", 'key for --style, e.g. "F# minor" (default: the style\'s)')
    .option("--tempo <bpm>", "tempo for --style (default: the style's)")
    .option("--force", "overwrite an existing song.yaml")
    .action(async (dir: string, opts: { title?: string; voice: string; language: string; style?: string; key?: string; tempo?: string; force?: boolean }) => {
      if (opts.language !== "ja" && opts.language !== "en") {
        throw new CliError({ code: "INVALID_ARGUMENT", message: "--language must be ja or en" });
      }
      const style = opts.style ? findStyle(opts.style) : undefined;
      if (opts.style && !style) throw new CliError({ code: "STYLE_NOT_FOUND", message: `No style "${opts.style}"`, hint: "vocaloid style list" });
      const abs = resolve(dir);
      const file = join(abs, SONG_FILE);
      if ((await exists(file)) && !opts.force) {
        throw new CliError({
          code: "SONG_EXISTS",
          message: `${file} already exists`,
          hint: `Use --force to overwrite, or edit it with \`vocaloid note add ${dir} ...\``,
        });
      }
      const title = opts.title ?? abs.split("/").pop() ?? "Untitled";
      let text: string;
      try {
        text = style
          ? styledSong(style, { title, voice: opts.voice, language: opts.language, key: opts.key, tempo: opts.tempo ? Number(opts.tempo) : undefined })
          : starterSong(title, opts.voice, opts.language);
      } catch (e) {
        throw new CliError({ code: "INVALID_ARGUMENT", message: e instanceof Error ? e.message : String(e) });
      }
      parseSongText(text, file); // the starter must always satisfy the schema
      await mkdir(abs, { recursive: true });
      await writeAtomic(file, text);
      const relPath = relative(process.cwd(), abs) || ".";
      const rel = relPath.length < abs.length ? relPath : abs;
      emit({
        data: { dir: abs, file, title, voice: opts.voice, language: opts.language, style: style?.id ?? null },
        human: (d) => `${success(`Created ${bold(d.file)}`)}\n${muted(`voice ${d.voice} · language ${d.language}`)}`,
        nextSteps: style
          ? [`vocaloid arrange ${rel}`, `vocaloid song inspect ${rel}`, `vocaloid note add ${rel} --track lead --params '[...]'`, `vocaloid render ${rel}`]
          : [`vocaloid song inspect ${rel}`, `vocaloid render ${rel}`, "vocaloid schema song"],
      });
    });
}
