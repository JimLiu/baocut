import type { ExportSettingsMessages } from './export-settings.ts';

export const zhHant: ExportSettingsMessages = {
  quality: { small: '較小檔案', standard: '標準', high: '高畫質' },
  qualityNote: {
    small: '壓縮較強，細節略少，檔案較小',
    standard: '預設的畫質與檔案大小',
    high: '細節更多，檔案較大',
  },
  loudnessOn: (lufs: string, truePeak: string) => `將整體混音標準化為 ${lufs} LUFS，真峰值不超過 ${truePeak} dBTP。`,
  loudnessOff: '關閉：依影片中的混音原樣匯出。',
  audioFormatNote: {
    wav: '無損 · 檔案最大 · 適合再進行後製',
    mp3: '通用 · 適用於 Podcast 平台、車用音響和舊型裝置',
    m4a: 'AAC · 相同位元率下比 MP3 清晰一些 · Apple 裝置原生支援',
  },
  dubGroup: (language: string | null) => `${language ?? '這組'}配音`,
  mix: '成品混音',
  mixNote: '與目前在時間軸上聽到的相同',
  originalOnly: '僅原聲',
  originalOnlyNote: '移除所有配音，並回復被配音靜音的原聲',
  dubOnly: (label: string) => `僅${label}`,
  dubOnlyNote: '只保留這組配音，不含原聲、音樂或其他配音',
  mono: '單聲道',
  stereo: '立體聲',
  subtitleFormatNote: {
    srt: '通用：幾乎所有播放器和平台都支援',
    vtt: '適用於網頁播放器，含位置提示',
    ass: '保留字幕樣式（字型、外框、位置）；支援的播放器較少',
    json: '每個項目都含逐詞時間戳記，供腳本和工具使用',
  },
  transcription: '逐字稿',
  plainText: '純文字',
  transcriptFormatNote: {
    md: '可加文首資訊，章節成為小標題、說話者加粗、譯文成為引用 · 貼進筆記或文件',
    txt: '不含標記語法 · 章節標題單獨一行',
  },
};
