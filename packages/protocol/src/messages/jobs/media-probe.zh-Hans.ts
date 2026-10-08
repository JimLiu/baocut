import type { JobsMediaProbeMessages } from './media-probe.ts';

export const zhHans: JobsMediaProbeMessages = {
  unknownMediaType: (p: { mediaType: string }) => `不认识的媒体类型 ${p.mediaType}`,
  unreadable: '输出文件读不出来',
  headerMismatch: (p: { sniffed: string; mediaType: string }) => `文件头是 ${p.sniffed}，声明的是 ${p.mediaType}`,
  unrecognizedFormat: '无法识别的格式',
  notJson: 'ffprobe 的输出不是 JSON',
  noAudioStream: '没有音频流',
  noImage: '没有图像',
  noFrames: '解不出任何一帧',
  durationNotPositive: '时长不是正数',
  sampleRateNotPositive: '采样率不是正数',
  channelsNotPositive: '声道数不是正数',
  sizeNotPositive: '宽高不是正数',
  cannotRun: (p: { reason: string }) => `ffprobe 无法运行：${p.reason}`,
  killedBy: (p: { signal: string }) => `被 ${p.signal} 终止`,
  exitCode: (p: { code: string }) => `退出码 ${p.code}`,
  decodeFailed: (p: { reason: string }) => `ffprobe 解码失败（${p.reason}）`,
  decodeFailedWith: (p: { reason: string; output: string }) => `ffprobe 解码失败（${p.reason}）：${p.output}`,
  noProbe: '没有可用的 ffprobe，无法校验输出',
};
