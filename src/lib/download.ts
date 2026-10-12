import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CliError, ExitCode } from "./errors.ts";
import { exists, sha256File } from "./fsx.ts";
import { progress } from "./progress.ts";

/** MediaFire pages embed the direct link; the voice author requires using the original link. */
export async function resolveMediafire(pageUrl: string): Promise<string> {
  const res = await fetch(pageUrl, { headers: { "user-agent": "Mozilla/5.0 vocaloid-cli" } });
  if (!res.ok) {
    throw new CliError({
      code: "DOWNLOAD_RESOLVE_FAILED",
      message: `MediaFire returned HTTP ${res.status} for ${pageUrl}`,
      exitCode: ExitCode.missingDependency,
    });
  }
  const html = await res.text();
  const match = /https:\/\/download\d+\.mediafire\.com\/[^"'\s]+/.exec(html);
  if (!match) {
    throw new CliError({
      code: "DOWNLOAD_RESOLVE_FAILED",
      message: "Could not find the direct download link on the MediaFire page",
      hint: `Download it manually from ${pageUrl} and run \`vocaloid voice install <id> --from-zip <file>\``,
      exitCode: ExitCode.missingDependency,
    });
  }
  return match[0];
}

/** Download to `dest` with real byte progress and a sha256 check. Resumes nothing; writes atomically. */
export async function download(
  url: string,
  dest: string,
  opts: { task: string; sha256?: string; expectedBytes?: number },
): Promise<void> {
  if (opts.sha256 && (await exists(dest)) && (await sha256File(dest)) === opts.sha256) return;
  await mkdir(dirname(dest), { recursive: true });
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 vocaloid-cli" } });
  if (!res.ok || !res.body) {
    throw new CliError({
      code: "DOWNLOAD_FAILED",
      message: `HTTP ${res.status} downloading ${url}`,
      exitCode: ExitCode.missingDependency,
    });
  }
  const total = Number(res.headers.get("content-length")) || opts.expectedBytes;
  let done = 0;
  const tmp = `${dest}.part`;
  const body = Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream);
  body.on("data", (chunk: Buffer) => {
    done += chunk.length;
    progress({ task: opts.task, done, total, unit: "bytes" });
  });
  await pipeline(body, createWriteStream(tmp));
  progress({ task: opts.task, done, total: total ?? done, unit: "bytes" });
  if (opts.sha256) {
    const actual = await sha256File(tmp);
    if (actual !== opts.sha256) {
      await rm(tmp, { force: true });
      throw new CliError({
        code: "CHECKSUM_MISMATCH",
        message: `Downloaded file has sha256 ${actual}, expected ${opts.sha256}`,
        hint: "The upstream file changed or the download was corrupted. Retry, or report it so the catalog can be updated.",
        exitCode: ExitCode.missingDependency,
      });
    }
  }
  await rename(tmp, dest);
}
