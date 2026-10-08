import type { JobsTranslateSubtitlesMessages } from './translate-subtitles.ts';

export const zhHant: JobsTranslateSubtitlesMessages = {
  label: '翻譯字幕檔案',
  description: '把 SRT 或 WebVTT 字幕檔案逐條翻譯成另一種語言，寫成新的字幕檔案：字幕條數與時間碼不變，結果可以是雙語或換成其他格式；不會更動影片。',
  stepRead: '讀取字幕',
  stepTranslate: '翻譯',
  stepCheck: '核對',
  stepPublish: '發布',
  noStructuredOutput: (p: { model: string }) => `模型 ${p.model} 不支援結構化輸出，因此無法用於翻譯`,
  artifactGone: (p: { artifactId: string }) => `產出 ${p.artifactId} 已不存在`,
  paramNotAbsolute: (p: { key: string }) => `參數 ${p.key} 必須是絕對路徑`,
  inputNotSubtitle: '參數 input 必須是 .srt 或 .vtt 檔案',
  languageInvalid: (p: { key: string }) => `參數 ${p.key} 必須是 BCP 47 語言標籤`,
  bilingualInvalid: '參數 bilingual 必須是 true 或 false',
  fileNotFound: (p: { file: string }) => `找不到字幕檔案 ${p.file}`,
  fileTooLarge: (p: { bytes: number; limit: number }) => `字幕檔案大小為 ${p.bytes} 位元組，超過上限 ${p.limit}`,
  noText: '字幕檔案中沒有可翻譯的文字',
  allEmpty: '每一條字幕都是空的',
  markupStripped: (p: { count: number }) => `${p.count} 條字幕含有行內標記（斜體、顏色、位置等），譯文中沒有保留`,
  cueNoTranslation: (p: { n: number }) => `第 ${p.n} 條字幕沒有譯文`,
  rereadFailed: '無法讀回寫出的字幕',
  cueCountMismatch: (p: { written: number; original: number }) => `寫出 ${p.written} 條字幕，原始檔案有 ${p.original} 條`,
  timingChanged: (p: { n: number; from: string; to: string }) => `第 ${p.n} 條字幕的時間碼變了：${p.from} → ${p.to}`,
  cannotMatch: '譯文無法寫成與原始檔案一一對應的字幕',
  settingsDropped: (p: { settings: number; blocks: number }) =>
    `已轉成 SRT：${p.settings} 條字幕的 cue settings 與 ${p.blocks} 個 NOTE、STYLE、REGION 區塊無法保留`,
};
