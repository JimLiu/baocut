// OpenAI 的语音合成与图片生成接口形状（`openai` 与 `openai-compatible` 共用）。2026-10-03 读过的文档：
//   https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create
//   https://developers.openai.com/api/docs/guides/text-to-speech
//   https://developers.openai.com/api/reference/resources/images/methods/generate
//   https://developers.openai.com/api/docs/guides/image-generation
// 文档确认的：`POST {base}/audio/speech`，JSON `model`、`input`（≤ 4096 字符）、`voice`（内置音色名，或自定义音色
// `{ id }`）、`instructions`（tts-1 / tts-1-hd 不接受）、`response_format`（mp3、opus、aac、flac、wav、pcm）、
// `speed`（0.25–4.0）；响应体就是音频字节。`POST {base}/images/generations`，JSON `model`、`prompt`（≤ 32000 字符）、
// `n`（1–10）、`size`、`output_format`（png、jpeg、webp）；GPT image 模型总是返回 `data[].b64_json`（`response_format`
// 已弃用），响应带 `usage`。鉴权 `Authorization: Bearer`。
// 没能确认的：兼容端点是否接受这些字段、是否返回 `b64_json`（这里对兼容端点额外发 `response_format: 'b64_json'`；
// 只返回 `url` 的端点不支持——不去下载响应里给的任意地址）。
import { ProviderFailure } from '@baocut/models';
import { generationTimeoutMs, type ImageOutput, type ImageRequest, type SpeechOutput, type SpeechRequest } from '../adapter.ts';
import { providerFetch } from '../http/provider-fetch.ts';
import { authOf, httpOptions } from './openai-transcription.ts';
import { ProvidersHttp as PH } from '@baocut/protocol/messages/providers';

export interface OpenAiGenerationStyle {
  label: string;
  /** 兼容端点：请求 `b64_json`（GPT image 模型不需要，也不再接受这个参数的其他取值）。 */
  compatible: boolean;
}

export async function openAiSynthesize(request: SpeechRequest, style: OpenAiGenerationStyle): Promise<SpeechOutput> {
  const { config, model, parameters } = request;
  const preset = model.voices.some((v) => v.voiceId === parameters.voice);
  const body = {
    model: model.modelId,
    input: parameters.text,
    // 不在预置音色里的是账号里的自定义音色：按文档以 `{ id }` 传。
    voice: preset || style.compatible ? parameters.voice : { id: parameters.voice },
    response_format: parameters.format,
    ...(parameters.instructions ? { instructions: parameters.instructions } : {}),
    ...(parameters.speed !== null ? { speed: parameters.speed } : {}),
  };
  const response = await providerFetch(httpOptions(style.label, config, request.http), {
    method: 'POST',
    url: `${config.baseUrl}/audio/speech`,
    headers: { 'content-type': 'application/json' },
    auth: authOf(config),
    body: () => JSON.stringify(body),
    timeoutMs: generationTimeoutMs(request.http),
    signal: request.signal,
  });
  if (response.contentType?.startsWith('application/json')) {
    throw new ProviderFailure('protocol', PH.jsonNotAudio({ label: style.label }).text);
  }
  if (response.bytes.length === 0) throw new ProviderFailure('protocol', PH.emptyAudio({ label: style.label }).text);
  return { bytes: response.bytes };
}

export async function openAiGenerateImages(request: ImageRequest, style: OpenAiGenerationStyle): Promise<ImageOutput> {
  const { config, model, parameters } = request;
  const body = {
    model: model.modelId,
    prompt: parameters.prompt,
    n: parameters.count,
    ...(parameters.size ? { size: parameters.size } : {}),
    output_format: parameters.format,
    ...(style.compatible ? { response_format: 'b64_json' } : {}),
  };
  const response = await providerFetch(httpOptions(style.label, config, request.http), {
    method: 'POST',
    url: `${config.baseUrl}/images/generations`,
    headers: { 'content-type': 'application/json' },
    auth: authOf(config),
    body: () => JSON.stringify(body),
    timeoutMs: generationTimeoutMs(request.http),
    signal: request.signal,
  });
  const value = response.json<{ data?: unknown; usage?: unknown }>();
  const data = Array.isArray(value?.data) ? value.data : [];
  const images: Buffer[] = [];
  for (const item of data) {
    const b64 = typeof item === 'object' && item !== null ? (item as { b64_json?: unknown }).b64_json : undefined;
    if (typeof b64 !== 'string' || !b64) {
      throw new ProviderFailure('protocol', PH.noB64({ label: style.label }).text);
    }
    images.push(Buffer.from(b64, 'base64'));
  }
  if (images.length !== parameters.count) {
    throw new ProviderFailure('protocol', PH.imageCount({ label: style.label, got: images.length, want: parameters.count }).text);
  }
  request.progress(images.length);
  return { images, ...(value.usage !== undefined ? { usage: value.usage } : {}) };
}
