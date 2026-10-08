import type { JobsTranslateSubtitlesMessages } from './translate-subtitles.ts';

export const ja: JobsTranslateSubtitlesMessages = {
  label: '字幕ファイルを翻訳',
  description:
    'SRT または WebVTT 字幕ファイルを字幕ごとに別の言語へ翻訳し、新しい字幕ファイルに書き込みます。字幕の数とタイムコードは変わりません。2 言語表示にしたり、別の形式にしたりできます。動画には手を加えません。',
  stepRead: '字幕の読み取り',
  stepTranslate: '翻訳',
  stepCheck: '確認',
  stepPublish: '生成物の配置',
  noStructuredOutput: (p: { model: string }) => `モデル ${p.model} は構造化出力に対応していないため、翻訳には使用できません`,
  artifactGone: (p: { artifactId: string }) => `生成物 ${p.artifactId} はもう存在しません`,
  paramNotAbsolute: (p: { key: string }) => `パラメータ ${p.key} は絶対パスである必要があります`,
  inputNotSubtitle: 'パラメータ input は .srt または .vtt ファイルである必要があります',
  languageInvalid: (p: { key: string }) => `パラメータ ${p.key} は BCP 47 言語タグである必要があります`,
  bilingualInvalid: 'パラメータ bilingual は true または false である必要があります',
  fileNotFound: (p: { file: string }) => `字幕ファイル ${p.file} が見つかりませんでした`,
  fileTooLarge: (p: { bytes: number; limit: number }) => `字幕ファイルは ${p.bytes} バイトで、上限の ${p.limit} バイトを超えています`,
  noText: '字幕ファイルに翻訳するテキストがありません',
  allEmpty: 'すべての字幕が空です',
  markupStripped: (p: { count: number }) =>
    `${p.count} 件の字幕にインラインのマークアップ（斜体、色、位置など）がありましたが、翻訳では保持されていません`,
  cueNoTranslation: (p: { n: number }) => `${p.n} 番目の字幕に翻訳がありません`,
  rereadFailed: '書き込んだ字幕を読み戻せませんでした',
  cueCountMismatch: (p: { written: number; original: number }) =>
    `${p.written} 件の字幕を書き込みましたが、元のファイルには ${p.original} 件あります`,
  timingChanged: (p: { n: number; from: string; to: string }) => `${p.n} 番目の字幕のタイムコードが変わりました：${p.from} → ${p.to}`,
  cannotMatch: '翻訳を、元のファイルと 1 対 1 で対応する字幕として書き込めません',
  settingsDropped: (p: { settings: number; blocks: number }) =>
    `SRT に変換しました：${p.settings} 件の字幕の cue settings と、${p.blocks} 個の NOTE、STYLE、REGION ブロックは SRT に収まらないため保持されていません`,
};
