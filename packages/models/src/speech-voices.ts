import { modelAssetPath } from './model-assets.ts';

/**
 * 本地语音合成的内置音色（架构设计 §6.1）：随应用分发的八段参考录音，四种语言各一男一女（`assets/tts-voices/`，
 * 来源与许可见同目录的 `COPYING.txt`）。只能克隆的模型（IndexTTS、GPT-SoVITS、VoxCPM2、OmniVoice、Qwen3-TTS Base）
 * 把它们列为预设音色：选一只就是用这段录音与它的原文克隆。
 *
 * `description` 是英文的一句声音描述，留给按描述造声的模型复用（不翻译：它是交给模型的文字，不是界面文案）。
 */
export interface BuiltinVoice {
  id: string;
  /** BCP 47 主语言子标签。 */
  language: string;
  gender: 'female' | 'male';
  /** 录音时长（秒）。 */
  seconds: number;
  /** 录音的原文。 */
  transcript: string;
  description: string;
  /** 素材出处（数据集 · 子集 · 原文件）。 */
  credit: string;
  /** 录音在模型数据目录里的相对路径（`model-assets.ts`）；绝对路径用 `builtinVoiceFile` 在用时求。 */
  asset: string;
}

const ARCTIC_TRANSCRIPT = 'Author of the danger trail, Philip Steels, etc. Not at this particular case, Tom, apologized Whittemore.';

function asset(id: string): string {
  return `tts-voices/${id}.wav`;
}

/** 次序即界面次序：中、英、日、西，各女先男后。 */
export const BUILTIN_VOICES: readonly BuiltinVoice[] = [
  {
    id: 'zh-female',
    language: 'zh',
    gender: 'female',
    seconds: 6.72,
    // i18n-ignore: 参考录音的原文，交给模型
    transcript: '一般来说，卫星电话不能取代移动电话，因为只有在卫星信号畅通的室外，才能进行通话。',
    description: 'A warm, natural young female voice speaking Mandarin Chinese at an even, unhurried pace',
    credit: 'FLEURS · cmn_hans_cn · dev · 11138309825590803862',
    asset: asset('zh-female'),
  },
  {
    id: 'zh-male',
    language: 'zh',
    gender: 'male',
    seconds: 6.16,
    // i18n-ignore: 参考录音的原文，交给模型
    transcript: '游猎活动也许是非洲最吸引人的旅游活动，也是许多游客行程中的亮点。',
    description: 'A calm, steady adult male voice speaking Mandarin Chinese, clear and even',
    credit: 'FLEURS · cmn_hans_cn · dev · 7878925372167965477',
    asset: asset('zh-male'),
  },
  {
    id: 'en-female',
    language: 'en',
    gender: 'female',
    seconds: 7.32,
    transcript: ARCTIC_TRANSCRIPT,
    description: 'A warm, clear adult female voice speaking American English at an even pace',
    credit: 'CMU ARCTIC · cmu_us_slt_arctic · a0001 + a0002',
    asset: asset('en-female'),
  },
  {
    id: 'en-male',
    language: 'en',
    gender: 'male',
    seconds: 6.9,
    transcript: ARCTIC_TRANSCRIPT,
    description: 'A deep, steady adult male voice speaking American English, clear and even',
    credit: 'CMU ARCTIC · cmu_us_bdl_arctic · a0001 + a0002',
    asset: asset('en-male'),
  },
  {
    id: 'ja-female',
    language: 'ja',
    gender: 'female',
    seconds: 8.44,
    // i18n-ignore: 参考录音的原文，交给模型
    transcript: '州間の税法や関税を無効にする権限もありませんでした。',
    description: 'A bright, gentle young female voice speaking Japanese at an even pace',
    credit: 'FLEURS · ja_jp · dev · 9633305044980004895',
    asset: asset('ja-female'),
  },
  {
    id: 'ja-male',
    language: 'ja',
    gender: 'male',
    seconds: 6.4,
    // i18n-ignore: 参考录音的原文，交给模型
    transcript: '宇宙にある人工衛星は通話を受信して、ほぼ瞬時にそれを反映します。',
    description: 'A calm, low adult male voice speaking Japanese, clear and even',
    credit: 'FLEURS · ja_jp · dev · 18146068393309246703',
    asset: asset('ja-male'),
  },
  {
    id: 'es-female',
    language: 'es',
    gender: 'female',
    seconds: 6.92,
    transcript: 'Los canales navegables internos pueden ser una buena temática para las vacaciones.',
    description: 'A warm, clear adult female voice speaking Latin American Spanish at an even pace',
    credit: 'FLEURS · es_419 · dev · 16573424493246998243',
    asset: asset('es-female'),
  },
  {
    id: 'es-male',
    language: 'es',
    gender: 'male',
    seconds: 7.86,
    transcript: 'Cuando uno se comunica con alguien que está a miles de millas de distancia, se está haciendo uso de un satélite.',
    description: 'A deep, steady adult male voice speaking Latin American Spanish, clear and even',
    credit: 'FLEURS · es_419 · dev · 14695292064114231662',
    asset: asset('es-male'),
  },
];

/** 内置音色录音的绝对路径；找不到模型数据目录时 null（读的地方报 `APP_FILE_MISSING`）。 */
export function builtinVoiceFile(voice: BuiltinVoice, env: NodeJS.ProcessEnv = process.env): string | null {
  return modelAssetPath(voice.asset, env);
}

export function builtinVoice(id: string): BuiltinVoice | null {
  return BUILTIN_VOICES.find((v) => v.id === id) ?? null;
}

/**
 * 不指定声音时用哪只内置音色：请求语言的女声，没有这种语言时取那种语言的第一只，都没有时取第一只（中文女声）。
 * 不看文本猜语言：没有语言时就是第一只。
 */
export function defaultBuiltinVoice(language: string | null): BuiltinVoice {
  const primary = language?.toLowerCase().split('-')[0] ?? null;
  const same = primary ? BUILTIN_VOICES.filter((v) => v.language === primary) : [];
  return same.find((v) => v.gender === 'female') ?? same[0] ?? BUILTIN_VOICES[0]!;
}
