import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomic } from "../lib/fsx.ts";
import { cliHome } from "../lib/paths.ts";
import { type CatalogVoice, type Language, VOICES } from "./voices.ts";

/** A voicebank the user added from disk with `vocaloid voice add`. */
export interface LocalVoice {
  id: string;
  name: string;
  type: "diffsinger" | "utau";
  singerId: string;
  phonemizers: Partial<Record<Language, string>>;
  voiceColors: string[];
  license: { commercial: boolean; credit: string; summary: string };
}

export type Voice = (CatalogVoice & { source: "catalog" }) | (LocalVoice & { source: "local" });

function registryPath(): string {
  return join(cliHome(), "voices.json");
}

export async function readLocalVoices(): Promise<LocalVoice[]> {
  try {
    return JSON.parse(await readFile(registryPath(), "utf8")) as LocalVoice[];
  } catch {
    return [];
  }
}

export async function writeLocalVoices(voices: LocalVoice[]): Promise<void> {
  await writeAtomic(registryPath(), `${JSON.stringify(voices, null, 2)}\n`);
}

export async function allVoices(): Promise<Voice[]> {
  const local = await readLocalVoices();
  return [
    ...VOICES.map((v) => ({ ...v, source: "catalog" as const })),
    ...local.map((v) => ({ ...v, source: "local" as const })),
  ];
}

export async function resolveVoice(id: string): Promise<Voice | undefined> {
  return (await allVoices()).find((v) => v.id === id);
}
