// i18n-ignore-file: 测试夹具，模拟 Runtime 发来的数据
import type {
  ImageModelInfo,
  ModelBundleStatus,
  ModelCapabilitiesView,
  ProviderCapabilityView,
  ProviderConfigView,
  SpeechModelInfo,
  TextCapabilityParameters,
  TextModelInfo,
  TranscribeModelInfo,
} from '@baocut/protocol';

/** 模型页单测共用的能力视图：形状照 Runtime 的真实视图（providers/online-source.ts、agent-source.ts、models/local-source.ts）。 */

const off: ProviderConfigView = { enabled: false, enabledAt: null, credential: 'missing' };
const keyed: ProviderConfigView = { enabled: true, enabledAt: '2026-10-01T00:00:00.000Z', credential: 'set' };

export function transcribeModel(modelId: string, patch: Partial<TranscribeModelInfo> = {}): TranscribeModelInfo {
  return {
    modelId,
    label: modelId,
    maxInputBytes: 25 * 1024 * 1024,
    maxDurationSec: null,
    wordTimestamps: 'native',
    languages: 'any',
    acceptsHint: true,
    cost: 'unknown',
    ...patch,
  };
}

export function speechModel(modelId: string, voices: string[], patch: Partial<SpeechModelInfo> = {}): SpeechModelInfo {
  return {
    modelId,
    label: modelId,
    voices: voices.map((voiceId) => ({ voiceId, label: voiceId })),
    defaultVoice: voices[0] ?? null,
    voiceModes: voices.length ? ['preset', 'custom'] : ['custom'],
    languages: 'any',
    maxInputChars: 4096,
    formats: ['mp3'],
    defaultFormat: 'mp3',
    acceptsInstructions: false,
    speedRange: null,
    acceptsSeed: false,
    cost: 'unknown',
    ...patch,
  };
}

export function imageModel(modelId: string, patch: Partial<ImageModelInfo> = {}): ImageModelInfo {
  return {
    modelId,
    label: modelId,
    sizes: ['1024x1024'],
    aspectRatios: [],
    defaultSize: '1024x1024',
    maxCount: 1,
    maxPromptChars: 4000,
    formats: ['png'],
    defaultFormat: 'png',
    referenceImages: null,
    acceptsSeed: false,
    cost: 'unknown',
    ...patch,
  };
}

export function textModel(modelId: string, patch: Partial<TextModelInfo> = {}): TextModelInfo {
  return {
    modelId,
    label: modelId,
    contextTokens: 128_000,
    maxOutputTokens: 16_384,
    efforts: [],
    defaultEffort: null,
    structuredOutput: true,
    acceptsTemperature: true,
    acceptsSeed: false,
    cost: 'unknown',
    ...patch,
  };
}

function online<M extends ProviderCapabilityView['models'][number]>(
  providerId: string,
  label: string,
  config: ProviderConfigView,
  models: M[],
  available = false,
): ProviderCapabilityView<M> {
  const custom = providerId.startsWith('custom:');
  const reason = available
    ? {}
    : !config.enabled
      ? { unavailableReason: 'not-configured' as const, detail: '没有启用' }
      : custom
        ? { unavailableReason: 'not-configured' as const, detail: '没有声明模型' }
        : { unavailableReason: 'missing-credential' as const, detail: '没有设置密钥' };
  return { providerId, kind: 'online', label, config, models, available, ...reason };
}

const asrBox: ProviderConfigView = { enabled: true, enabledAt: '2026-10-01T00:00:00.000Z', credential: 'missing', endpoint: 'https://api.example.com/v1' };
const ttsBox: ProviderConfigView = { enabled: true, enabledAt: '2026-10-01T00:00:00.000Z', credential: 'set', endpoint: 'http://localhost:8000/v1' };

/** OpenAI 连上了（语音合成、图像可用）；Google 与 ElevenLabs 没连；两家自建：一家声明了转写模型，一家声明了语音合成模型。 */
export function fixtureView(): ModelCapabilitiesView {
  return {
    transcribe: {
      default: null,
      effective: { providerId: 'local', modelId: 'qwen3-asr-0.6b@mlx-4bit', source: 'factory-default' },
      providers: [
        {
          providerId: 'local',
          kind: 'local',
          label: '本机',
          config: null,
          models: [transcribeModel('qwen3-asr-0.6b@mlx-4bit', { label: 'Qwen3-ASR 0.6B', cost: 'free-local' })],
          available: true,
        },
        online('openai', 'OpenAI', keyed, [transcribeModel('gpt-4o-transcribe'), transcribeModel('whisper-1', { wordTimestamps: 'native' })], true),
        online('google', 'Google Gemini', off, [transcribeModel('gemini-2.5-flash')]),
        online('custom:asr-box', 'ASR Box', asrBox, [transcribeModel('whisper-large', { declared: true, default: true })], true),
      ],
    },
    synthesizeSpeech: {
      default: null,
      effective: null,
      providers: [
        online('openai', 'OpenAI', keyed, [speechModel('gpt-4o-mini-tts', ['alloy', 'echo'])], true),
        online('elevenlabs', 'ElevenLabs', off, [speechModel('eleven_multilingual_v2', [])]),
        online('custom:tts-box', 'TTS Box', ttsBox, [speechModel('tts-1', ['zh-female'], { declared: true, default: true, label: '中文女声' })], true),
      ],
    },
    generateImage: {
      default: null,
      effective: null,
      providers: [
        online('openai', 'OpenAI', keyed, [imageModel('gpt-image-1', { sizes: ['1024x1024', '1536x1024'], maxCount: 4 })], true),
        online('google', 'Google Gemini', off, [imageModel('imagen-4')]),
        {
          providerId: 'agent:codex',
          kind: 'agent',
          label: 'Codex',
          config: { enabled: false, enabledAt: null, credential: 'none' },
          models: [imageModel('image-gen', { label: 'Codex 图片生成（模型由 Codex 与账号决定）', sizes: [], defaultSize: null, cost: 'subscription' })],
          available: false,
          unavailableReason: 'not-configured',
          detail: '没有启用',
        },
      ],
    },
    generateText: { default: null, effective: null, providers: [], parameters: { effort: null, concurrency: 4 } },
    separateAudio: { default: null, effective: null, providers: [] },
  };
}

/**
 * 在 `fixtureView()` 上补上文本生成：OpenAI 连上了（两只模型，一只能调推理强度），Google 没连。
 * 不直接加进 `fixtureView()`——那会改变 OpenAI「这把密钥给哪几类用」等现有断言。`parameters` 为 null 时视图里不带参数。
 */
export function textView(parameters: TextCapabilityParameters | null = { effort: null, concurrency: 4 }): ModelCapabilitiesView {
  const view = fixtureView();
  return {
    ...view,
    generateText: {
      default: null,
      effective: null,
      providers: [
        online(
          'openai',
          'OpenAI',
          keyed,
          [
            textModel('gpt-5-mini', { efforts: ['minimal', 'low', 'medium', 'high'], defaultEffort: 'medium', contextTokens: 400_000, maxOutputTokens: 128_000 }),
            textModel('gpt-4.1'),
          ],
          true,
        ),
        online('google', 'Google Gemini', off, [textModel('gemini-2.5-flash')]),
      ],
      ...(parameters ? { parameters } : {}),
    },
  };
}

export function bundle(bundleId: string, patch: Partial<ModelBundleStatus> = {}): ModelBundleStatus {
  return { bundleId, capability: 'transcribe', backend: 'mlx', device: 'metal', state: 'installed', ...patch };
}

/** 在 fixture 上加一个本机语音合成 Provider：一只装好的、一只没装的。 */
export function withLocalSpeech(view: ModelCapabilitiesView = fixtureView()): ModelCapabilitiesView {
  return {
    ...view,
    synthesizeSpeech: {
      ...view.synthesizeSpeech,
      providers: [
        ...view.synthesizeSpeech.providers,
        {
          providerId: 'local',
          kind: 'local',
          label: '本机',
          config: null,
          available: true,
          models: [
            speechModel('kokoro-82m', ['af_heart'], { label: 'Kokoro 82M' }),
            speechModel('index-tts2', [], { label: 'IndexTTS2', available: false, unavailableReason: 'not-installed' }),
          ],
        },
      ],
    },
  };
}
