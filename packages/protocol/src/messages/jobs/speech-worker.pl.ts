import type { JobsSpeechWorkerMessages } from './speech-worker.ts';

export const pl: JobsSpeechWorkerMessages = {
  incompatible: (p: { protocol: string }) => `Protokół Speech Worker jest inny niż ${p.protocol}`,
  exited: "Speech Worker zakończył się nieoczekiwanie",
  translationLanguage: "Język tłumaczenia nie odpowiada docelowemu",
  outputInvalid: "Wynik Speech Worker nie odpowiada kontraktowi",
  outputTruncated: "Wynik modelu osiągnął limit i został ucięty",
  resultMissing: (p: { field: string }) => `W wyniku Speech Worker brakuje ${p.field}`,
  unreadableFile: (p: { name: string }) => `Nie można odczytać ${p.name} zapisanego przez Speech Worker`,
  cuesNotObject: "cues nie jest obiektem",
  cuesSchema: (p: { schema: string }) => `schema dla cues musi być ${p.schema}`,
  cuesLanguage: "Język cues nie odpowiada docelowemu",
  cuesTimescale: "timescale dla cues musi odpowiadać transkrypcji źródłowej",
  cuesMissing: "Brak cues",
  cueNotObject: (p: { n: number }) => `Napis ${p.n} nie jest obiektem`,
  cueNoText: (p: { n: number }) => `Napis ${p.n} nie ma tekstu`,
  cueNoSentence: (p: { n: number }) => `Napis ${p.n} nie ma sentence lub unit`,
  cueFallback: (p: { n: number }) => `Napis ${p.n} – fallback nie jest wartością logiczną`,
  cueTicks: (p: { n: number }) => `Napis ${p.n} – czasy nie są całkowitymi taktami`,
  cueRange: (p: { n: number }) => `Napis ${p.n} ma nieprawidłowy zakres czasu`,
  cueOverlap: (p: { n: number }) => `Napis ${p.n} nakłada się na poprzedni lub jest poza kolejnością`,
  cueBeyond: (p: { n: number }) => `Napis ${p.n} wykracza poza czas trwania multimediów`,
};
