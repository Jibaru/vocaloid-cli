import { Command, CommanderError } from "commander";
import pkg from "../package.json" with { type: "json" };
import { registerArrange, registerStyle } from "./commands/arrange.ts";
import { registerInit } from "./commands/init.ts";
import { registerLyrics } from "./commands/lyrics.ts";
import { registerNote } from "./commands/note.ts";
import { registerRender } from "./commands/render.ts";
import { registerSchema } from "./commands/schema.ts";
import { registerSinger } from "./commands/singer.ts";
import { registerSkill } from "./commands/skill.ts";
import { registerSetup } from "./commands/setup.ts";
import { registerSong } from "./commands/song.ts";
import { registerTrack } from "./commands/track.ts";
import { registerUndo } from "./commands/undo.ts";
import { registerVoice } from "./commands/voice.ts";
import { CliError, ExitCode } from "./lib/errors.ts";
import { configureOutput, emitError, isMachine } from "./lib/output.ts";
import { setProgressMode } from "./lib/progress.ts";
import { accent, bold, muted, setColorEnabled } from "./lib/style.ts";

function banner(): string {
  return `${accent("♪ vocaloid")} ${muted(`v${pkg.version}`)}  ${muted("compose · render · export")}\n`;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("vocaloid")
    .description("Compose VOCALOID-style songs as song.yaml and render them to audio headlessly. Agent-first: JSON when piped.")
    .version(pkg.version, "-v, --version")
    .option("--json", "force JSON output (automatic when stdout is not a TTY)")
    .option("--fields <list>", "comma-separated fields to keep in the output data")
    .option("--progress <mode>", "progress on stderr: auto | json (NDJSON events) | none", "auto")
    .option("--no-color", "disable colors (NO_COLOR is also honored)")
    .showHelpAfterError(false)
    .configureOutput({
      // Help goes to stdout only for humans; errors and piped help go to stderr.
      writeOut: (s) => (process.stdout.isTTY ? process.stdout : process.stderr).write(s),
      writeErr: (s) => process.stderr.write(s),
      outputError: () => {},
    })
    .exitOverride();

  program.hook("preAction", (_this, action) => {
    const opts = program.opts<{ json?: boolean; fields?: string; progress?: string; color?: boolean }>();
    if (opts.color === false) setColorEnabled(false);
    configureOutput({ json: opts.json, fields: opts.fields });
    setProgressMode(opts.progress);
    void action;
  });

  registerInit(program);
  registerRender(program);
  registerSong(program);
  registerTrack(program);
  registerNote(program);
  registerLyrics(program);
  registerStyle(program);
  registerArrange(program);
  registerVoice(program);
  registerSinger(program);
  registerSetup(program);
  registerSkill(program);
  registerSchema(program);
  registerUndo(program);
  return program;
}

export async function main(argv: string[]): Promise<number> {
  const program = buildProgram();
  // Bare invocation: humans get the banner and help, agents get the schema summary.
  if (argv.length <= 2) {
    configureOutput({});
    if (isMachine()) argv = [...argv, "schema"];
    else {
      process.stderr.write(banner());
      process.stdout.write(`${program.helpInformation()}\n${muted("Start with:")} ${bold("vocaloid setup")} then ${bold("vocaloid init my-song")}\n`);
      return ExitCode.ok;
    }
  }
  try {
    await program.parseAsync(argv);
    return typeof process.exitCode === "number" ? process.exitCode : ExitCode.ok;
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.code === "commander.helpDisplayed" || err.code === "commander.version" || err.code === "commander.help") {
        return ExitCode.ok;
      }
      configureOutput(program.opts());
      return emitError(
        new CliError({
          code: "USAGE",
          message: err.message.replace(/^error: /, ""),
          hint: "Run `vocaloid schema` or `vocaloid <command> --help`",
          exitCode: ExitCode.usage,
        }),
      );
    }
    return emitError(err);
  }
}

main(process.argv).then((code) => {
  process.exitCode = code;
});
