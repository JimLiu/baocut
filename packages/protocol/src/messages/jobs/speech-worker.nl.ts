import type { JobsSpeechWorkerMessages } from './speech-worker.ts';

export const nl: JobsSpeechWorkerMessages = {
  incompatible: (p: { protocol: string }) => `Het protocol van Speech Worker is niet ${p.protocol}`,
  exited: "Speech Worker is onverwacht afgesloten",
  translationLanguage: "De taal van de vertaling komt niet overeen met de doeltaal",
  outputInvalid: "De uitvoer van Speech Worker voldoet niet aan het contract",
  outputTruncated: "De modeluitvoer heeft de limiet bereikt en is afgekapt",
  resultMissing: (p: { field: string }) => `In het resultaat van Speech Worker ontbreekt ${p.field}`,
  unreadableFile: (p: { name: string }) => `Kan niet lezen: ${p.name}, geschreven door Speech Worker`,
  cuesNotObject: "De cues zijn geen object",
  cuesSchema: (p: { schema: string }) => `Het cue-schema moet zijn: ${p.schema}`,
  cuesLanguage: "De taal van de cues komt niet overeen met de doeltaal",
  cuesTimescale: "De timescale van de cues moet overeenkomen met die van het brontranscript",
  cuesMissing: "cues ontbreekt",
  cueNotObject: (p: { n: number }) => `Cue ${p.n} is geen object`,
  cueNoText: (p: { n: number }) => `Cue ${p.n} heeft geen tekst`,
  cueNoSentence: (p: { n: number }) => `Cue ${p.n} mist een zin of eenheid`,
  cueFallback: (p: { n: number }) => `Cue ${p.n}: fallback is geen boolean`,
  cueTicks: (p: { n: number }) => `Cue ${p.n}: tijden zijn geen gehele ticks`,
  cueRange: (p: { n: number }) => `Cue ${p.n} heeft een ongeldig tijdsbereik`,
  cueOverlap: (p: { n: number }) => `Cue ${p.n} overlapt de vorige of staat niet op volgorde`,
  cueBeyond: (p: { n: number }) => `Cue ${p.n} loopt voorbij de mediaduur`,
};
