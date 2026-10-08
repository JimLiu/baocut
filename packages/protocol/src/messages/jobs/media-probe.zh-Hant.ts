import type { JobsMediaProbeMessages } from './media-probe.ts';

export const zhHant: JobsMediaProbeMessages = {
  unknownMediaType: (p: { mediaType: string }) => `無法辨識的媒體類型 ${p.mediaType}`,
  unreadable: '無法讀取輸出檔案',
  headerMismatch: (p: { sniffed: string; mediaType: string }) => `檔頭是 ${p.sniffed}，但宣告為 ${p.mediaType}`,
  unrecognizedFormat: '無法辨識的格式',
  notJson: 'ffprobe 的輸出不是 JSON',
  noAudioStream: '沒有音訊串流',
  noImage: '沒有影像',
  noFrames: '連一個影格都無法解碼',
  durationNotPositive: '時長不是正數',
  sampleRateNotPositive: '取樣率不是正數',
  channelsNotPositive: '聲道數不是正數',
  sizeNotPositive: '寬度或高度不是正數',
  cannotRun: (p: { reason: string }) => `無法執行 ffprobe：${p.reason}`,
  killedBy: (p: { signal: string }) => `被 ${p.signal} 終止`,
  exitCode: (p: { code: string }) => `結束代碼 ${p.code}`,
  decodeFailed: (p: { reason: string }) => `ffprobe 解碼失敗（${p.reason}）`,
  decodeFailedWith: (p: { reason: string; output: string }) => `ffprobe 解碼失敗（${p.reason}）：${p.output}`,
  noProbe: '無法使用 ffprobe，因此無法檢查輸出',
};
