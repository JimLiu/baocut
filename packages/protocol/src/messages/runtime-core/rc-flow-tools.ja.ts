import type { RcFlowToolsMessages } from './rc-flow-tools.ts';

function providerNote(p: { provider: string | null; model: string | null }): string {
  return p.provider ? `（${p.provider}${p.model ? ` ${p.model}` : ''}）` : '';
}

function originalLabel(original: string): string {
  switch (original) {
    case 'mute':
      return 'ミュート';
    case 'keep':
      return 'そのまま';
    default:
      return '音量を下げる';
  }
}

function transcodeAction(action: string): string {
  switch (action) {
    case 'merge':
      return 'を順番に結合';
    case 'extract-audio':
      return 'から音声を抽出';
    default:
      return 'を圧縮';
  }
}

export const ja: RcFlowToolsMessages = {
  listSeparator: '、',

  transcribeVideoSummary: (p) =>
    `${p.asset ? `素材 ${p.asset} ` : 'メイントラックの素材'}を文字起こし${providerNote(p)}${p.captions ? '、字幕レイヤーを追加' : ''}`,
  transcribeFileSummary: (p) =>
    `${p.file} を文字起こし${providerNote(p)}、TXT と SRT の文字起こしを${p.outDir ? ` ${p.outDir} ` : 'ダウンロードフォルダ'}に書き出し`,
  transcribeCreateSummary: (p) =>
    `動画${p.name ? `「${p.name}」` : ''}を作成し、${p.file} を読み込んでタイムラインに追加してから文字起こし${providerNote(p)}${p.captions ? '、字幕レイヤーを追加' : ''}`,

  translateVideoSummary: (p) =>
    `テキストモデルで文字起こしを ${p.to} に翻訳${providerNote(p)}${p.captions ? `、${p.bilingual ? 'バイリンガル' : ''}字幕レイヤーを追加` : ''}`,
  translateFileSummary: (p) =>
    `テキストモデルで字幕ファイル ${p.input} を ${p.to} に翻訳${providerNote(p)}、新しいファイルを${p.outDir ? ` ${p.outDir} ` : 'ダウンロードフォルダ'}に書き出し`,

  dubSummary: (p) =>
    `翻訳吹き替え${p.to ? `（${p.to}）` : ''}：${p.translation ? `翻訳 ${p.translation} を使用` : '先にテキストモデルで翻訳'}、1 文ずつ音声合成${providerNote(p)}${p.voice ? `、声 ${p.voice}` : ''}、新しい吹き替えトラックを追加、元の音声は${originalLabel(p.original)}`,

  transcodeSummary: (p) =>
    `${p.count} 個のファイル（${p.files}${p.truncated ? '…' : ''}）${transcodeAction(p.action)}し、${p.outDir ? `${p.outDir} ` : 'ダウンロードフォルダ'}に保存`,
  transcribeReplaceSummary: (p) =>
    `${p.asset ? `素材 ${p.asset}` : 'メイントラックの素材'}を再文字起こし${providerNote(p)}し、動画の現在の文字起こしを置き換えて翻訳・字幕・吹き替えを引き継ぐ（取り消せる 1 回の操作）`,
};
