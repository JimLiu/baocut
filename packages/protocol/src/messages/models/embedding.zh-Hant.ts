import type { ModelsEmbeddingMessages } from './embedding.ts';

export const zhHant: ModelsEmbeddingMessages = {
  apacheLicense: 'Apache-2.0：可免費使用，包括商業用途；再散布時保留版權與授權聲明',
  runtimeNoBuild: (p: { platform: string }) => `LiteRT-LM 沒有這台機器（${p.platform}）的版本，這裡暫時不能使用本機語意檢索`,
  runtimeNotInstalled: (p: { version: string }) => `LiteRT-LM ${p.version} 沒有安裝`,
  countMismatch: (p: { expected: number; actual: number }) => `應得到 ${p.expected} 個向量，實際是 ${p.actual} 個`,
  wrongDims: (p: { expected: number; actual: number }) => `有向量是 ${p.actual} 維，應是 ${p.expected} 維`,
  notFinite: '有向量含非有限數值',
  notNormalized: (p: { norm: string }) => `有向量的長度不是 1（範數 ${p.norm}）`,
  notRanked: (p: { relevant: string; irrelevant: string }) => `相關句子的得分沒有高過無關句子（餘弦 ${p.relevant} 對 ${p.irrelevant}）`,
  noModel: '沒有安裝本機 embedding 模型',
  noVisionModel: '已安裝的本機 embedding 模型都讀不了圖片。按畫面檢索要裝 EmbeddingGemma 2 740M',
  inputTooLong: (p: { index: number; max: number }) => `第 ${p.index} 段文字超過了模型能接受的長度（${p.max} 個 token）`,
  modelUnavailable: (p: { problem: string }) => `本機 embedding 模型無法使用：${p.problem}`,
  cannotEmbed: '這個 Model Worker 還不能用這個模型計算 embedding',
  embedReturned: (p: { code: string }) => `embed.run 傳回了 ${p.code}`,
  selfTestPassed: (p: { dims: number; relevant: string; irrelevant: string; device: string }) => `${p.dims} 維 · 餘弦 ${p.relevant} 對 ${p.irrelevant} · ${p.device}`,
};
