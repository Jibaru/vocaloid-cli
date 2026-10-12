import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomic } from "../lib/fsx.ts";
import { cliHome } from "../lib/paths.ts";

/**
 * VOCALOID singers for .vpr/.vsqx export. A project names its singer by compID; there is no public
 * registry, so only verified IDs ship here. Users add theirs with `vocaloid singer add` or
 * `vocaloid singer import <a .vpr/.vsqx saved by their editor>`.
 */
export interface VocaloidSinger {
  id: string;
  name: string;
  compID: string;
  /** VOCALOID:AI voices (VOCALOID6) go on AI tracks with aiVoice. */
  ai: boolean;
  source: string;
}

export const BUILTIN_SINGERS: VocaloidSinger[] = [
  {
    id: "vy2v3",
    name: "VY2V3",
    compID: "BCXDC6CZLSZHZCB4",
    ai: false,
    source: "utaformatix3 template (Apache-2.0)",
  },
];

export const DEFAULT_SINGER = "vy2v3";

function registryPath(): string {
  return join(cliHome(), "vocaloid-singers.json");
}

export async function readLocalSingers(): Promise<VocaloidSinger[]> {
  try {
    return JSON.parse(await readFile(registryPath(), "utf8")) as VocaloidSinger[];
  } catch {
    return [];
  }
}

export async function writeLocalSingers(singers: VocaloidSinger[]): Promise<void> {
  await writeAtomic(registryPath(), `${JSON.stringify(singers, null, 2)}\n`);
}

export async function allSingers(): Promise<VocaloidSinger[]> {
  return [...BUILTIN_SINGERS, ...(await readLocalSingers())];
}
