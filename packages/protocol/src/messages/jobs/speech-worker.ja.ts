import type { JobsSpeechWorkerMessages } from './speech-worker.ts';

export const ja: JobsSpeechWorkerMessages = {
  incompatible: (p: { protocol: string }) => `Speech Worker のプロトコルが ${p.protocol} ではありません`,
  exited: 'Speech Worker が予期せず終了しました',
  translationLanguage: '翻訳の言語が対象言語と一致しません',
  outputInvalid: 'Speech Worker の出力が規定に合っていません',
  outputTruncated: 'モデルの出力が上限に達して途中で切れました',
  resultMissing: (p: { field: string }) => `Speech Worker の結果に ${p.field} がありません`,
  unreadableFile: (p: { name: string }) => `Speech Worker が書き込んだ ${p.name} を読み取れません`,
  cuesNotObject: '字幕データがオブジェクトではありません',
  cuesSchema: (p: { schema: string }) => `字幕データの schema は ${p.schema} である必要があります`,
  cuesLanguage: '字幕データの言語が対象言語と一致しません',
  cuesTimescale: '字幕データの timescale は元の文字起こしと同じである必要があります',
  cuesMissing: 'cues がありません',
  cueNotObject: (p: { n: number }) => `${p.n} 番目の字幕がオブジェクトではありません`,
  cueNoText: (p: { n: number }) => `${p.n} 番目の字幕にテキストがありません`,
  cueNoSentence: (p: { n: number }) => `${p.n} 番目の字幕に文またはユニットがありません`,
  cueFallback: (p: { n: number }) => `${p.n} 番目の字幕の fallback がブール値ではありません`,
  cueTicks: (p: { n: number }) => `${p.n} 番目の字幕の時間が整数のティックではありません`,
  cueRange: (p: { n: number }) => `${p.n} 番目の字幕の時間範囲が無効です`,
  cueOverlap: (p: { n: number }) => `${p.n} 番目の字幕が前の字幕と重なっているか、順序が正しくありません`,
  cueBeyond: (p: { n: number }) => `${p.n} 番目の字幕がメディアの長さを超えています`,
};
