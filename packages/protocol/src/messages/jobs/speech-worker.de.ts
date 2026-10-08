import type { JobsSpeechWorkerMessages } from './speech-worker.ts';

export const de: JobsSpeechWorkerMessages = {
  incompatible: (p: { protocol: string }) => `Das Protokoll von Speech Worker entspricht nicht ${p.protocol}`,
  exited: "Speech Worker wurde unerwartet beendet",
  translationLanguage: "Die Sprache der Übersetzung stimmt nicht mit der Zielsprache überein",
  outputInvalid: "Die Ausgabe von Speech Worker entspricht nicht dem Vertrag",
  outputTruncated: "Die Modellausgabe hat das Limit erreicht und wurde abgeschnitten",
  resultMissing: (p: { field: string }) => `Im Ergebnis von Speech Worker fehlt ${p.field}`,
  unreadableFile: (p: { name: string }) => `Lesen fehlgeschlagen: ${p.name}, geschrieben von Speech Worker`,
  cuesNotObject: "Die Cues sind kein Objekt",
  cuesSchema: (p: { schema: string }) => `Das Cue-Schema muss sein: ${p.schema}`,
  cuesLanguage: "Die Sprache der Cues stimmt nicht mit der Zielsprache überein",
  cuesTimescale: "Die timescale der Cues muss mit der des Quelltranskripts übereinstimmen",
  cuesMissing: "cues fehlt",
  cueNotObject: (p: { n: number }) => `Cue ${p.n} ist kein Objekt`,
  cueNoText: (p: { n: number }) => `Cue ${p.n} enthält keinen Text`,
  cueNoSentence: (p: { n: number }) => `Cue ${p.n} enthält keinen Satz oder keine Einheit`,
  cueFallback: (p: { n: number }) => `Cue ${p.n}: fallback ist kein boolescher Wert`,
  cueTicks: (p: { n: number }) => `Cue ${p.n}: Zeiten sind keine ganzzahligen Ticks`,
  cueRange: (p: { n: number }) => `Cue ${p.n} hat einen ungültigen Zeitbereich`,
  cueOverlap: (p: { n: number }) => `Cue ${p.n} überschneidet sich mit dem vorherigen oder ist nicht in Reihenfolge`,
  cueBeyond: (p: { n: number }) => `Cue ${p.n} überschreitet die Mediendauer`,
};
