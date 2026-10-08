import type { JobsTranslateSubtitlesMessages } from './translate-subtitles.ts';

export const de: JobsTranslateSubtitlesMessages = {
  label: "Untertiteldatei übersetzen",
  description:
    "Übersetzt eine SRT- oder WebVTT-Untertiteldatei Untertitel für Untertitel in eine andere Sprache und schreibt eine neue Untertiteldatei. Untertitelanzahl und Zeitcodes bleiben gleich; das Ergebnis kann zweisprachig oder in einem anderen Format sein. Das Video bleibt unverändert.",
  stepRead: "Untertitel lesen",
  stepTranslate: "Übersetzen",
  stepCheck: "Prüfen",
  stepPublish: "Veröffentlichen",
  noStructuredOutput: (p: { model: string }) => `Modell ${p.model} unterstützt keine strukturierte Ausgabe und kann daher nicht zum Übersetzen verwendet werden`,
  artifactGone: (p: { artifactId: string }) => `Ergebnis ${p.artifactId} ist nicht mehr vorhanden`,
  paramNotAbsolute: (p: { key: string }) => `Parameter ${p.key} muss ein absoluter Pfad sein`,
  inputNotSubtitle: "Parameter input muss eine .srt- oder .vtt-Datei sein",
  languageInvalid: (p: { key: string }) => `Parameter ${p.key} muss ein BCP 47-Sprachtag sein`,
  bilingualInvalid: "Parameter bilingual muss true oder false sein",
  fileNotFound: (p: { file: string }) => `Untertiteldatei nicht gefunden: ${p.file}`,
  fileTooLarge: (p: { bytes: number; limit: number }) => `Die Untertiteldatei hat ${p.bytes} Bytes und überschreitet das Limit von ${p.limit}`,
  noText: "Die Untertiteldatei enthält keinen zu übersetzenden Text",
  allEmpty: "Alle Untertitel sind leer",
  markupStripped: (p: { count: number }) =>
    `${p.count} Untertitel enthielten Inline-Markierungen (Kursiv, Farbe, Position usw.), die in der Übersetzung nicht beibehalten wurden`,
  cueNoTranslation: (p: { n: number }) => `Untertitel ${p.n} hat keine Übersetzung`,
  rereadFailed: "Geschriebene Untertitel konnten nicht erneut gelesen werden",
  cueCountMismatch: (p: { written: number; original: number }) => `Geschrieben: ${p.written} Untertitel; die Originaldatei enthält ${p.original}`,
  timingChanged: (p: { n: number; from: string; to: string }) => `Der Zeitcode von Untertitel ${p.n} wurde geändert: ${p.from} → ${p.to}`,
  cannotMatch: "Die Übersetzung kann nicht als Untertitel mit exakter Einzelzuordnung zur Originaldatei geschrieben werden",
  settingsDropped: (p: { settings: number; blocks: number }) =>
    `In SRT umgewandelt: Cue-Einstellungen von ${p.settings} Untertiteln sowie ${p.blocks} NOTE-, STYLE- und REGION-Blöcke passen nicht ins Format und wurden nicht beibehalten`,
};
