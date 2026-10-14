import type { ModelsEmbeddingMessages } from './embedding.ts';

export const ru: ModelsEmbeddingMessages = {
  apacheLicense: 'Apache-2.0: можно использовать бесплатно, в том числе в коммерческих целях; при распространении сохраняйте уведомления об авторских правах и лицензии',
  runtimeNoBuild: (p: { platform: string }) => `Для этого компьютера (${p.platform}) нет сборки LiteRT-LM, поэтому локальный семантический поиск здесь пока недоступен`,
  runtimeNotInstalled: (p: { version: string }) => `LiteRT-LM ${p.version} не установлен`,
  countMismatch: (p: { expected: number; actual: number }) => `Ожидалось векторов: ${p.expected}, получено: ${p.actual}`,
  wrongDims: (p: { expected: number; actual: number }) => `У вектора ${p.actual} измерений вместо ${p.expected}`,
  notFinite: 'Вектор содержит значение, которое не является конечным числом',
  notNormalized: (p: { norm: string }) => `Длина вектора не равна 1 (норма ${p.norm})`,
  notRanked: (p: { relevant: string; irrelevant: string }) => `Связанное предложение не получило оценку выше несвязанного (косинус ${p.relevant} против ${p.irrelevant})`,
  noModel: 'Локальная модель эмбеддингов не установлена',
  noVisionModel: 'Ни одна установленная локальная модель эмбеддингов не читает изображения. Установите EmbeddingGemma 2 740M, чтобы искать по содержимому кадра',
  inputTooLong: (p: { index: number; max: number }) => `Текст ${p.index} длиннее, чем принимает модель (${p.max} токенов)`,
  modelUnavailable: (p: { problem: string }) => `Локальная модель эмбеддингов недоступна: ${p.problem}`,
  cannotEmbed: 'Этот Model Worker пока не умеет вычислять эмбеддинги этой моделью',
  embedReturned: (p: { code: string }) => `embed.run вернул ${p.code}`,
  selfTestPassed: (p: { dims: number; relevant: string; irrelevant: string; device: string }) => `${p.dims} измерений · косинус ${p.relevant} против ${p.irrelevant} · ${p.device}`,
};
