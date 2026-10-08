import type { TtsLocalMessages } from './models-tts-local-copy.ts';

/** 行上语言的简称（设计稿 LANG_SHORT）；表里没有的写语言标签本身。 */
const LANG_SHORT: Record<string, string> = {
  zh: '中',
  en: '英',
  ja: '日',
  ko: '韩',
  de: '德',
  fr: '法',
  es: '西',
  it: '意',
  pt: '葡',
  ru: '俄',
  ar: '阿',
};

const CN_COUNT = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十'];
const count = (n: number) => CN_COUNT[n] ?? String(n);

export const zhHans: TtsLocalMessages = {
  languageShort: (code) => LANG_SHORT[code] ?? code,
  languagesAny: '语言不限',
  languagesMore: (shown, total) => `${shown.join(' / ')} 等 ${total} 种语言`,
  summaryCloneDescribe: (builtins, byDuration) =>
    `${count(builtins)}只内置音色、用一段录音克隆，或挑性别、年龄、音高造一个新声音${byDuration ? '；能按目标时长念' : ''}`,
  summaryClone: (builtins, style) => `${count(builtins)}只内置音色，或用一段录音克隆声音${style ? '；可用一句话指定风格' : ''}`,
  summaryDescribe: (builtins) =>
    builtins ? `用一句话描述想要的声音，模型现造一个；也可以直接用${count(builtins)}只内置音色` : '用一句话描述想要的声音，模型现造一个',
  summaryPreset: (speakers, style) => `${speakers} 个预设音色，选一个就能念${style ? '；可用一句话指定语气' : ''}`,
  modeCloneDescribe: '内置音色 / 克隆 / 描述',
  modeClone: '内置音色 / 克隆',
  modeDescribe: '按描述造声音',
  modePreset: '预设音色',
  factStyle: '风格指令',
  factSlow: '较慢',
  nonCommercialChip: '仅限非商用',
  licenseCommercial: (name) => `${name} · 可商用`,
  licenseNonCommercial: (name, owner) => `${name} · 只许非商业用途 · 商用要向 ${owner} 另行申请`,
  familyDesc: {
    'qwen3-tts':
      'Qwen3-TTS：CustomVoice 有 9 个预设说话人，可用一句话指定语气；Base 用一段参考录音克隆；1.7B VoiceDesign 只凭一句描述造一个新声音。1.7B 音质更好也更慢。',
    indextts2: 'IndexTTS：八只内置音色，或用自己的录音克隆；只取录音的音色，不读原文。IndexTTS 2.5 另能调语速。',
    'gpt-sovits': 'GPT-SoVITS：八只内置音色，或用自己的录音克隆；再给参考录音的原文会更像，这时参考要 3–10 秒。',
    voxcpm2: 'VoxCPM2：八只内置音色，或用自己的录音克隆；给了录音原文最像，也可用一句话指定说话风格；出 48 kHz。',
    omnivoice: 'OmniVoice：八只内置音色、用自己的录音克隆，或按词表挑性别、年龄、音高造一个新声音；会念的语言最多。仅限非商用。',
  },
  quickDescribe: '声音完全由这句描述决定：换一句描述就是另一个人',
  quickVoxcpm: '大约一倍实时：一句念多长就要等多久，首次加载约 5 秒',
  quickNonCommercial: (license) => `仅限非商用（${license}）：做要商用的内容请换别的模型`,
  quickSlow: '大模型：合成比同类慢，第一次加载也要多等一会儿',
};
