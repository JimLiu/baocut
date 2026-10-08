import type { TtsLocalMessages } from './models-tts-local-copy.ts';

const LANG_SHORT: Record<string, string> = {
  zh: '中',
  en: '英',
  ja: '日',
  ko: '韓',
  de: '德',
  fr: '法',
  es: '西',
  it: '義',
  pt: '葡',
  ru: '俄',
  ar: '阿',
};

const CN_COUNT = ['零', '一', '兩', '三', '四', '五', '六', '七', '八', '九', '十'];
const count = (n: number) => CN_COUNT[n] ?? `${n} `;

export const zhHant: TtsLocalMessages = {
  languageShort: (code) => LANG_SHORT[code] ?? code,
  languagesAny: '不限語言',
  languagesMore: (shown, total) => `${shown.join(' / ')} 等 ${total} 種語言`,
  summaryCloneDescribe: (builtins, byDuration) =>
    `${count(builtins)}個內建音色、用一段錄音克隆，或選擇性別、年齡和音高建立新的音色${byDuration ? '；可依目標長度朗讀' : ''}`,
  summaryClone: (builtins, style) => `${count(builtins)}個內建音色，或用一段錄音克隆音色${style ? '；可用一句話指定風格' : ''}`,
  summaryDescribe: (builtins) =>
    builtins
      ? `用一句話描述想要的音色，模型就會建立出來；也可以直接使用${count(builtins)}個內建音色`
      : '用一句話描述想要的音色，模型就會建立出來',
  summaryPreset: (speakers, style) => `${speakers} 個內建音色，選一個就能朗讀${style ? '；可用一句話指定語氣' : ''}`,
  modeCloneDescribe: '內建音色 / 克隆 / 描述',
  modeClone: '內建音色 / 克隆',
  modeDescribe: '依描述建立音色',
  modePreset: '內建音色',
  factStyle: '風格提示',
  factSlow: '較慢',
  nonCommercialChip: '僅限非商業用途',
  licenseCommercial: (name) => `${name} · 允許商業用途`,
  licenseNonCommercial: (name, owner) => `${name} · 僅限非商業用途 · 商業用途需另向 ${owner} 申請`,
  familyDesc: {
    'qwen3-tts':
      'Qwen3-TTS：CustomVoice 有 9 位內建說話者，可用一句話指定語氣；Base 用一段參考錄音克隆；1.7B VoiceDesign 只憑一句描述就能建立新的音色。1.7B 音質較好，但也較慢。',
    indextts2: 'IndexTTS：八個內建音色，或用自己的錄音克隆；只擷取錄音的音色，不會讀取它的逐字稿。IndexTTS 2.5 還能調整語速。',
    'gpt-sovits': 'GPT-SoVITS：八個內建音色，或用自己的錄音克隆；同時提供參考錄音的逐字稿會更像，此時參考錄音須為 3–10 秒。',
    voxcpm2: 'VoxCPM2：八個內建音色，或用自己的錄音克隆；提供錄音的逐字稿時最像，也可用一句話指定說話風格；輸出 48 kHz。',
    omnivoice: 'OmniVoice：八個內建音色、用自己的錄音克隆，或從詞彙表選擇性別、年齡和音高建立新的音色；支援的語言最多。僅限非商業用途。',
  },
  quickDescribe: '音色完全由這句描述決定：換一句描述，就是另一個人',
  quickVoxcpm: '約為即時速度：一句話念多久，產生就要多久；第一次載入約需 5 秒',
  quickNonCommercial: (license) => `僅限非商業用途（${license}）：製作商業用途的內容時，請改用其他模型`,
  quickSlow: '大型模型：合成速度比同類模型慢，第一次載入也需要多等一會兒',
};
