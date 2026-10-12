import type { Command, Option } from "commander";
import { z } from "zod";
import { GM_PROGRAMS } from "../catalog/instruments.ts";
import { CliError, ExitCode } from "../lib/errors.ts";
import { CONTRACT_VERSION, emit } from "../lib/output.ts";
import { bold, muted } from "../lib/style.ts";
import { DRUM_MAP } from "../model/music.ts";
import { CURVE_NAMES, SONG_SCHEMA_VERSION, Song } from "../model/song.ts";

/** Output shapes per command (the `data` field of the envelope). Flags come from Commander itself. */
const OUTPUTS: Record<string, string> = {
  init: "{dir, file, title, voice, language, style}",
  render: "{song, dir, mix:{wav, mp3, durationSeconds, loudnessLufs}, stems:[{track, path, cached}], projectFiles:{ustx, midi}, credits:{file, voices}, warnings, elapsedSeconds}",
  "song validate": "{valid, file, warnings}",
  "song inspect": "{title, artist, key, tempo:[{at,bpm}], timeSignatures, bars, durationSeconds, sections, tracks:[{id, kind, notes, range, start, voice?, language?, lyrics?, instrument?, volume, pan, mute}]}",
  "song export": "{format, file, bytes, warnings}",
  "song import": "{file, source, tracks:[{id, notes}], warnings}",
  "singer list": "[{id, name, compID, ai, source}]",
  "singer add": "{id, name, compID, ai, source}",
  "singer import": "{added:[singer], alreadyKnown:[name]}",
  "track list": "[{id, kind, notes, range, ...}]",
  "track add": "{dryRun, track, trackCount}",
  "track edit": "{dryRun, track, set}",
  "track remove": "{dryRun, removed, notes}",
  "note list": "[{index, at, beat, pitch, midi, dur, lyric, velocity}]",
  "note add": "{dryRun, track, added:[note rows], noteCount}",
  "note edit": "{dryRun, track, before:[note rows], after:[note rows]}",
  "note delete": "{dryRun, track, removed:[note rows]}",
  "param list": "{dynamics:[{at,value}], pitchBend, breathiness, gender, tension, voicing}",
  "param set": "{dryRun, track, curve, points}",
  "voice list": "[{id, name, source, type, installed, languages, voiceColors, commercial, credit, licenseSummary, timbre, downloadBytes}]",
  "voice show": "{...voice list row, phonemizers, termsUrl}",
  "voice install": "{id, installed, path, downloaded, credit} | dry run {id, installed, wouldDownloadBytes, source, license}",
  "voice add": "{id, name, type, singerId, phonemizers, voiceColors, license}",
  setup: "{home, dryRun, ready, downloadBytes, actions:[{item, status, bytes?, detail?, fix?}]}",
  doctor: "{healthy, home, checks:[{name, ok, detail, fix?, required}]} (exit 4 when a required check fails)",
  undo: "{restored, file, remaining}",
  "skill install": "{dryRun, target, files, version, previousVersion}",
  "skill status": "{target, installed, current, upToDate}",
  "style list": "[{id, name, tempo:{min,max,default}, description}]",
  "style show": "{id, name, description, tempo, defaultKey, form:[{name, kind, bars}], bars, progressions:{<sectionKind>:[roman]}, vocal:{range, voiceColors}, parts:[{id, generator, instrument, volume, pan, patterns}], tips}",
  arrange: "{dryRun, mode:'generate'|'freeze', style, parts:[{track, instrument, created, generated, replaced?}], range?}",
  "lyrics split": "{language, count, units:[string]}",
  "lyrics fit": "{dryRun, track, assigned:[{index, at, pitch, from, lyric}], untouchedNotes}",
  schema: "this document",
};

interface CommandSpec {
  name: string;
  description: string;
  arguments: { name: string; required: boolean; description: string }[];
  options: { flags: string; description: string; default?: unknown; required: boolean }[];
  output?: string;
}

function walk(cmd: Command, prefix: string[] = []): CommandSpec[] {
  const out: CommandSpec[] = [];
  for (const sub of cmd.commands) {
    const path = [...prefix, sub.name()];
    if (sub.commands.length > 0) {
      out.push(...walk(sub, path));
      continue;
    }
    const name = path.join(" ");
    out.push({
      name,
      description: sub.description(),
      arguments: sub.registeredArguments.map((a) => ({ name: a.name(), required: a.required, description: a.description })),
      options: (sub.options as Option[]).map((o) => ({
        flags: o.flags,
        description: o.description,
        default: o.defaultValue,
        required: Boolean(o.mandatory),
      })),
      output: OUTPUTS[name],
    });
  }
  return out;
}

export function registerSchema(program: Command): void {
  program
    .command("schema")
    .description("Machine-readable contract: commands, song.yaml JSON Schema, instruments, exit codes")
    .argument("[topic]", "song | instruments | exit-codes | <command name, e.g. 'note add'>")
    .action((topic: string | undefined) => {
      const commands = walk(program);
      const base = { contractVersion: CONTRACT_VERSION, songSchemaVersion: SONG_SCHEMA_VERSION };
      if (!topic) {
        emit({
          data: {
            ...base,
            envelope: {
              success: "{ok:true, data, meta:{contractVersion, nextSteps?, warnings?}}",
              error: "{ok:false, error:{code, message, hint?, details?:[{path, message}]}, meta}",
              machineMode: "JSON whenever stdout is not a TTY or --json is passed",
            },
            exitCodes: ExitCode,
            commands,
            topics: ["song", "instruments", "exit-codes", ...commands.map((c) => c.name)],
          },
          human: (d) =>
            [
              `${bold("vocaloid")} contract v${d.contractVersion} · song schema v${d.songSchemaVersion}`,
              "",
              ...d.commands.map((c) => `  ${bold(c.name.padEnd(16))} ${muted(c.description)}`),
              "",
              muted("vocaloid schema song | instruments | exit-codes | \"<command>\""),
            ].join("\n"),
        });
        return;
      }
      if (topic === "song") {
        emit({ data: { ...base, curves: CURVE_NAMES, jsonSchema: z.toJSONSchema(Song, { io: "input", unrepresentable: "any" }) } });
        return;
      }
      if (topic === "instruments") {
        emit({ data: { programs: GM_PROGRAMS.map((name, program) => ({ program, name })), drums: DRUM_MAP } });
        return;
      }
      if (topic === "exit-codes") {
        emit({ data: ExitCode });
        return;
      }
      const spec = commands.find((c) => c.name === topic || c.name.replace(" ", "-") === topic);
      if (!spec) {
        throw new CliError({ code: "UNKNOWN_TOPIC", message: `No schema topic "${topic}"`, hint: "Run `vocaloid schema` for the list" });
      }
      emit({ data: { ...base, ...spec } });
    });
}
