// 火山引擎豆包语音合成适配器（架构设计 §6.4）。2026-10-15 读过的文档：
//   https://www.volcengine.com/docs/6561/2528925（单向流式语音合成 HTTP，V3）
//   https://www.volcengine.com/docs/6561/1816214（API Key 使用）
//   https://www.volcengine.com/docs/6561/2534853（错误码）
//   https://www.volcengine.com/docs/6561/1257544（音色列表）
// 文档确认的：`POST {base}/tts/unidirectional`（基址 `https://openspeech.bytedance.com/api/v3`），密钥在 `X-Api-Key`——
// 豆包语音控制台按项目签发的 API Key，与方舟的密钥是两套（所以是单独的 Provider `volcengine-speech`），不用填 appid；
// `X-Api-Resource-Id: seed-tts-2.0`（豆包语音合成 2.0）、`X-Api-Request-Id`（uuid）；请求体 `{ req_params: { text, speaker,
// audio_params: { format, sample_rate, speech_rate }, additions } }`，`format` 取 mp3、pcm、ogg_opus、wav，`sample_rate`
// 默认 24000，`speech_rate` 取 [-50, 100]（100 是 2 倍、-50 是 0.5 倍），`additions` 是 JSON 序列化后的字符串，里面的
// `context_texts` 是语音指令（2.0 音色才有）、`enable_auto_language_recognition` 让它按首句识别语言（默认走中英链路）；
// 响应是分块的一串 JSON：音频片段 `{ code: 0, data: <base64> }`，结束包 `{ code: 20000000, message: 'ok', usage }`，中途出错
// 是别的 `code`（45000000 超并发、45000001 音色不存在、40402003 文本超长、55000000 服务端错误或资源与音色不匹配）；
// 网关层的错误外壳是 `{ header: { code, message } }`（401 / 45000010 是密钥无效）。
// 没能确认的：单次文本上限（V3 文档没给数字，按 1,000 字声明）；`explicit_language` 的取值表（不发，非中英文时开自动识别）；
// 流式 WAV 每块是否各带一个头（不用 wav，要 WAV 时取 24 kHz 单声道 16 位 PCM 自己补头）；有没有只读接口能验证这种密钥
// （列音色要 AK/SK 签名：验证时发一个空文本的合成请求，密钥不对是 401，密钥对时服务端拒绝空文本，不出音频、不计费）；
// 国际版 BytePlus 的音色 ID 是否相同（不提供国际地区）。
import { randomUUID } from 'node:crypto';
import { ProviderFailure } from '@baocut/models';
import type { SpeechModelInfo } from '@baocut/protocol';
import {
  generationTimeoutMs,
  primaryLanguage,
  type AdapterConfig,
  type AdapterHttp,
  type ModelLister,
  type ProviderListing,
  type SpeechAdapter,
  type SpeechOutput,
  type SpeechRequest,
} from '../adapter.ts';
import { providerFetch, type ProviderHttpOptions, type RejectionCode } from '../http/provider-fetch.ts';
import { ProvidersConfig as PC, ProvidersHttp as PH } from '@baocut/protocol/messages/providers';

export const VOLCENGINE_SPEECH_DEFAULT_BASE_URL = 'https://openspeech.bytedance.com/api/v3';
const RESOURCE_ID = 'seed-tts-2.0';
const SAMPLE_RATE = 24_000;
/** 结束包的 `code`。 */
const DONE = 20_000_000;

/** 豆包语音合成 2.0 的音色（文档音色列表里的 2.0 通用音色）。 */
const VOICES = [
  { voiceId: 'zh_female_vv_uranus_bigtts', label: 'Vivi 2.0', language: 'zh' },
  // i18n-ignore-start：音色名是火山引擎控制台里的原名，与 voiceId 一一对应，不翻译。
  { voiceId: 'zh_female_xiaohe_uranus_bigtts', label: '小何 2.0', language: 'zh' },
  { voiceId: 'zh_male_m191_uranus_bigtts', label: '云舟 2.0', language: 'zh' },
  { voiceId: 'zh_male_taocheng_uranus_bigtts', label: '小天 2.0', language: 'zh' },
  { voiceId: 'zh_female_shuangkuaisisi_uranus_bigtts', label: '爽快思思 2.0', language: 'zh' },
  { voiceId: 'zh_male_jieshuoxiaoming_uranus_bigtts', label: '解说小明 2.0', language: 'zh' },
  { voiceId: 'zh_male_cixingjieshuonan_uranus_bigtts', label: '磁性解说男声 2.0', language: 'zh' },
  { voiceId: 'zh_female_xiaoxue_uranus_bigtts', label: '儿童绘本 2.0', language: 'zh' },
  // i18n-ignore-end
  { voiceId: 'en_male_tim_uranus_bigtts', label: 'Tim', language: 'en' },
  { voiceId: 'en_female_dacey_uranus_bigtts', label: 'Dacey', language: 'en' },
  { voiceId: 'ja_male_yusuke_uranus_bigtts', label: 'Yusuke', language: 'ja' },
  { voiceId: 'id_female_cesna_uranus_bigtts', label: 'Cesna', language: 'id' },
  { voiceId: 'es_male_mariano_uranus_bigtts', label: 'Mariano', language: 'es' },
];

/** 豆包语音合成 2.0 支持的语言。 */
const LANGUAGES = ['zh', 'en', 'ja', 'ko', 'es', 'pt', 'id', 'ms', 'th', 'vi', 'fil', 'de', 'fr', 'ru', 'ar'];

const MODELS: SpeechModelInfo[] = [
  {
    modelId: RESOURCE_ID,
    label: 'Doubao TTS 2.0',
    default: true,
    voices: VOICES,
    defaultVoice: 'zh_female_vv_uranus_bigtts',
    // 音色列表之外的 2.0 音色照样能用（填音色 ID）。
    voiceModes: ['preset', 'custom'],
    languages: LANGUAGES,
    maxInputChars: 1_000,
    formats: ['mp3', 'wav'],
    defaultFormat: 'mp3',
    acceptsInstructions: true,
    speedRange: { min: 0.5, max: 2 },
    acceptsSeed: false,
    cost: 'unknown',
  },
];

export class VolcengineSpeechAdapter implements SpeechAdapter, ModelLister {
  readonly version = 'baocut-providers/volcengine-speech@1';

  models(_config: AdapterConfig): SpeechModelInfo[] {
    return structuredClone(MODELS);
  }

  async synthesize(request: SpeechRequest): Promise<SpeechOutput> {
    const { config, parameters } = request;
    if (parameters.format !== 'mp3' && parameters.format !== 'wav') {
      throw new ProviderFailure('rejected', PH.formatUnsupported({ label: label(), format: parameters.format }).text, { code: 'PROVIDER_REJECTED' });
    }
    const language = parameters.language ? primaryLanguage(parameters.language) : null;
    const instructions = parameters.instructions?.trim();
    const additions = {
      ...(language && language !== 'zh' && language !== 'en' ? { enable_auto_language_recognition: true } : {}),
      ...(instructions ? { context_texts: [instructions] } : {}),
    };
    const { chunks, usage } = await this.#call(request.http, config, request.signal, {
      text: parameters.text,
      speaker: parameters.voice,
      audio_params: {
        format: parameters.format === 'wav' ? 'pcm' : 'mp3',
        sample_rate: SAMPLE_RATE,
        ...(parameters.speed !== null ? { speech_rate: Math.round((parameters.speed - 1) * 100) } : {}),
      },
      ...(Object.keys(additions).length > 0 ? { additions: JSON.stringify(additions) } : {}),
    });
    const audio = Buffer.concat(chunks);
    if (audio.length === 0) throw new ProviderFailure('protocol', PH.emptyAudio({ label: label() }).text);
    return { bytes: parameters.format === 'wav' ? wavOf(audio) : audio, ...(usage !== undefined ? { usage } : {}) };
  }

  /**
   * 这种密钥没有只读接口：发一个空文本的合成请求。密钥不对时网关回 401；密钥对时服务端拒绝空文本（4xx 或流里的错误码），
   * 不出音频、不计费——这两种都算验证通过。
   */
  async validateCredential(config: AdapterConfig, signal: AbortSignal, http: AdapterHttp): Promise<void> {
    try {
      await this.#call({ ...http, attempts: 1 }, config, signal, {
        text: '',
        speaker: MODELS[0]!.defaultVoice,
        audio_params: { format: 'mp3', sample_rate: SAMPLE_RATE },
      });
    } catch (error) {
      if (error instanceof ProviderFailure && error.kind === 'rejected' && error.details.code !== 'PROVIDER_AUTH_FAILED') return;
      throw error;
    }
  }

  /** 没有能用这种密钥的列表接口：只验证密钥，不给模型列表（内置的模型不因此被标为不可用）。 */
  async listModels(config: AdapterConfig, signal: AbortSignal, http: AdapterHttp): Promise<ProviderListing> {
    await this.validateCredential(config, signal, http);
    return {};
  }

  async #call(
    http: AdapterHttp,
    config: AdapterConfig,
    signal: AbortSignal,
    params: Record<string, unknown>,
  ): Promise<{ chunks: Buffer[]; usage?: unknown }> {
    const body = JSON.stringify({ req_params: params });
    const response = await providerFetch(httpOptions(config, http), {
      method: 'POST',
      url: `${config.baseUrl}/tts/unidirectional`,
      headers: {
        'content-type': 'application/json',
        'x-api-resource-id': RESOURCE_ID,
        'x-api-request-id': randomUUID(),
        'x-control-require-usage-tokens-return': '*',
      },
      auth: authOf(config),
      body: () => body,
      timeoutMs: generationTimeoutMs(http),
      signal,
      classify: classifyVolcengineSpeech,
    });
    return parseSpeechStream(response.text);
  }
}

/** 一串首尾相接（可能隔着换行）的 JSON 包 → 音频片段与结束包里的用量；中途的错误码按分类抛出。 */
export function parseSpeechStream(text: string): { chunks: Buffer[]; usage?: unknown } {
  const chunks: Buffer[] = [];
  let usage: unknown;
  let done = false;
  for (const raw of jsonObjects(text)) {
    let packet: unknown;
    try {
      packet = JSON.parse(raw);
    } catch {
      throw new ProviderFailure('protocol', PH.invalidJson({ label: label() }).text);
    }
    if (!isObject(packet)) throw new ProviderFailure('protocol', PH.notObject({ label: label() }).text);
    const header = isObject(packet.header) ? packet.header : null;
    const code = Number(packet.code ?? header?.code);
    const message = String(packet.message ?? header?.message ?? '');
    // 没有 `code` 的包（例如字幕）不管。
    if (!Number.isFinite(code)) continue;
    if (code === 0) {
      if (typeof packet.data === 'string' && packet.data) chunks.push(Buffer.from(packet.data, 'base64'));
      continue;
    }
    if (code === DONE) {
      done = true;
      if (packet.usage !== undefined) usage = packet.usage;
      continue;
    }
    throw new ProviderFailure(
      'rejected',
      PH.withMessage({ text: PH.generateIncomplete({ label: label(), status: String(code) }).text, message }).text,
      { code: codeOf(code, message) },
    );
  }
  if (!done && chunks.length === 0) throw new ProviderFailure('protocol', PH.emptyAudio({ label: label() }).text);
  return { chunks, ...(usage !== undefined ? { usage } : {}) };
}

/** 错误码（流里的 `code` 或网关的 `header.code`）→ 我们的分类。 */
function codeOf(code: number, message: string): RejectionCode {
  if (code === 45_000_010 || /invalid x-api-key|app key not found/i.test(message)) return 'PROVIDER_AUTH_FAILED';
  if (/quota exceeded/i.test(message)) return 'PROVIDER_QUOTA_EXCEEDED';
  if (code === 40_402_003) return 'INPUT_TOO_LONG';
  return 'PROVIDER_REJECTED';
}

/** 4xx 的错误体：网关外壳 `{ header: { code, message } }` 或 `{ code, message }`。 */
export function classifyVolcengineSpeech(status: number, body: string): RejectionCode | null {
  let code = NaN;
  let message = body;
  try {
    const parsed = JSON.parse(body) as { code?: unknown; message?: unknown; header?: { code?: unknown; message?: unknown } };
    code = Number(parsed.header?.code ?? parsed.code);
    message = String(parsed.header?.message ?? parsed.message ?? '');
  } catch {
    // 不是 JSON：按原文匹配。
  }
  const classified = codeOf(code, message);
  if (classified !== 'PROVIDER_REJECTED') return classified;
  return status === 401 || status === 403 ? 'PROVIDER_AUTH_FAILED' : null;
}

/** 按花括号的层数切出顶层的 JSON 对象（跳过字符串里的括号）。 */
function* jsonObjects(text: string): Generator<string> {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0) yield text.slice(start, i + 1);
    }
  }
  if (depth !== 0) throw new ProviderFailure('protocol', PH.invalidJson({ label: label() }).text);
}

/** 24 kHz 单声道 16 位小端 PCM → WAV。 */
function wavOf(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'latin1');
  header.write('fmt ', 12, 'latin1');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'latin1');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** 名字随界面语言（读取时取）。 */
function label(): string {
  return PC.vendorVolcengineSpeech().text;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function authOf(config: AdapterConfig): { header: string; value: string } | null {
  return config.credential ? { header: 'x-api-key', value: config.credential } : null;
}

function httpOptions(config: AdapterConfig, http: AdapterHttp): ProviderHttpOptions {
  return {
    label: label(),
    secrets: config.credential ? [config.credential] : [],
    ...(http.backoffMs ? { backoffMs: http.backoffMs } : {}),
    ...(http.attempts ? { attempts: http.attempts } : {}),
  };
}
