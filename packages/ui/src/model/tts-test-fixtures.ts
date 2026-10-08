// i18n-ignore-file: 测试夹具，模拟 Runtime 发来的数据
import type { LocalSpeechTraits, ModelLicense, SpeechModelInfo } from '@baocut/protocol';

/**
 * 本地语音合成模型的单测样本：形状照 Runtime 的 `localSpeechModelInfo`（packages/models/src/local-speech.ts）与
 * 模型包表（speech-bundles.ts）。
 */

const BUILTINS: [string, string][] = [
  ['zh-female', 'zh'],
  ['zh-male', 'zh'],
  ['en-female', 'en'],
  ['en-male', 'en'],
  ['ja-female', 'ja'],
  ['ja-male', 'ja'],
  ['es-female', 'es'],
  ['es-male', 'es'],
];
const SPEAKERS = ['Vivian', 'Serena', 'Uncle_Fu', 'Dylan', 'Eric', 'Ryan', 'Aiden', 'Ono_Anna', 'Sohee'];
const QWEN_LANGS = ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'es', 'it', 'pt', 'ru'];

export const APACHE: ModelLicense = { name: 'Apache-2.0', url: 'https://huggingface.co/Qwen/Qwen3-TTS', commercialUse: true, summary: '可商用' };
export const CC_BY_NC: ModelLicense = {
  name: 'CC-BY-NC-4.0',
  url: 'https://huggingface.co/k2-fsa/OmniVoice',
  commercialUse: false,
  summary: '只许非商业用途',
};

function traits(patch: Partial<LocalSpeechTraits>): LocalSpeechTraits {
  return {
    family: 'qwen3-tts',
    sampleRate: 24_000,
    slow: false,
    builtinVoices: 'reference',
    reference: { recommendedSeconds: [3, 15], withTranscriptSeconds: null, acceptsTranscript: true },
    voiceDescription: null,
    instructions: null,
    emotion: false,
    knobs: {},
    maxDurationSec: null,
    readings: 'homophone',
    license: APACHE,
    ...patch,
  };
}

function model(modelId: string, label: string, patch: Partial<SpeechModelInfo>, local: Partial<LocalSpeechTraits>): SpeechModelInfo {
  const voices = patch.voices ?? BUILTINS.map(([id, language]) => ({ voiceId: id, label: id, source: 'builtin' as const, language }));
  return {
    modelId,
    label,
    voices,
    defaultVoice: voices[0]?.voiceId ?? null,
    voiceModes: ['preset', 'clone'],
    languages: QWEN_LANGS,
    maxInputChars: 2000,
    formats: ['wav'],
    defaultFormat: 'wav',
    acceptsInstructions: false,
    speedRange: null,
    acceptsSeed: true,
    cost: 'free-local',
    available: true,
    ...patch,
    local: traits(local),
  };
}

export const QWEN_BASE = model('qwen3-tts-0.6b-base@mlx-8bit', 'Qwen3-TTS 0.6B Base', {}, {});
export const QWEN_CUSTOM = model(
  'qwen3-tts-0.6b-customvoice@mlx-bf16',
  'Qwen3-TTS 0.6B CustomVoice',
  { voices: SPEAKERS.map((id) => ({ voiceId: id, label: id, source: 'model' as const })), voiceModes: ['preset'], acceptsInstructions: true },
  { builtinVoices: null, reference: null, instructions: 'style' },
);
export const QWEN_DESIGN = model(
  'qwen3-tts-1.7b-voicedesign@mlx-8bit',
  'Qwen3-TTS 1.7B VoiceDesign',
  { voiceModes: ['preset', 'describe'] },
  { builtinVoices: 'description', reference: null, voiceDescription: { kind: 'free' }, slow: true },
);
export const INDEX_TTS2 = model(
  'indextts2@mlx-fp16',
  'IndexTTS2',
  { languages: 'any' },
  {
    family: 'indextts2',
    sampleRate: 22_050,
    emotion: true,
    reference: { recommendedSeconds: [3, 15], withTranscriptSeconds: null, acceptsTranscript: false },
  },
);
export const GPT_SOVITS = model('gpt-sovits-v2@mlx-fp16', 'GPT-SoVITS v2', { languages: ['zh', 'en'] }, { family: 'gpt-sovits', sampleRate: 32_000 });
export const VOXCPM2 = model(
  'voxcpm2@mlx-int8',
  'VoxCPM2',
  { languages: 'any', acceptsInstructions: true },
  { family: 'voxcpm2', sampleRate: 48_000, instructions: 'style' },
);
export const OMNIVOICE = model(
  'omnivoice@mlx-int8',
  'OmniVoice',
  { languages: 'any', voiceModes: ['preset', 'clone', 'describe'] },
  { family: 'omnivoice', license: CC_BY_NC, maxDurationSec: 60, voiceDescription: { kind: 'vocabulary', categories: [] } },
);
