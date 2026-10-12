import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Temp file + rename so a crash never leaves a half-written song. */
export async function writeAtomic(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Keep the last `keep` versions of a file in `historyDir`, newest last. */
export async function backup(path: string, historyDir: string, keep = 20): Promise<string | null> {
  if (!(await exists(path))) return null;
  await mkdir(historyDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(historyDir, `${stamp}.yaml`);
  await copyFile(path, target);
  const entries = (await listHistory(historyDir)).slice(0, -keep);
  for (const old of entries) await rm(join(historyDir, old), { force: true });
  return target;
}

export async function listHistory(historyDir: string): Promise<string[]> {
  try {
    return (await readdir(historyDir)).filter((f) => f.endsWith(".yaml")).sort();
  } catch {
    return [];
  }
}

export function sha256(text: string | Uint8Array): string {
  return createHash("sha256").update(text).digest("hex");
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}
