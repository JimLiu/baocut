// OpenAI 的语音合成与图片生成接口形状（`openai` 与 `openai-compatible` 共用）。2026-10-03 读过的文档（图片编辑 2026-10-13 重读）：
//   https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create
//   https://developers.openai.com/api/docs/guides/text-to-speech
//   https://developers.openai.com/api/reference/resources/images/methods/generate
//   https://developers.openai.com/api/reference/resources/images
//   https://developers.openai.com/api/docs/guides/image-generation
// 文档确认的：`POST {base}/audio/speech`，JSON `model`、`input`（≤ 4096 字符）、`voice`（内置音色名，或自定义音色
// `{ id }`）、`instructions`（tts-1 / tts-1-hd 不接受）、`response_format`（mp3、opus、aac、flac、wav、pcm）、
// `speed`（0.25–4.0）；响应体就是音频字节。`POST {base}/images/generations`，JSON `model`、`prompt`（≤ 32000 字符）、
// `n`（1–10）、`size`、`output_format`（png、jpeg、webp）；GPT image 模型总是返回 `data[].b64_json`（`response_format`
// 已弃用），响应带 `usage`。带输入图时走 `POST {base}/images/edits`：JSON 的 `images` 是 `[{ image_url }]`（完整地址或
// base64 data URL，GPT image 模型至多 16 张），其余字段同上，响应形状相同；`input_fidelity` 不发（gpt-image-2 不接受）。
// 鉴权 `Authorization: Bearer`。
// 兼容端点不假定支持 GPT image 的格式参数：不发 `output_format` 或 `response_format`，单张时省略 `n`。
// 接受 `data[].b64_json` 或 `data[].url`：没有 `b64_json` 时按 `url` 取图（只限兼容端点）。`data:` 地址
// 就地解码；`http(s)` 地址 GET 下载，与配置的端点同源才带密钥，跨源的不带；回来的是文本或 JSON 当协议错误。
import { ProviderFailure } from '@baocut/models';
import { generationTimeoutMs, type ImageOutput, type ImageRequest, type SpeechOutput, type SpeechRequest } from '../adapter.ts';
import { providerFetch } from '../http/provider-fetch.ts';
import { authOf, httpOptions } from './openai-transcription.ts';
import { ProvidersHttp as PH } from '@baocut/protocol/messages/providers';

export interface OpenAiGenerationStyle {
  label: string;
  /** 兼容端点：省略图片格式提示，接受 Base64 或 URL 输出；语音的音色 ID 原样传。 */
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
  const { config, model, parameters, inputs } = request;
  // 输入图（§6.1）：按提示词改图，所有图放进同一次编辑请求，以 data URL 内联（不上传成文件）。
  const edit = inputs.length > 0;
  const body = {
    model: model.modelId,
    ...(edit ? { images: inputs.map((input) => ({ image_url: `data:${input.mediaType};base64,${input.bytes.toString('base64')}` })) } : {}),
    prompt: parameters.prompt,
    ...(!style.compatible || parameters.count > 1 ? { n: parameters.count } : {}),
    ...(parameters.size ? { size: parameters.size } : {}),
    ...(!style.compatible ? { output_format: parameters.format } : {}),
  };
  const response = await providerFetch(httpOptions(style.label, config, request.http), {
    method: 'POST',
    url: `${config.baseUrl}/images/${edit ? 'edits' : 'generations'}`,
    headers: { 'content-type': 'application/json' },
    auth: authOf(config),
    body: () => JSON.stringify(body),
    timeoutMs: generationTimeoutMs(request.http),
    signal: request.signal,
  });
  const value = response.json<{ data?: unknown; usage?: unknown }>();
  const data = Array.isArray(value?.data) ? value.data : [];
  if (data.length !== parameters.count) {
    throw new ProviderFailure('protocol', PH.imageCount({ label: style.label, got: data.length, want: parameters.count }).text);
  }
  const images: Buffer[] = [];
  for (const item of data) {
    const { b64_json: b64, url } = (typeof item === 'object' && item !== null ? item : {}) as { b64_json?: unknown; url?: unknown };
    if (typeof b64 === 'string' && b64) images.push(Buffer.from(b64, 'base64'));
    else if (style.compatible && typeof url === 'string' && url) images.push(await imageFromUrl(url, request, style));
    else throw new ProviderFailure('protocol', PH.noImageData({ label: style.label }).text);
  }
  request.progress(images.length);
  return { images, ...(value.usage !== undefined ? { usage: value.usage } : {}) };
}

/** 兼容端点只给了图片地址：`data:` 就地解码，`http(s)` GET 下载（与端点同源才带密钥）。 */
async function imageFromUrl(url: string, request: ImageRequest, style: OpenAiGenerationStyle): Promise<Buffer> {
  const { config } = request;
  const inline = /^data:image\/[\w.+-]+;base64,(.*)$/is.exec(url);
  if (inline) return Buffer.from(inline[1]!, 'base64');
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new ProviderFailure('protocol', PH.badImageUrl({ label: style.label }).text);
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new ProviderFailure('protocol', PH.badImageUrl({ label: style.label }).text);
  }
  const sameOrigin = target.origin === new URL(config.baseUrl).origin;
  const response = await providerFetch(httpOptions(style.label, config, request.http), {
    method: 'GET',
    url: target.href,
    auth: sameOrigin ? authOf(config) : null,
    timeoutMs: generationTimeoutMs(request.http),
    signal: request.signal,
  });
  const type = response.contentType?.split(';')[0]!.trim().toLowerCase() ?? '';
  if (type.startsWith('text/') || type.includes('json')) {
    throw new ProviderFailure('protocol', PH.imageUrlNotImage({ label: style.label, type }).text);
  }
  return response.bytes;
}
