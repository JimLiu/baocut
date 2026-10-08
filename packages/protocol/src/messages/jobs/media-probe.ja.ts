import type { JobsMediaProbeMessages } from './media-probe.ts';

export const ja: JobsMediaProbeMessages = {
  unknownMediaType: (p: { mediaType: string }) => `認識できないメディアタイプです：${p.mediaType}`,
  unreadable: '生成物のファイルを読み取れませんでした',
  headerMismatch: (p: { sniffed: string; mediaType: string }) => `ファイルヘッダは ${p.sniffed} ですが、${p.mediaType} として宣言されています`,
  unrecognizedFormat: '認識できない形式',
  notJson: 'ffprobe の出力が JSON ではありません',
  noAudioStream: '音声ストリームがありません',
  noImage: '画像がありません',
  noFrames: '1 フレームもデコードできませんでした',
  durationNotPositive: '長さが正の値ではありません',
  sampleRateNotPositive: 'サンプルレートが正の値ではありません',
  channelsNotPositive: 'チャンネル数が正の値ではありません',
  sizeNotPositive: '幅または高さが正の値ではありません',
  cannotRun: (p: { reason: string }) => `ffprobe を実行できませんでした：${p.reason}`,
  killedBy: (p: { signal: string }) => `${p.signal} で強制終了`,
  exitCode: (p: { code: string }) => `終了コード ${p.code}`,
  decodeFailed: (p: { reason: string }) => `ffprobe でデコードできませんでした（${p.reason}）`,
  decodeFailedWith: (p: { reason: string; output: string }) => `ffprobe でデコードできませんでした（${p.reason}）：${p.output}`,
  noProbe: 'ffprobe を使用できないため、生成物を確認できません',
};
