import type { VocaloidSinger } from "../catalog/singers.ts";
import type { CompiledSong, CompiledVocalTrack } from "../model/compile.ts";
import {
  breathinessToVocaloid,
  centsToPit,
  dynamicsToVocaloid,
  pitchBendSensitivity,
  unsupportedCurves,
  vocaloidText,
} from "./vocaloid-common.ts";

/**
 * VOCALOID4 project (.vsqx, vsq4 namespace, short tag names). VOCALOID3 reads vsq3 only; VOCALOID4,
 * 5 and 6 open vsq4. One pre-measure is inserted, as VOCALOID expects: musical ticks shift by one bar.
 * Structure verified against utaformatix3 (Vsqx.kt + template) and LibreSVIP (vsqx4 model).
 */

const PRE_MEASURE = 1;

const cdata = (text: string) => `<![CDATA[${text.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;

export interface VsqxOptions {
  singerFor: (track: CompiledVocalTrack) => VocaloidSinger;
}

export function toVsqx(song: CompiledSong, opts: VsqxOptions): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  const vocals = song.tracks.filter((t): t is CompiledVocalTrack => t.kind === "vocal" && t.notes.length > 0);
  if (vocals.some((t) => t.language !== "ja" && t.language !== "en")) {
    warnings.push("VOCALOID4 only has Japanese, English, Korean, Spanish and Chinese voicebanks; check the singer matches each track's language");
  }
  const first = song.timeSignatures[0] ?? { numerator: 4, denominator: 4 };
  const prefix = ((480 * 4) / first.denominator) * first.numerator * PRE_MEASURE;

  const singers: VocaloidSinger[] = [];
  const programOf = (s: VocaloidSinger) => {
    let i = singers.findIndex((x) => x.compID === s.compID);
    if (i < 0) {
      if (s.ai) warnings.push(`singer "${s.name}" is a VOCALOID:AI voice; .vsqx cannot carry AI tracks, use --format vpr`);
      singers.push(s);
      i = singers.length - 1;
    }
    return i;
  };

  let fallbackPhonemes = 0;
  const vsTracks = vocals.map((track, tNo) => {
    const pc = programOf(opts.singerFor(track));
    const last = track.notes.at(-1)!;
    const cc: string[] = [];
    for (const p of track.curves.dynamics ?? []) cc.push(`<cc><t>${p.tick}</t><v id="D">${dynamicsToVocaloid(p.value)}</v></cc>`);
    for (const p of track.curves.breathiness ?? []) cc.push(`<cc><t>${p.tick}</t><v id="B">${breathinessToVocaloid(p.value)}</v></cc>`);
    if (track.curves.pitchBend?.length) {
      const pbs = pitchBendSensitivity(track);
      cc.push(`<cc><t>0</t><v id="S">${pbs}</v></cc>`);
      for (const p of track.curves.pitchBend) cc.push(`<cc><t>${p.tick}</t><v id="P">${centsToPit(p.value, pbs)}</v></cc>`);
    }
    const skipped = unsupportedCurves(track);
    if (skipped.length) warnings.push(`track "${track.id}": curves ${skipped.join(", ")} were not exported`);
    const notes = track.notes.map((n) => {
      const text = vocaloidText(track.language, n.lyric, n.phonemes);
      if (!text.derived) fallbackPhonemes++;
      return [
        "<note>",
        `<t>${n.tick}</t><dur>${n.dur}</dur><n>${n.midi}</n><v>64</v>`,
        `<y>${cdata(text.lyric)}</y>`,
        `<p${n.phonemes ? ' lock="1"' : ""}>${cdata(text.phoneme)}</p>`,
        '<nStyle><v id="accent">50</v><v id="bendDep">0</v><v id="bendLen">0</v><v id="decay">50</v><v id="fallPort">0</v><v id="opening">127</v><v id="risePort">0</v><v id="vibLen">0</v><v id="vibType">0</v></nStyle>',
        "</note>",
      ].join("");
    });
    return `<vsTrack>
<tNo>${tNo}</tNo>
<name>${cdata(track.name)}</name>
<comment>${cdata(track.id)}</comment>
<vsPart>
<t>${prefix}</t>
<playTime>${last.tick + last.dur}</playTime>
<name>${cdata(track.name)}</name>
<comment>${cdata("")}</comment>
<sPlug><id>${cdata("ACA9C502-A04B-42b5-B2EB-5CEA36D16FCE")}</id><name>${cdata("VOCALOID2 Compatible Style")}</name><version>${cdata("3.0.0.1")}</version></sPlug>
<pStyle><v id="accent">50</v><v id="bendDep">8</v><v id="bendLen">0</v><v id="decay">50</v><v id="fallPort">0</v><v id="opening">127</v><v id="risePort">0</v></pStyle>
<singer><t>0</t><bs>0</bs><pc>${pc}</pc></singer>
${cc.join("\n")}
${notes.join("\n")}
<plane>0</plane>
</vsPart>
</vsTrack>`;
  });

  if (fallbackPhonemes > 0) {
    warnings.push(`${fallbackPhonemes} note(s) got a placeholder phoneme; in VOCALOID run Job → "Convert Phonemes to Match Language"`);
  }
  const vsUnits = vocals.map(
    (t, tNo) =>
      `<vsUnit><tNo>${tNo}</tNo><iGin>0</iGin><sLvl>-898</sLvl><sEnable>0</sEnable><m>${t.mute ? 1 : 0}</m><s>0</s><pan>64</pan><vol>0</vol></vsUnit>`,
  );
  const tempos = song.tempos.map((t, i) => `<tempo><t>${i === 0 ? 0 : t.tick + prefix}</t><v>${Math.round(t.bpm * 100)}</v></tempo>`);
  const sigs = song.timeSignatures.map((s, i) => `<timeSig><m>${i === 0 ? 0 : s.bar - 1 + PRE_MEASURE}</m><nu>${s.numerator}</nu><de>${s.denominator}</de></timeSig>`);
  const voices = singers.map(
    (s, i) => `<vVoice><bs>0</bs><pc>${i}</pc><id>${cdata(s.compID)}</id><name>${cdata(s.name)}</name><vPrm><bre>0</bre><bri>0</bri><cle>0</cle><gen>0</gen><ope>0</ope></vPrm></vVoice>`,
  );

  const text = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<vsq4 xmlns="http://www.yamaha.co.jp/vocaloid/schema/vsq4/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.yamaha.co.jp/vocaloid/schema/vsq4/ vsq4.xsd">
<vender>${cdata("Yamaha corporation")}</vender>
<version>${cdata("4.0.0.3")}</version>
<vVoiceTable>
${voices.join("\n")}
</vVoiceTable>
<mixer>
<masterUnit><oDev>0</oDev><rLvl>0</rLvl><vol>0</vol></masterUnit>
${vsUnits.join("\n")}
<monoUnit><iGin>0</iGin><sLvl>-898</sLvl><sEnable>0</sEnable><m>0</m><s>0</s><pan>64</pan><vol>0</vol></monoUnit>
<stUnit><iGin>0</iGin><m>0</m><s>0</s><vol>-129</vol></stUnit>
</mixer>
<masterTrack>
<seqName>${cdata(song.title)}</seqName>
<comment>${cdata("Generated by @jibaru/vocaloid-cli")}</comment>
<resolution>480</resolution>
<preMeasure>${PRE_MEASURE}</preMeasure>
${sigs.join("\n")}
${tempos.join("\n")}
</masterTrack>
${vsTracks.join("\n")}
<monoTrack>
</monoTrack>
<stTrack>
</stTrack>
<aux>
<id>${cdata("AUX_VST_HOST_CHUNK_INFO")}</id>
<content>${cdata("VlNDSwAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")}</content>
</aux>
</vsq4>
`;
  return { text, warnings };
}
