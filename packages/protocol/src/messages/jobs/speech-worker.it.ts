import type { JobsSpeechWorkerMessages } from './speech-worker.ts';

export const it: JobsSpeechWorkerMessages = {
  incompatible: (p: { protocol: string }) => `Il protocollo dello Speech Worker non è ${p.protocol}`,
  exited: "Lo Speech Worker è terminato inaspettatamente",
  translationLanguage: "language della traduzione non corrisponde alla lingua di destinazione",
  outputInvalid: "Il risultato dello Speech Worker non corrisponde al contratto",
  outputTruncated: "L’output del modello ha raggiunto il limite ed è stato troncato",
  resultMissing: (p: { field: string }) => `Il risultato dello Speech Worker non ha ${p.field}`,
  unreadableFile: (p: { name: string }) => `Impossibile leggere il file scritto dallo Speech Worker: ${p.name}`,
  cuesNotObject: "I sottotitoli non sono un oggetto",
  cuesSchema: (p: { schema: string }) => `schema dei sottotitoli deve essere ${p.schema}`,
  cuesLanguage: "language dei sottotitoli non corrisponde alla lingua di destinazione",
  cuesTimescale: "timescale dei sottotitoli deve corrispondere a quello della trascrizione di origine",
  cuesMissing: "cues manca",
  cueNotObject: (p: { n: number }) => `Sottotitolo ${p.n} non è un oggetto`,
  cueNoText: (p: { n: number }) => `Sottotitolo ${p.n} non ha testo`,
  cueNoSentence: (p: { n: number }) => `Sottotitolo ${p.n} non ha la frase o l’unità`,
  cueFallback: (p: { n: number }) => `Sottotitolo ${p.n} ha fallback che non è booleano`,
  cueTicks: (p: { n: number }) => `Sottotitolo ${p.n} ha tempi che non sono tick interi`,
  cueRange: (p: { n: number }) => `Sottotitolo ${p.n} ha un intervallo temporale non valido`,
  cueOverlap: (p: { n: number }) => `Sottotitolo ${p.n} si sovrappone al precedente o è fuori ordine`,
  cueBeyond: (p: { n: number }) => `Sottotitolo ${p.n} supera la durata del media`,
};
