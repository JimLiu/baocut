import type { JobsTranslateSubtitlesMessages } from './translate-subtitles.ts';

export const nl: JobsTranslateSubtitlesMessages = {
  label: "Ondertitelbestand vertalen",
  description:
    "Vertaalt een SRT- of WebVTT-ondertitelbestand ondertitel voor ondertitel naar een andere taal en schrijft een nieuw ondertitelbestand. Het aantal ondertitels en de tijdcodes blijven gelijk; het resultaat kan tweetalig of in een ander formaat zijn. De video wordt niet gewijzigd.",
  stepRead: "Ondertitels lezen",
  stepTranslate: "Vertalen",
  stepCheck: "Controle",
  stepPublish: "Publiceren",
  noStructuredOutput: (p: { model: string }) => `Model ${p.model} ondersteunt geen gestructureerde uitvoer, dus kan niet worden gebruikt voor vertaling`,
  artifactGone: (p: { artifactId: string }) => `Uitvoer ${p.artifactId} bestaat niet meer`,
  paramNotAbsolute: (p: { key: string }) => `Parameter ${p.key} moet een absoluut pad zijn`,
  inputNotSubtitle: "Parameter input moet een .srt- of .vtt-bestand zijn",
  languageInvalid: (p: { key: string }) => `Parameter ${p.key} moet een BCP 47-taaltag zijn`,
  bilingualInvalid: "Parameter bilingual moet true of false zijn",
  fileNotFound: (p: { file: string }) => `Kan het ondertitelbestand niet vinden: ${p.file}`,
  fileTooLarge: (p: { bytes: number; limit: number }) => `Het ondertitelbestand heeft ${p.bytes} bytes en overschrijdt de limiet van ${p.limit}`,
  noText: "Het ondertitelbestand bevat geen tekst om te vertalen",
  allEmpty: "Elke ondertitel is leeg",
  markupStripped: (p: { count: number }) =>
    `${p.count} ondertitels bevatten inline-opmaak (cursief, kleur, positie enzovoort) die niet is behouden in de vertaling`,
  cueNoTranslation: (p: { n: number }) => `Ondertitel ${p.n} heeft geen vertaling`,
  rereadFailed: "Kan de geschreven ondertitels niet teruglezen",
  cueCountMismatch: (p: { written: number; original: number }) => `Geschreven: ${p.written} ondertitels; het oorspronkelijke bestand bevat ${p.original}`,
  timingChanged: (p: { n: number; from: string; to: string }) => `De tijdcode van ondertitel ${p.n} is gewijzigd: ${p.from} → ${p.to}`,
  cannotMatch: "De vertaling kan niet worden geschreven als ondertitels die één op één overeenkomen met het oorspronkelijke bestand",
  settingsDropped: (p: { settings: number; blocks: number }) =>
    `Omgezet naar SRT: cue-instellingen van ${p.settings} ondertitels en ${p.blocks} NOTE-, STYLE- en REGION-blokken passen niet en zijn niet behouden`,
};
