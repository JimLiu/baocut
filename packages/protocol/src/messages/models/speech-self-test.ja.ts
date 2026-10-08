import type { ModelsSpeechSelfTestMessages } from './speech-self-test.ts';

export const ja: ModelsSpeechSelfTestMessages = {
  notWav: 'RIFF/WAVE ファイルではありません',
  missingFmt: 'fmt チャンクがありません',
  missingData: 'data チャンクがありません',
  unsupportedEncoding: (p: { format: number }) => `対応していないエンコードです（${p.format}）`,
  badChannels: (p: { channels: number }) => `チャンネル数が不正です（${p.channels}）`,
  badSampleRate: (p: { sampleRate: number }) => `サンプルレートが不正です（${p.sampleRate}）`,
  unsupportedBitDepth: (p: { bits: number }) => `対応していないビット深度です（${p.bits}）`,
  nonFinite: 'サンプルに有限でない値が含まれています',
  undecodable: (p: { problem: string }) => `出力をデコードできません：${p.problem}`,
  durationOutOfRange: (p: { duration: string; min: number; max: number }) =>
    `長さ ${p.duration} 秒が ${p.min}〜${p.max} 秒の範囲に入っていません`,
  silent: '出力が無音です',
  clipped: (p: { ratio: string; limit: number }) =>
    `出力がクリッピングしています：サンプルの ${p.ratio}% がフルスケールに達しています（上限 ${p.limit}%）`,
};
