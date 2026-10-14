import type { ModelsEmbeddingMessages } from './embedding.ts';

export const nl: ModelsEmbeddingMessages = {
  apacheLicense: 'Apache-2.0: vrij te gebruiken, ook commercieel; behoud bij herdistributie de copyright- en licentievermeldingen',
  runtimeNoBuild: (p: { platform: string }) => `LiteRT-LM heeft geen build voor deze computer (${p.platform}), dus lokaal semantisch zoeken is hier nog niet beschikbaar`,
  runtimeNotInstalled: (p: { version: string }) => `LiteRT-LM ${p.version} is niet geïnstalleerd`,
  countMismatch: (p: { expected: number; actual: number }) => `${p.expected} vectoren verwacht, maar ${p.actual} gekregen`,
  wrongDims: (p: { expected: number; actual: number }) => `Een vector heeft ${p.actual} dimensies in plaats van ${p.expected}`,
  notFinite: 'Een vector bevat een waarde die geen eindig getal is',
  notNormalized: (p: { norm: string }) => `Een vector heeft geen lengte 1 (norm ${p.norm})`,
  notRanked: (p: { relevant: string; irrelevant: string }) => `De verwante zin scoorde niet hoger dan de niet-verwante (cosinus ${p.relevant} tegen ${p.irrelevant})`,
  noModel: 'Er is geen lokaal embeddingmodel geïnstalleerd',
  noVisionModel: 'Geen geïnstalleerd lokaal embeddingmodel kan afbeeldingen lezen. Installeer EmbeddingGemma 2 740M om te zoeken op wat er in beeld is',
  inputTooLong: (p: { index: number; max: number }) => `Tekst ${p.index} is langer dan het model accepteert (${p.max} tokens)`,
  modelUnavailable: (p: { problem: string }) => `Het lokale embeddingmodel is niet beschikbaar: ${p.problem}`,
  cannotEmbed: 'Deze Model Worker kan met dit model nog geen embeddings berekenen',
  embedReturned: (p: { code: string }) => `embed.run gaf ${p.code} terug`,
  selfTestPassed: (p: { dims: number; relevant: string; irrelevant: string; device: string }) => `${p.dims} dimensies · cosinus ${p.relevant} tegen ${p.irrelevant} · ${p.device}`,
};
