import type { ModelsEmbeddingMessages } from './embedding.ts';

export const pl: ModelsEmbeddingMessages = {
  apacheLicense: 'Apache-2.0: darmowe użycie, także komercyjne; przy redystrybucji zachowaj informacje o prawach autorskich i licencji',
  runtimeNoBuild: (p: { platform: string }) => `LiteRT-LM nie ma kompilacji dla tego komputera (${p.platform}), więc lokalne wyszukiwanie semantyczne nie jest tu jeszcze dostępne`,
  runtimeNotInstalled: (p: { version: string }) => `LiteRT-LM ${p.version} nie jest zainstalowany`,
  countMismatch: (p: { expected: number; actual: number }) => `Oczekiwano ${p.expected} wektorów, otrzymano ${p.actual}`,
  wrongDims: (p: { expected: number; actual: number }) => `Wektor ma ${p.actual} wymiarów zamiast ${p.expected}`,
  notFinite: 'Wektor zawiera wartość, która nie jest liczbą skończoną',
  notNormalized: (p: { norm: string }) => `Wektor nie ma długości 1 (norma ${p.norm})`,
  notRanked: (p: { relevant: string; irrelevant: string }) => `Powiązane zdanie nie uzyskało wyższego wyniku niż niepowiązane (cosinus ${p.relevant} wobec ${p.irrelevant})`,
  noModel: 'Nie zainstalowano lokalnego modelu embeddingów',
  noVisionModel: 'Żaden zainstalowany lokalny model embeddingów nie odczytuje obrazów. Zainstaluj EmbeddingGemma 2 740M, aby szukać według tego, co widać na ekranie',
  inputTooLong: (p: { index: number; max: number }) => `Tekst ${p.index} jest dłuższy, niż przyjmuje model (${p.max} tokenów)`,
  modelUnavailable: (p: { problem: string }) => `Lokalny model embeddingów jest niedostępny: ${p.problem}`,
  cannotEmbed: 'Ten Model Worker nie potrafi jeszcze obliczać embeddingów tym modelem',
  embedReturned: (p: { code: string }) => `embed.run zwrócił ${p.code}`,
  selfTestPassed: (p: { dims: number; relevant: string; irrelevant: string; device: string }) => `${p.dims} wymiarów · cosinus ${p.relevant} wobec ${p.irrelevant} · ${p.device}`,
};
