import type { JobsSpeechWorkerMessages } from './speech-worker.ts';

export const zhHans: JobsSpeechWorkerMessages = {
  incompatible: (p: { protocol: string }) => `Speech Worker 的协议不是 ${p.protocol}`,
  exited: 'Speech Worker 意外退出',
  translationLanguage: '译文的 language 与目标语言不符',
  outputInvalid: 'Speech Worker 的产出不合约定',
  outputTruncated: '模型的输出达到上限被截断',
  resultMissing: (p: { field: string }) => `Speech Worker 的结果缺少 ${p.field}`,
  unreadableFile: (p: { name: string }) => `读不了 Speech Worker 写出的 ${p.name}`,
  cuesNotObject: '字幕条不是对象',
  cuesSchema: (p: { schema: string }) => `字幕条的 schema 应为 ${p.schema}`,
  cuesLanguage: '字幕条的 language 与目标语言不符',
  cuesTimescale: '字幕条的 timescale 应与原文转写的相同',
  cuesMissing: '缺少 cues',
  cueNotObject: (p: { n: number }) => `第 ${p.n} 条字幕不是对象`,
  cueNoText: (p: { n: number }) => `第 ${p.n} 条字幕没有文字`,
  cueNoSentence: (p: { n: number }) => `第 ${p.n} 条字幕缺少句子或单元`,
  cueFallback: (p: { n: number }) => `第 ${p.n} 条字幕的 fallback 不是布尔值`,
  cueTicks: (p: { n: number }) => `第 ${p.n} 条字幕的时间不是整数刻度`,
  cueRange: (p: { n: number }) => `第 ${p.n} 条字幕的时间区间不合法`,
  cueOverlap: (p: { n: number }) => `第 ${p.n} 条字幕与前一条重叠或顺序不对`,
  cueBeyond: (p: { n: number }) => `第 ${p.n} 条字幕超出媒体时长`,
};
