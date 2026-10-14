import type { ModelsEmbeddingMessages } from './embedding.ts';

export const zhHans: ModelsEmbeddingMessages = {
  apacheLicense: 'Apache-2.0：可免费使用，包括商业用途；再分发时保留版权与许可声明',
  runtimeNoBuild: (p: { platform: string }) => `LiteRT-LM 没有这台机器（${p.platform}）的版本，这里暂时不能用本机语义检索`,
  runtimeNotInstalled: (p: { version: string }) => `LiteRT-LM ${p.version} 没有安装`,
  countMismatch: (p: { expected: number; actual: number }) => `应得到 ${p.expected} 个向量，实际是 ${p.actual} 个`,
  wrongDims: (p: { expected: number; actual: number }) => `有向量是 ${p.actual} 维，应是 ${p.expected} 维`,
  notFinite: '有向量含非有限数值',
  notNormalized: (p: { norm: string }) => `有向量的长度不是 1（范数 ${p.norm}）`,
  notRanked: (p: { relevant: string; irrelevant: string }) => `相关句子的得分没有高过无关句子（余弦 ${p.relevant} 对 ${p.irrelevant}）`,
  noModel: '没有安装本机 embedding 模型',
  noVisionModel: '已安装的本机 embedding 模型都读不了图片。按画面检索要装 EmbeddingGemma 2 740M',
  inputTooLong: (p: { index: number; max: number }) => `第 ${p.index} 段文字超过了模型能接受的长度（${p.max} 个 token）`,
  modelUnavailable: (p: { problem: string }) => `本机 embedding 模型不可用：${p.problem}`,
  cannotEmbed: '这个 Model Worker 还不能用这个模型计算 embedding',
  embedReturned: (p: { code: string }) => `embed.run 返回了 ${p.code}`,
  selfTestPassed: (p: { dims: number; relevant: string; irrelevant: string; device: string }) => `${p.dims} 维 · 余弦 ${p.relevant} 对 ${p.irrelevant} · ${p.device}`,
};
