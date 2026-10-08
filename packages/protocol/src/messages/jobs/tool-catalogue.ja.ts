import type { JobsToolCatalogueMessages } from './tool-catalogue.ts';

export const ja: JobsToolCatalogueMessages = {
  transcribeLabel: '文字起こし',
  transcribeDescription:
    'ローカルのメディアファイルまたは Space 内の動画を文字起こしします。動画の場合は新しい文字起こしを書き込んで字幕レイヤーを作成し、ファイルだけの場合は TXT と SRT を保存場所に書き込みます。新しい動画を作成することもできます。',
  translateSubtitlesLabel: '字幕を翻訳',
  translateSubtitlesDescription:
    '動画の文字起こしを文ごとに別の言語へ翻訳し、新しい翻訳として動画に書き込みます。SRT / VTT 字幕ファイル（ローカルファイルまたは Space 内の字幕項目）を新しい字幕ファイルに翻訳することもできます。',
  dubLabel: '翻訳吹き替え',
  dubDescription:
    '文字起こしをもとに（翻訳がなければ先に翻訳して）対象言語の音声を文ごとに合成し、タイミングを合わせて新しい吹き替えグループとして動画に書き込みます。',
  synthesizeSpeechLabel: '音声を生成',
  synthesizeSpeechDescription:
    'テキストから音声を合成します。結果は音声の生成物です。Space 内のドキュメントや字幕項目を読み上げることもできます（字幕はタイムコードを除きます）。',
  generateTextLabel: 'テキストを生成',
  generateTextDescription:
    'プロンプトからテキストを生成します（JSON Schema に従わせることもできます）。結果はテキストの生成物です。Space 内のドキュメントや字幕項目を素材として添付できます。',
  generateImageLabel: '画像を生成',
  generateImageDescription: '説明から画像を生成します。結果は画像の生成物です。',
  linkImportLabel: '動画をダウンロード',
  linkImportDescription:
    'yt-dlp で動画をこのコンピュータにダウンロードします。ブラウザの Cookie を使用でき、ダウンロードしたものを文字起こしと字幕にすることもできます。',
  compressVideoLabel: '動画を圧縮',
  compressVideoDescription:
    '動画ファイルを 1 つずつ圧縮します。ファイルからファイルへの処理で、動画は作成せず、生成物で既存のファイルを上書きしません。',
  mergeVideoLabel: '動画を結合',
  mergeVideoDescription:
    '複数の動画ファイルを順番に 1 つに結合します。ファイルからファイルへの処理で、動画は作成せず、生成物で既存のファイルを上書きしません。',
  extractAudioLabel: '音声を抽出',
  extractAudioDescription:
    '動画または音声ファイルから音声トラックを取り出します。一般的なコンテナに収まるコーデックはそのままコピーし、それ以外は AAC に再エンコードします。ファイルからファイルへの処理で、動画は作成せず、生成物で既存のファイルを上書きしません。',
};
