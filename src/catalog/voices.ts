/**
 * Curated voice catalog. Every entry records its license so renders can carry credits and
 * `--commercial` can refuse voices that forbid it. Never add unlicensed clones of commercial
 * voices (e.g. Hatsune Miku models); the real Miku is reached through VOCALOID export.
 */

export type Language = "ja" | "en" | "es" | "ko" | "zh" | "de";

export interface VoiceLicense {
  commercial: boolean;
  credit: string;
  termsUrl: string;
  summary: string;
  redistribution: boolean;
}

export interface VoiceDownload {
  kind: "mediafire" | "direct";
  url: string;
  sha256: string;
  bytes: number;
  /** Folder name inside the OpenUtau Singers directory after extraction. */
  folder: string;
}

export interface CatalogVoice {
  id: string;
  name: string;
  engine: "openutau";
  type: "diffsinger" | "utau";
  /** OpenUtau singer id (folder name). */
  singerId: string;
  timbre: string;
  phonemizers: Partial<Record<Language, string>>;
  voiceColors: string[];
  license: VoiceLicense;
  download: VoiceDownload;
}

const DS = "OpenUtau.Core.DiffSinger.";

export const VOICES: CatalogVoice[] = [
  {
    id: "hanami",
    name: "Hoshino Hanami ~AI❤dol~ (DiffSinger v1.0)",
    engine: "openutau",
    type: "diffsinger",
    singerId: "Hoshino Hanami ~AIdol~ for DiffSinger v1.0",
    timbre: "Bright pop soprano with power (Fragrance) and soft (Nectar) modes; good for J-pop/J-rock leads.",
    phonemizers: {
      ja: `${DS}DiffSingerJapanesePhonemizer`,
      en: `${DS}DiffSingerEnglishPhonemizer`,
      es: `${DS}DiffSingerSpanishPhonemizer`,
      ko: `${DS}DiffSingerKoreanPhonemizer`,
      zh: `${DS}DiffSingerChinesePhonemizer`,
      de: `${DS}DiffSingerGermanPhonemizer`,
    },
    voiceColors: ["Root", "Fragrance", "Nectar"],
    license: {
      commercial: true,
      credit: "Hoshino Hanami ~AI❤dol~ voicebank by Lotte V (https://lottev.moe)",
      termsUrl: "https://github.com/lottev1991/LotteV-Voicebank-Update-Repo/blob/main/ToU_EN.md",
      summary:
        "Commercial and non-commercial use allowed without permission; credit Lotte V; do not reupload or sell the voicebank files; no political or hateful use.",
      redistribution: false,
    },
    download: {
      kind: "mediafire",
      url: "https://www.mediafire.com/file/ks3hpb5zldabo3s/Hoshino_Hanami_%257EAIdol%257E_for_DiffSinger_v1.0.zip/file",
      sha256: "91d9302cb220ba2c790a01973b0cc6ab1d84df3581582a1a4b1fb9acc4f65277",
      bytes: 549903782,
      folder: "Hoshino Hanami ~AIdol~ for DiffSinger v1.0",
    },
  },
];

export const DEFAULT_VOICE = "hanami";

export function findVoice(id: string): CatalogVoice | undefined {
  return VOICES.find((v) => v.id === id);
}
