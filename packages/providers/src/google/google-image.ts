// Google Gemini 图片生成适配器（架构设计 §6.4）。2026-10-03 读过的文档：
//   https://ai.google.dev/gemini-api/docs/image-generation
//   https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image
//   https://ai.google.dev/gemini-api/docs/models/gemini-3-pro-image
//   https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-image
// 文档确认的：`POST {base}/interactions`，请求头 `x-goog-api-key` 与 `Api-Revision`；`input: [{ type: 'text', text }]`；
// 顶层 `response_format: { type: 'image', mime_type, aspect_ratio, image_size }`（`image_size` 取 '512'、'1K'、'2K'、'4K'，
// K 大写）；结果在 `steps[]` 里 `type: 'model_output'` 的 `content[]`，图片块 `{ type: 'image', data（base64）, mime_type }`，
// `type: 'thought'` 的 step 里是不收费的中间图（不取）；各模型的宽高比与像素尺寸表（这里照抄）；3.1 Flash Image 输入上限
// 131,072 token，3 Pro Image 与 3.1 Flash Lite Image 65,536；参考图 3.x 最多 14 张、2.5 最多 3 张（这一版不用）；
// gemini-2.5-flash-image 只接受 `aspect_ratio`。
// 没能确认的：一次请求出几张图（文档没有张数参数，所以一张一次请求，最多 4 张是我们的上限）；`seed`（不开放）；
// `mime_type: 'image/webp'`（不提供）；3.1 Flash Lite Image 各宽高比的像素尺寸（文档只给了宽高比，按 3.1 Flash Image 的 1K
// 尺寸声明）；提示词按字符的上限（按 32000 字符声明，远低于 token 上限）。
import { ProviderFailure } from '@baocut/models';
import type { ImageAspectRatio, ImageFormat, ImageModelInfo } from '@baocut/protocol';
import {
  generationTimeoutMs,
  IMAGE_MEDIA,
  type AdapterConfig,
  type ImageAdapter,
  type ImageOutput,
  type ImageRequest,
} from '../adapter.ts';
import { providerFetch } from '../http/provider-fetch.ts';
import { classifyGoogle, GOOGLE_API_REVISION, googleAuthOf, googleHttpOptions } from './google-adapter.ts';
import { ProvidersHttp as PH } from '@baocut/protocol/messages/providers';

const LABEL = 'Google Gemini';
const RESOLUTIONS = ['512', '1K', '2K', '4K'] as const;
type Resolution = (typeof RESOLUTIONS)[number];

/** 3.x 的尺寸表：宽高比 → 各分辨率的像素尺寸（3 Pro Image 与 3.1 Flash Image 在 1K/2K/4K 上相同）。 */
const GEMINI_3_SIZES: Record<string, Record<Resolution, string>> = {
  '1:1': { '512': '512x512', '1K': '1024x1024', '2K': '2048x2048', '4K': '4096x4096' },
  '1:4': { '512': '256x1024', '1K': '512x2048', '2K': '1024x4096', '4K': '2048x8192' },
  '1:8': { '512': '192x1536', '1K': '384x3072', '2K': '768x6144', '4K': '1536x12288' },
  '2:3': { '512': '424x632', '1K': '848x1264', '2K': '1696x2528', '4K': '3392x5056' },
  '3:2': { '512': '632x424', '1K': '1264x848', '2K': '2528x1696', '4K': '5056x3392' },
  '3:4': { '512': '448x600', '1K': '896x1200', '2K': '1792x2400', '4K': '3584x4800' },
  '4:1': { '512': '1024x256', '1K': '2048x512', '2K': '4096x1024', '4K': '8192x2048' },
  '4:3': { '512': '600x448', '1K': '1200x896', '2K': '2400x1792', '4K': '4800x3584' },
  '4:5': { '512': '464x576', '1K': '928x1152', '2K': '1856x2304', '4K': '3712x4608' },
  '5:4': { '512': '576x464', '1K': '1152x928', '2K': '2304x1856', '4K': '4608x3712' },
  '8:1': { '512': '1536x192', '1K': '3072x384', '2K': '6144x768', '4K': '12288x1536' },
  '9:16': { '512': '384x688', '1K': '768x1376', '2K': '1536x2752', '4K': '3072x5504' },
  '16:9': { '512': '688x384', '1K': '1376x768', '2K': '2752x1536', '4K': '5504x3072' },
  '21:9': { '512': '792x168', '1K': '1584x672', '2K': '3168x1344', '4K': '6336x2688' },
};

const TEN_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

/** gemini-2.5-flash-image：每个宽高比一个固定尺寸。 */
const GEMINI_25_SIZES: Record<string, string> = {
  '1:1': '1024x1024',
  '2:3': '832x1248',
  '3:2': '1248x832',
  '3:4': '864x1184',
  '4:3': '1184x864',
  '4:5': '896x1152',
  '5:4': '1152x896',
  '9:16': '768x1344',
  '16:9': '1344x768',
  '21:9': '1536x672',
};

/** 一个尺寸在请求里怎么说。 */
interface SizeSpec {
  aspectRatio: string;
  imageSize: Resolution | null;
}

interface GoogleImageModel {
  info: ImageModelInfo;
  sizes: Map<string, SizeSpec>;
}

function gemini3(ratios: string[], resolutions: readonly Resolution[]): Map<string, SizeSpec> {
  const sizes = new Map<string, SizeSpec>();
  for (const resolution of resolutions) {
    for (const ratio of ratios) sizes.set(GEMINI_3_SIZES[ratio]![resolution], { aspectRatio: ratio, imageSize: resolution });
  }
  return sizes;
}

function model(
  modelId: string,
  label: string,
  sizes: Map<string, SizeSpec>,
  referenceImages: number,
  extra: Partial<ImageModelInfo> = {},
): GoogleImageModel {
  // 宽高比的写法取 1K（2.5 是唯一的尺寸）。
  const aspectRatios: ImageAspectRatio[] = [];
  for (const [size, spec] of sizes) {
    if ((spec.imageSize === '1K' || spec.imageSize === null) && !aspectRatios.some((a) => a.ratio === spec.aspectRatio)) {
      aspectRatios.push({ ratio: spec.aspectRatio, size });
    }
  }
  return {
    info: {
      modelId,
      label,
      sizes: [...sizes.keys()],
      aspectRatios,
      defaultSize: null,
      maxCount: 4,
      maxPromptChars: 32_000,
      formats: ['png', 'jpeg'],
      defaultFormat: 'png',
      referenceImages: { max: referenceImages },
      acceptsSeed: false,
      cost: 'unknown',
      ...extra,
    },
    sizes,
  };
}

const MODELS: GoogleImageModel[] = [
  model('gemini-3.1-flash-image', 'Gemini 3.1 Flash Image', gemini3(Object.keys(GEMINI_3_SIZES), RESOLUTIONS), 14, { default: true }),
  model('gemini-3-pro-image', 'Gemini 3 Pro Image', gemini3(TEN_RATIOS, ['1K', '2K', '4K']), 14),
  model('gemini-3.1-flash-lite-image', 'Gemini 3.1 Flash Lite Image', gemini3(TEN_RATIOS, ['1K']), 14),
  model(
    'gemini-2.5-flash-image',
    'Gemini 2.5 Flash Image',
    new Map(Object.entries(GEMINI_25_SIZES).map(([ratio, size]) => [size, { aspectRatio: ratio, imageSize: null }])),
    3,
  ),
];

export class GoogleImageAdapter implements ImageAdapter {
  readonly version = 'baocut-providers/google-image@1';

  models(_config: AdapterConfig): ImageModelInfo[] {
    return MODELS.map((m) => structuredClone(m.info));
  }

  async generate(request: ImageRequest): Promise<ImageOutput> {
    const { config, parameters } = request;
    const known = MODELS.find((m) => m.info.modelId === request.model.modelId);
    const spec = parameters.size ? known?.sizes.get(parameters.size) : undefined;
    if (parameters.size && !spec) {
      throw new ProviderFailure('rejected', PH.noImageSize({ label: LABEL, model: request.model.modelId, size: String(parameters.size) }).text, {
        code: 'PROVIDER_REJECTED',
      });
    }
    const mimeType = IMAGE_MEDIA[parameters.format].mediaType;
    const body = JSON.stringify({
      model: request.model.modelId,
      input: [{ type: 'text', text: parameters.prompt }],
      response_format: {
        type: 'image',
        mime_type: mimeType,
        ...(spec ? { aspect_ratio: spec.aspectRatio } : {}),
        ...(spec?.imageSize ? { image_size: spec.imageSize } : {}),
      },
    });
    // 文档没有张数参数：一张一次请求，依次发出（同一个 Provider 的队列已经限了并发）。
    const images: Buffer[] = [];
    const usage: unknown[] = [];
    for (let i = 0; i < parameters.count; i++) {
      const response = await providerFetch(googleHttpOptions(config, request.http), {
        method: 'POST',
        url: `${config.baseUrl}/interactions`,
        headers: { 'content-type': 'application/json', 'api-revision': GOOGLE_API_REVISION },
        auth: googleAuthOf(config),
        body: () => body,
        timeoutMs: generationTimeoutMs(request.http),
        signal: request.signal,
        classify: classifyGoogle,
      });
      const { image, usage: one } = parseImageInteraction(response.json(), parameters.format);
      images.push(image);
      if (one !== undefined) usage.push(one);
      request.progress(images.length);
    }
    return { images, ...(usage.length > 0 ? { usage } : {}) };
  }
}

/** 取最后一个 `model_output` step 里的最后一张图；中间的 `thought` 图不算。 */
export function parseImageInteraction(value: unknown, format: ImageFormat): { image: Buffer; usage?: unknown } {
  if (!isObject(value)) throw new ProviderFailure('protocol', PH.notObject({ label: LABEL }).text);
  if (value.status === 'failed' || value.status === 'cancelled') {
    throw new ProviderFailure('rejected', PH.generateIncomplete({ label: LABEL, status: String(value.status) }).text, { code: 'PROVIDER_REJECTED' });
  }
  let found: Record<string, unknown> | null = null;
  const texts: string[] = [];
  for (const step of arrayOf(value.steps)) {
    if (step.type !== 'model_output') continue;
    for (const content of arrayOf(step.content)) {
      if (content.type === 'image' && typeof content.data === 'string' && content.data) found = content;
      if (content.type === 'text' && typeof content.text === 'string') texts.push(content.text);
    }
  }
  if (!found) {
    // 模型拒绝生成时只回文字（例如内容政策）：按被拒绝处理，带上一小段原话。
    const said = texts.join(' ').trim().slice(0, 200);
    throw new ProviderFailure('rejected', (said ? PH.noImageReturnedSaid({ label: LABEL, said }) : PH.noImageReturned({ label: LABEL })).text, { code: 'PROVIDER_REJECTED' });
  }
  const expected = IMAGE_MEDIA[format].mediaType;
  if (typeof found.mime_type === 'string' && found.mime_type !== expected) {
    throw new ProviderFailure('protocol', PH.wrongMime({ label: LABEL, got: String(found.mime_type), want: expected }).text);
  }
  return { image: Buffer.from(found.data as string, 'base64'), ...(value.usage !== undefined ? { usage: value.usage } : {}) };
}

function arrayOf(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
