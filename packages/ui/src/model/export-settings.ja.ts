import type { ExportSettingsMessages } from './export-settings.ts';

export const ja: ExportSettingsMessages = {
  quality: { small: 'サイズ優先', standard: '標準', high: '高画質' },
  qualityNote: {
    small: '圧縮を強めるため細部がやや減り、ファイルは小さくなります',
    standard: '既定の画質とサイズ',
    high: '細部が多く、ファイルは大きくなります',
  },
  loudnessOn: (lufs: string, truePeak: string) => `ミックス全体を ${lufs} LUFS にノーマライズし、トゥルーピークを ${truePeak} dBTP 以下に抑えます。`,
  loudnessOff: 'オフ：動画内のミックスをそのまま書き出します。',
  audioFormatNote: {
    wav: 'ロスレス · ファイルが最大 · ポストプロダクションでさらに加工する場合に',
    mp3: '汎用 · ポッドキャスト配信、カーステレオ、古い機器でも使えます',
    m4a: 'AAC · 同じビットレートなら MP3 より少しクリア · Apple デバイスで標準対応',
  },
  dubGroup: (language: string | null) => (language ? `${language} の吹き替え` : 'この吹き替えグループ'),
  mix: '書き出し用ミックス',
  mixNote: 'いまタイムラインで聞こえる音と同じ',
  originalOnly: '元の音声のみ',
  originalOnlyNote: 'すべての吹き替えを除き、吹き替えでミュートされた元の音声を戻します',
  dubOnly: (label: string) => `${label} のみ`,
  dubOnlyNote: 'この吹き替えグループだけを残し、元の音声、音楽、ほかの吹き替えは含めません',
  mono: 'モノラル',
  stereo: 'ステレオ',
  subtitleFormatNote: {
    srt: '汎用：ほぼすべてのプレーヤとプラットフォームで使えます',
    vtt: 'Web プレーヤ向け、位置のヒント付き',
    ass: '字幕のスタイル（フォント、縁取り、位置）を保持します。対応するプレーヤは少なめです',
    json: '各エントリに単語単位のタイムスタンプ付き。スクリプトやツール向け',
  },
  transcription: '文字起こし',
  plainText: 'プレーンテキスト',
  transcriptFormatNote: {
    md: 'フロントマターを付けられます。章は見出し、話者は太字、訳文は引用になります · メモや文書に貼り付け',
    txt: '書式記号なし · 章見出しは独立した行',
  },
};
