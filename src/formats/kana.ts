/** Kana → Hepburn-ish romaji, matching the keys of ROMAJI_TO_XSAMPA. Katakana is folded to hiragana. */

const BASE: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", ゐ: "wi", ゑ: "we", を: "o", ん: "n",
  ゔ: "bu", っ: "ltu",
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o", ゃ: "ya", ゅ: "yu", ょ: "yo", ゎ: "wa",
};

/** Combinations whose romaji is not the plain concatenation. */
const COMBO: Record<string, string> = {
  きゃ: "kya", きゅ: "kyu", きょ: "kyo", きぇ: "kye",
  ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo", ぎぇ: "gye",
  しゃ: "sha", しゅ: "shu", しょ: "sho", しぇ: "she",
  じゃ: "ja", じゅ: "ju", じょ: "jo", じぇ: "je",
  ちゃ: "cha", ちゅ: "chu", ちょ: "cho", ちぇ: "che",
  にゃ: "nya", にゅ: "nyu", にょ: "nyo", にぇ: "nye",
  ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo", ひぇ: "hye",
  びゃ: "bya", びゅ: "byu", びょ: "byo", びぇ: "bye",
  ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo", ぴぇ: "pye",
  みゃ: "mya", みゅ: "myu", みょ: "myo", みぇ: "mye",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo", りぇ: "rye",
  ふぁ: "fa", ふぃ: "fi", ふぇ: "fe", ふぉ: "fo", ふゅ: "fyu",
  てぃ: "ti", でぃ: "di", とぅ: "tu", どぅ: "du",
  つぁ: "tsa", つぃ: "tsi", つぇ: "tse", つぉ: "tso",
  うぃ: "wi", うぇ: "we", うぉ: "wo", いぇ: "ye",
  すぃ: "si", ずぃ: "zi",
};

function toHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/** Romaji for one lyric unit (one mora, possibly with a small kana). Returns null if not kana. */
export function kanaToRomaji(unit: string): string | null {
  const h = toHiragana(unit);
  if (COMBO[h]) return COMBO[h]!;
  if (BASE[h]) return BASE[h]!;
  return null;
}
