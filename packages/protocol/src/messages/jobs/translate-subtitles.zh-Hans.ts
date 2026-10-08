import type { JobsTranslateSubtitlesMessages } from './translate-subtitles.ts';

export const zhHans: JobsTranslateSubtitlesMessages = {
  label: '翻译字幕文件',
  description: '把一个 SRT 或 WebVTT 字幕文件逐条翻译成一种语言，写成新的字幕文件：条数与时间码不变，可以双语、可以换格式；不碰视频。',
  stepRead: '读取字幕',
  stepTranslate: '翻译',
  stepCheck: '核对',
  stepPublish: '发布',
  noStructuredOutput: (p: { model: string }) => `模型 ${p.model} 不支持结构化输出，不能用于翻译`,
  artifactGone: (p: { artifactId: string }) => `产物 ${p.artifactId} 已经不在了`,
  paramNotAbsolute: (p: { key: string }) => `参数 ${p.key} 应为绝对路径`,
  inputNotSubtitle: '参数 input 应为 .srt 或 .vtt 文件',
  languageInvalid: (p: { key: string }) => `参数 ${p.key} 应为 BCP 47 语言标签`,
  bilingualInvalid: '参数 bilingual 应为 true 或 false',
  fileNotFound: (p: { file: string }) => `找不到字幕文件 ${p.file}`,
  fileTooLarge: (p: { bytes: number; limit: number }) => `字幕文件 ${p.bytes} 字节，超过上限 ${p.limit}`,
  noText: '字幕文件里没有可翻译的文本',
  allEmpty: '每一条都是空的',
  markupStripped: (p: { count: number }) => `${p.count} 条字幕带行内标记（斜体、颜色、位置等），译文里没有保留`,
  cueNoTranslation: (p: { n: number }) => `第 ${p.n} 条没有译文`,
  rereadFailed: '写出的字幕读不回来',
  cueCountMismatch: (p: { written: number; original: number }) => `写出 ${p.written} 条，原文件 ${p.original} 条`,
  timingChanged: (p: { n: number; from: string; to: string }) => `第 ${p.n} 条的时间码变了：${p.from} → ${p.to}`,
  cannotMatch: '译文不能写成与原文件一一对应的字幕',
  settingsDropped: (p: { settings: number; blocks: number }) =>
    `转成 SRT：${p.settings} 条的 cue settings 与 ${p.blocks} 个 NOTE、STYLE、REGION 块放不下，没有保留`,
};
