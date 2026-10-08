import type { JobsSpeechWorkerMessages } from './speech-worker.ts';

export const zhHant: JobsSpeechWorkerMessages = {
  incompatible: (p: { protocol: string }) => `Speech Worker 的協定不是 ${p.protocol}`,
  exited: 'Speech Worker 意外結束',
  translationLanguage: '譯文的 language 與目標語言不符',
  outputInvalid: 'Speech Worker 的產出不符合合約',
  outputTruncated: '模型的輸出達到上限而被截斷',
  resultMissing: (p: { field: string }) => `Speech Worker 的結果缺少 ${p.field}`,
  unreadableFile: (p: { name: string }) => `無法讀取 Speech Worker 寫出的 ${p.name}`,
  cuesNotObject: '字幕條不是物件',
  cuesSchema: (p: { schema: string }) => `字幕條的 schema 必須是 ${p.schema}`,
  cuesLanguage: '字幕條的 language 與目標語言不符',
  cuesTimescale: '字幕條的 timescale 必須與原文逐字稿相同',
  cuesMissing: '缺少 cues',
  cueNotObject: (p: { n: number }) => `第 ${p.n} 條字幕不是物件`,
  cueNoText: (p: { n: number }) => `第 ${p.n} 條字幕沒有文字`,
  cueNoSentence: (p: { n: number }) => `第 ${p.n} 條字幕缺少句子或單元`,
  cueFallback: (p: { n: number }) => `第 ${p.n} 條字幕的 fallback 不是布林值`,
  cueTicks: (p: { n: number }) => `第 ${p.n} 條字幕的時間不是整數刻度`,
  cueRange: (p: { n: number }) => `第 ${p.n} 條字幕的時間區間無效`,
  cueOverlap: (p: { n: number }) => `第 ${p.n} 條字幕與前一條重疊或順序錯誤`,
  cueBeyond: (p: { n: number }) => `第 ${p.n} 條字幕超出媒體時長`,
};
