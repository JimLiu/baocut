import { defineMessages, intlLocale } from '@baocut/protocol';
import { zhHans } from './models-tts-local-copy.zh-Hans.ts';
import { zhHant } from './models-tts-local-copy.zh-Hant.ts';
import { ja } from './models-tts-local-copy.ja.ts';
import { ko } from './models-tts-local-copy.ko.ts';
import { es } from './models-tts-local-copy.es.ts';
import { fr } from './models-tts-local-copy.fr.ts';
import { de } from './models-tts-local-copy.de.ts';
import { nl } from './models-tts-local-copy.nl.ts';
import { ptBR } from './models-tts-local-copy.pt-BR.ts';
import { it } from './models-tts-local-copy.it.ts';
import { ru } from './models-tts-local-copy.ru.ts';
import { pl } from './models-tts-local-copy.pl.ts';
import { tr } from './models-tts-local-copy.tr.ts';
import { vi } from './models-tts-local-copy.vi.ts';

/** 设置 › 模型 › 语音合成 › 本地模型那一行的文案（英文是键与类型的来源，译文在 `models-tts-local-copy.<语言>.ts`）。 */

const voices = (n: number) => `${n} built-in ${n === 1 ? 'voice' : 'voices'}`;

/** 语言标签的显示名；`Intl` 不认得时写标签本身。 */
function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([intlLocale()], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

const en = {
  /** 行上一种语言的简称。 */
  languageShort: languageName,
  languagesAny: 'Any language',
  /** 多于五种时：前四种的简称与总数。 */
  languagesMore: (shown: readonly string[], total: number) => `${shown.join(' / ')} and more (${total} languages)`,
  /** 内置音色 + 克隆 + 按描述造声；`byDuration`：能按目标时长念。 */
  summaryCloneDescribe: (builtins: number, byDuration: boolean) =>
    `${voices(builtins)}, clone a voice from a recording, or create a new voice by choosing gender, age and pitch${
      byDuration ? '; can read to a target duration' : ''
    }`,
  /** 内置音色 + 克隆；`style`：可用一句话指定风格。 */
  summaryClone: (builtins: number, style: boolean) =>
    `${voices(builtins)}, or clone a voice from a recording${style ? '; a one-line prompt can set the style' : ''}`,
  /** 按描述造声；`builtins` 为 0 时不提内置音色。 */
  summaryDescribe: (builtins: number) =>
    builtins
      ? `Describe the voice you want in one sentence and the model creates it; you can also use the ${voices(builtins)} directly`
      : 'Describe the voice you want in one sentence and the model creates it',
  /** 模型自带说话人；`style`：可用一句话指定语气。 */
  summaryPreset: (speakers: number, style: boolean) =>
    `${speakers} preset ${speakers === 1 ? 'voice' : 'voices'}; pick one and it reads${style ? '; a one-line prompt can set the tone' : ''}`,
  modeCloneDescribe: 'Built-in voices / Clone / Describe',
  modeClone: 'Built-in voices / Clone',
  modeDescribe: 'Voice from description',
  modePreset: 'Preset voices',
  factStyle: 'Style prompt',
  factSlow: 'Slower',
  /** 只许非商业用途的标签。 */
  nonCommercialChip: 'Non-commercial only',
  licenseCommercial: (name: string) => `${name} · Commercial use allowed`,
  licenseNonCommercial: (name: string, owner: string) =>
    `${name} · Non-commercial use only · For commercial use, apply to ${owner} separately`,
  /** 引擎家族的说明，按 `LocalSpeechTraits.family` 取。 */
  familyDesc: {
    'qwen3-tts':
      'Qwen3-TTS: CustomVoice has 9 preset speakers and a one-line prompt can set the tone; Base clones from a reference recording; 1.7B VoiceDesign creates a new voice from just a description. 1.7B sounds better but is slower.',
    indextts2:
      'IndexTTS: eight built-in voices, or clone your own recording; it takes only the timbre of the recording and does not read its transcript. IndexTTS 2.5 can also adjust the speaking rate.',
    'gpt-sovits':
      "GPT-SoVITS: eight built-in voices, or clone your own recording; it sounds closer if you also give the reference recording's transcript, and then the reference must be 3–10 seconds.",
    voxcpm2:
      "VoxCPM2: eight built-in voices, or clone your own recording; it sounds closest with the recording's transcript, and a one-line prompt can set the speaking style; outputs 48 kHz.",
    omnivoice:
      'OmniVoice: eight built-in voices, clone your own recording, or create a new voice by choosing gender, age and pitch from a word list; it reads the most languages. Non-commercial only.',
  } as Record<string, string>,
  quickDescribe: 'The voice is decided entirely by this description: change the description and you get a different person',
  quickVoxcpm: 'About real time: a sentence takes as long to generate as it does to read, and the first load takes about 5 seconds',
  quickNonCommercial: (license: string) => `Non-commercial only (${license}): switch to another model for content you'll use commercially`,
  quickSlow: 'Large model: synthesis is slower than similar models, and the first load takes a while longer',
};

export type TtsLocalMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
