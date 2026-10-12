/**
 * Exit codes are part of the public contract (see `vocaloid schema`).
 * 0 success, 1 unexpected internal failure, 2 usage, 3 invalid song,
 * 4 missing dependency (engine, voice, ffmpeg), 5 render failure, 6 phonemization failure.
 */
export const ExitCode = {
  ok: 0,
  internal: 1,
  usage: 2,
  invalidSong: 3,
  missingDependency: 4,
  renderFailure: 5,
  phonemization: 6,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export interface ErrorDetail {
  path?: string;
  message: string;
  [key: string]: unknown;
}

export class CliError extends Error {
  readonly code: string;
  readonly hint?: string;
  readonly exitCode: ExitCodeValue;
  readonly details?: ErrorDetail[];

  constructor(opts: {
    code: string;
    message: string;
    hint?: string;
    exitCode?: ExitCodeValue;
    details?: ErrorDetail[];
  }) {
    super(opts.message);
    this.code = opts.code;
    this.hint = opts.hint;
    this.exitCode = opts.exitCode ?? ExitCode.usage;
    this.details = opts.details;
  }
}
