import { pluralForm } from '@baocut/protocol';
import type { ToolsTranscodeMessages } from './tools-transcode-copy.ts';

export const nl: ToolsTranscodeMessages = {
  quality: {
    smaller: { name: "Kleiner", sub: "Goed genoeg voor berichten en cloudopslag" },
    balanced: { name: "Gebalanceerd", sub: "Het verschil is moeilijk te zien" },
    high: { name: "Hoge kwaliteit", sub: "Bewaren om later te bewerken" },
  },
  heightOriginal: "Origineel",
  heightOriginalLong: "Oorspronkelijke resolutie",
  codecSub: {
    h264: "Speelt overal af",
    hevc: "40 % kleiner bij dezelfde kwaliteit; oudere apparaten spelen het mogelijk niet af",
  },

  notVideoFiles: (names: readonly string[]) => `${names.join(", ")} ${pluralForm('nl', names.length, { one: "is geen videobestand", other: "zijn geen videobestanden" })}`,
  notAbsolute: (paths: readonly string[]) => `${paths.join(", ")} ${pluralForm('nl', paths.length, { one: "is geen absoluut pad", other: "zijn geen absolute paden" })}`,
  alreadyListed: (names: readonly string[]) => `${names.join(", ")} ${pluralForm('nl', names.length, { one: "staat al in de lijst", other: "staan al in de lijst" })}`,
  overflow: (limit: number, extra: number) => `Maximaal ${limit} bestanden tegelijk; ${pluralForm('nl', extra, { one: `${extra} extra bestand is niet toegevoegd`, other: `${extra} extra bestanden zijn niet toegevoegd` })}`,
  joinNotices: (bits: readonly string[]) => bits.join("; "),

  needTwoVideos: "Voeg minstens twee video’s toe",
  needMediaFile: "Kies eerst een video- of audiobestand",
  needVideoFile: "Kies eerst een videobestand",
  needOneMore: "Samenvoegen vereist minstens twee video’s; voeg er nog een toe",
  tooManyFiles: (limit: number) => `Maximaal ${limit} bestanden tegelijk`,
  videoKbpsRange: (min: number, max: number) => `De videobitrate moet tussen ${min} en ${max} kbps liggen`,
  audioKbpsRange: (min: number, max: number) => `De audiobitrate moet tussen ${min} en ${max} kbps liggen`,
  outDirAbsolute: "De uitvoermap moet een absoluut pad zijn",
  ffmpegUnusable: (message: string) => `ffmpeg is niet beschikbaar: ${message}`,
  audioKbps: (kbps: number) => `Audio ${kbps} kbps`,

  ffmpegNeeded: "Installeer eerst ffmpeg",
  ffmpegInstallHint: "Installeer ffmpeg of stel het pad in met BAOCUT_FFMPEG",
  ffmpegReady: (version: string) => `ffmpeg${version} is gereed`,
  ffmpegOutdated: (version: string) => `ffmpeg${version} is te oud`,
  ffmpegCannotRun: "ffmpeg kan niet worden uitgevoerd",

  filesTitle: (first: string, count: number) => `${first} en ${count - 1} meer`,
  defaultTitle: "Bestandsconversie",
  mergeTitle: (first: string, more: number) => `${first} + ${more} meer`,
  qualityWithCrf: (name: string, crf: number) => `${name} (CRF ${crf})`,
  mergeStreamCopy: (n: number) => `Samenvoegen: ${n} clips · Streamkopie`,
  extractAudioMany: (n: number) => pluralForm('nl', n, { one: `Audio extraheren uit ${n} bestand`, other: `Audio extraheren uit ${n} bestanden` }),
  extractAudio: "Audio extraheren",
  mergeClips: (n: number) => `Samenvoegen: ${n} clips`,
  compressMany: (n: number) => pluralForm('nl', n, { one: `${n} bestand comprimeren`, other: `${n} bestanden comprimeren` }),
  compress: "Comprimeren",
  stepQueued: (step: string, detail: string | null) => `${step} · ${detail ?? "In wachtrij"}`,
  stepOf: (step: string, cur: number, total: number) => `${step} · Stap ${cur} van ${total}`,
  noAudioTrack: "Geen audio",
  mergedSize: (after: string, before: string) => `${after} (bronnen samen ${before})`,
  savedSize: (before: string, after: string, saved: number | null) =>
    `${before} → ${after} (${saved === null ? "niet kleiner" : saved === 0 ? "ongeveer even groot" : `${saved}% kleiner`})`,
  streamCopyLine: "Alle clips komen overeen: streamkopie zonder opnieuw te coderen, kwaliteit ongewijzigd",
  reencodeLine: (reason: string | null) => (reason ? `Opnieuw gecodeerd: ${reason}` : "Opnieuw gecodeerd"),
  underASecond: "Minder dan 1 seconde",
  took: (duration: string) => `Duur: ${duration}`,
  stateQueued: "In wachtrij",
  stateProcessing: "Verwerken",

  remedyThenRetry: (remedy: string) => `${remedy} en probeer het opnieuw`,
  inputUnreadable: "Kan geen frames uit dit bestand lezen. Controleer of het afspeelt in een mediaspeler of kies een ander bestand",
  transcodeFailed: "ffmpeg is halverwege mislukt; de oorspronkelijke uitvoer staat hieronder. Maak ruimte vrij als de schijf vol is; kies een bronbestand opnieuw als het is verplaatst",
  validationFailed: "De uitvoer is afgekeurd en weggegooid, dus er is niets in de uitvoermap geschreven. Probeer het opnieuw of wijzig de instellingen",
};
