import type { ModelsEmbeddingMessages } from './embedding.ts';

export const de: ModelsEmbeddingMessages = {
  apacheLicense: 'Apache-2.0: frei nutzbar, auch kommerziell; bei Weitergabe Urheberrechts- und Lizenzhinweise beibehalten',
  runtimeNoBuild: (p: { platform: string }) => `Für diesen Rechner (${p.platform}) gibt es keinen LiteRT-LM-Build, daher ist die lokale semantische Suche hier noch nicht verfügbar`,
  runtimeNotInstalled: (p: { version: string }) => `LiteRT-LM ${p.version} ist nicht installiert`,
  countMismatch: (p: { expected: number; actual: number }) => `${p.expected} Vektoren erwartet, aber ${p.actual} erhalten`,
  wrongDims: (p: { expected: number; actual: number }) => `Ein Vektor hat ${p.actual} statt ${p.expected} Dimensionen`,
  notFinite: 'Ein Vektor enthält einen Wert, der keine endliche Zahl ist',
  notNormalized: (p: { norm: string }) => `Ein Vektor hat nicht die Länge 1 (Norm ${p.norm})`,
  notRanked: (p: { relevant: string; irrelevant: string }) => `Der passende Satz hat nicht höher abgeschnitten als der unpassende (Kosinus ${p.relevant} gegenüber ${p.irrelevant})`,
  noModel: 'Kein lokales Embedding-Modell installiert',
  noVisionModel: 'Kein installiertes lokales Embedding-Modell kann Bilder lesen. Installiere EmbeddingGemma 2 740M, um nach dem Bildinhalt zu suchen',
  inputTooLong: (p: { index: number; max: number }) => `Text ${p.index} ist länger, als das Modell annimmt (${p.max} Token)`,
  modelUnavailable: (p: { problem: string }) => `Das lokale Embedding-Modell ist nicht verfügbar: ${p.problem}`,
  cannotEmbed: 'Dieser Model Worker kann mit diesem Modell noch keine Embeddings berechnen',
  embedReturned: (p: { code: string }) => `embed.run hat ${p.code} zurückgegeben`,
  selfTestPassed: (p: { dims: number; relevant: string; irrelevant: string; device: string }) => `${p.dims} Dimensionen · Kosinus ${p.relevant} gegenüber ${p.irrelevant} · ${p.device}`,
};
