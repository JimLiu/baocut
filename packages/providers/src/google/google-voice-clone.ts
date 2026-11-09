// Google Gemini 复刻音色（Voice replication，架构设计 §5.9）。2026-10-15 读过的文档：
//   https://ai.google.dev/gemini-api/docs/voice-replication
//   https://ai.google.dev/api/voices
// 文档确认的：`POST {base}/voices`，请求头 `x-goog-api-key`，JSON：`store`、`voice: { type: 'replicated', display_name,
// description, language_code, replicated: { source_audio, consent_audio } }`，两段录音都是 `{ mime_type, data（base64）}`；
// 参考录音 10–30 秒、同一个成年人，授权声明是他照着官方 30 个地区语言里的一句原文念（界面的 `CONSENT_PHRASES`），
// 服务端核对两段是不是同一个人；`store: true` 时响应体的 `id` 是 `voice_…`，合成时原样放进 `speech_config[].voice`，
// 每个项目最多 200 只，最后一次使用后保留 1 年；不存时只回 7 天有效的 `voicekey_…`。`DELETE {base}/voices/{id}`，成功时响应体为空。
// `model` 不给时用默认的复刻模型，建好的音色在两只 TTS 模型上都能用。
// 没能确认、列在架构设计 §14 待评审的：`store` 的默认值（参考说 false、指南说默认存），所以总是明确给 true；`language_code`
// 在参考里是可选的描述字段，是否用来认授权声明的语言（我们给授权声明录音的语言，自定义的一句不给）；`Api-Revision`
// 请求头（指南的 curl 没带，与别的 Gemini 请求一样带上）；音色已经不存在时删除的状态码（按 404 当作「远端已经没有」）；
// 请求体的大小上限（参考录音只受库的上限约束，base64 之后再加授权声明录音，可能超过）；被拒时的原话（按关键词归类，
// 见 `google-voice-clone-errors.ts`）。
// 适配器声明了 `sourceSeconds`，Runtime 先用 ffmpeg 把参考录音（MP3、FLAC、WAV……）的开头 33 秒转成 24 kHz 单声道 16 位 WAV
// （文档建议的格式）再交过来；比 30 秒长的 WAV（界面录的样本至多 180 秒）只传开头不超过 30 秒、切在静音处的一段（`trimWavHead`）。
// ffmpeg 读不出、Runtime 原样交来的别的格式原样上传，太长时由 Gemini 拒绝（`source-duration`）。
import fs from 'node:fs/promises';
import { ProviderFailure } from '@baocut/models';
import { voiceCloneTimeoutMs, type VoiceCloneAdapter, type VoiceCloneDeleteRequest, type VoiceCloneRequest } from '../adapter.ts';
import { trimWavHead } from '../audio/wav-trim.ts';
import { providerFetch } from '../http/provider-fetch.ts';
import { classifyGoogle, GOOGLE_API_REVISION, googleAuthOf, googleHttpOptions } from './google-adapter.ts';
import { classifyGoogleVoiceClone } from './google-voice-clone-errors.ts';
import { ProvidersHttp as PH } from '@baocut/protocol/messages/providers';
import { RuntimeStorageLibrary as SL } from '@baocut/protocol/messages/runtime-storage';
import { VOICE_CONSENT_CUSTOM } from '@baocut/protocol';

const LABEL = 'Google Gemini';
/** 文档写的参考录音时长：10–30 秒。 */
export const GEMINI_CLONE_SOURCE_SECONDS = { min: 10, max: 30 } as const;

export class GoogleVoiceCloneAdapter implements VoiceCloneAdapter {
  readonly version = 'baocut-providers/google-voice-replication@1';
  readonly requiresConsentClip = true;
  readonly sourceSeconds = GEMINI_CLONE_SOURCE_SECONDS;

  async createVoiceClone(request: VoiceCloneRequest): Promise<{ voiceId: string }> {
    const { config, consentClip } = request;
    // Runtime 在提交前已经拦下没有授权声明录音的音色；这里再挡一次，不发一个注定被拒的请求。
    if (!consentClip) {
      throw new ProviderFailure('rejected', SL.voiceConsentClipRequired({ name: request.name, provider: LABEL }).text, {
        code: 'VOICE_CONSENT_CLIP_REQUIRED',
      });
    }
    const [reference, consent] = await Promise.all([fs.readFile(request.file), fs.readFile(consentClip.file)]);
    const source = trimWavHead(reference, this.sourceSeconds.max).bytes;
    const body = JSON.stringify({
      store: true,
      voice: {
        type: 'replicated',
        display_name: request.name,
        ...(request.description ? { description: request.description } : {}),
        ...(consentClip.language !== VOICE_CONSENT_CUSTOM ? { language_code: consentClip.language } : {}),
        replicated: {
          source_audio: { mime_type: request.mediaType, data: source.toString('base64') },
          consent_audio: { mime_type: consentClip.mediaType, data: consent.toString('base64') },
        },
      },
    });
    const response = await providerFetch(
      // 上传只发一次：5xx 之后重发可能在供应商那边多建一个音色。
      googleHttpOptions(config, { ...request.http, attempts: 1 }),
      {
        method: 'POST',
        url: `${config.baseUrl}/voices`,
        headers: { 'content-type': 'application/json', 'api-revision': GOOGLE_API_REVISION },
        auth: googleAuthOf(config),
        body: () => body,
        timeoutMs: voiceCloneTimeoutMs(request.http),
        signal: request.signal,
        classify: classifyGoogleVoiceClone,
      },
    );
    let parsed: { id?: unknown } | null = null;
    try {
      parsed = response.json<{ id?: unknown }>();
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed.id !== 'string' || !parsed.id) {
      throw new ProviderFailure('protocol', PH.cloneNoVoiceId({ label: LABEL }).text);
    }
    return { voiceId: parsed.id };
  }

  async deleteVoiceClone(request: VoiceCloneDeleteRequest): Promise<'deleted' | 'not-found'> {
    const { config } = request;
    try {
      await providerFetch(googleHttpOptions(config, request.http), {
        method: 'DELETE',
        url: `${config.baseUrl}/voices/${encodeURIComponent(request.voiceId)}`,
        headers: { 'api-revision': GOOGLE_API_REVISION },
        auth: googleAuthOf(config),
        timeoutMs: request.http.timeoutMs ?? 30_000,
        signal: request.signal,
        classify: classifyGoogle,
      });
      return 'deleted';
    } catch (error) {
      if (error instanceof ProviderFailure && error.details.status === 404) return 'not-found';
      throw error;
    }
  }
}
