import type { ToolTargetsMessages } from './tool-targets-copy.ts';

export const ja: ToolTargetsMessages = {
  unknownLanguage: '不明な言語',
  langCount: (label, count) => `${label} ×${count}`,
  joinLangs: (labels) => labels.join('、'),
  tagTranscript: (langs) => `文字起こし · ${langs}`,
  tagTranslation: (langs) => `翻訳 · ${langs}`,
  tagDub: (langs) => `吹き替え · ${langs}`,
  tagPending: 'まだ内容を読み込み中です。開始時に文字起こしが自動で選ばれます',
  blockTranscribing: '文字起こし中です。終わると再文字起こしできます',
  blockQueued: 'すでに文字起こしの待機中です',
  blockTranscribingWait: '文字起こし中です。終わると選べます',
  blockQueuedWait: '文字起こしの待機中です。文字起こしが終わると選べます',
  blockFailed: '前回の文字起こしに失敗しました。先にもう一度文字起こししてください',
  blockNoTranscript: 'まだ文字起こしがありません。先に文字起こししてください',
  duplicateTranscript: (langs) =>
    `この動画にはすでに${langs}の文字起こしがあります。既定では新しい動画を作成し、この動画とその訳文はそのまま残ります。「この動画の文字起こしを置き換える」を選ぶと現在の文字起こしを差し替え、訳文は原文の対応づけで引き継がれ、原文が変わった文は古い訳文として印が付きます。1 回の操作として取り消せます。`,
  duplicateTranslation: (lang) =>
    `この動画にはすでに${lang}訳があります。今回は新しく追加され、既存のものも残ります。どれを使うかはエディタで選んでください。`,
  duplicateDub: (lang) => `この動画にはすでに${lang}の吹き替えがあります。今回は新しいセットを追加し、既存のものも残ります。`,
  duplicateTitle: {
    transcribe: '既存の文字起こしがあります',
    'translate-subtitles': '既存の翻訳は残ります',
    dub: '既存の吹き替えは残ります',
  },
  translationOption: (lang, nth) => `${lang}訳${nth === null ? '' : ` #${nth}`}`,
  translatedFrom: (lang) => `${lang}の文字起こしから翻訳`,
  destNewVideo: '新しい動画',
  destNewVideoNote: '同じプロジェクトに新しい動画を作り、同じ素材にリンクします。この動画とその訳文はそのままです',
  destReplace: 'この動画の文字起こしを置き換える',
  destReplaceNote: '現在の文字起こしを差し替え、訳文・字幕・吹き替えを同じ 1 回の操作で引き継ぎます。取り消せます',
  newVideoName: (name) => `${name} · 再文字起こし`,
  impactTranslation: (lang, units) => `${lang} · ${units} 文`,
  impactDub: (lang, groups) => `${lang} · ${groups} セット · 訳文が変わらない文の吹き替えは残し、ずれている可能性ありと表示`,
  impactRule:
    '原文が変わらない文は訳文とレビュー状態を残し、対応づけは文単位になります。原文が変わった文や対応づけできない文は古い訳文として印が付き、完了後に「古くなった訳文を更新」で訳し直せます。具体的な文数は結果に表示されます。',
  impactUndo: '1 回の操作として取り消せます',
};
