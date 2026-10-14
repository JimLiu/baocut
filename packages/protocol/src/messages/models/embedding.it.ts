import type { ModelsEmbeddingMessages } from './embedding.ts';

export const it: ModelsEmbeddingMessages = {
  apacheLicense: 'Apache-2.0: uso gratuito, anche commerciale; in caso di ridistribuzione mantieni le note di copyright e di licenza',
  runtimeNoBuild: (p: { platform: string }) => `LiteRT-LM non ha una build per questo computer (${p.platform}), quindi la ricerca semantica locale qui non è ancora disponibile`,
  runtimeNotInstalled: (p: { version: string }) => `LiteRT-LM ${p.version} non è installato`,
  countMismatch: (p: { expected: number; actual: number }) => `Attesi ${p.expected} vettori, ricevuti ${p.actual}`,
  wrongDims: (p: { expected: number; actual: number }) => `Un vettore ha ${p.actual} dimensioni invece di ${p.expected}`,
  notFinite: 'Un vettore contiene un valore che non è un numero finito',
  notNormalized: (p: { norm: string }) => `Un vettore non ha lunghezza unitaria (norma ${p.norm})`,
  notRanked: (p: { relevant: string; irrelevant: string }) => `La frase pertinente non ha ottenuto un punteggio più alto di quella non pertinente (coseno ${p.relevant} contro ${p.irrelevant})`,
  noModel: 'Nessun modello di embedding locale installato',
  noVisionModel: 'Nessun modello di embedding locale installato sa leggere le immagini. Installa EmbeddingGemma 2 740M per cercare in base a ciò che si vede',
  inputTooLong: (p: { index: number; max: number }) => `Il testo ${p.index} è più lungo di quanto accetti il modello (${p.max} token)`,
  modelUnavailable: (p: { problem: string }) => `Il modello di embedding locale non è disponibile: ${p.problem}`,
  cannotEmbed: 'Questo Model Worker non sa ancora calcolare embedding con questo modello',
  embedReturned: (p: { code: string }) => `embed.run ha restituito ${p.code}`,
  selfTestPassed: (p: { dims: number; relevant: string; irrelevant: string; device: string }) => `${p.dims} dimensioni · coseno ${p.relevant} contro ${p.irrelevant} · ${p.device}`,
};
