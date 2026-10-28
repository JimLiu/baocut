import type { ToolDefinition } from '@baocut/protocol';
import { JobsEditImage as E } from '@baocut/protocol/messages/jobs/edit-image.ts';
import { JobsToolCatalogue as T } from '@baocut/protocol/messages/jobs/tool-catalogue.ts';
import { EDIT_IMAGE_PIPELINES } from './pipelines/edit-image.ts';
import { DUB_PIPELINE } from './pipelines/dub.ts';
import { LINK_IMPORT_PIPELINE } from './pipelines/link-import.ts';
import { TRANSCODE_PIPELINE } from './pipelines/transcode.ts';
import { TRANSCRIBE_PIPELINE } from './pipelines/transcribe.ts';
import { TRANSLATE_PIPELINE } from './pipelines/translate.ts';
import { TRANSLATE_SUBTITLES_PIPELINE } from './pipelines/translate-subtitles.ts';
import { UPSCALE_IMAGE_PIPELINE } from './pipelines/upscale-image.ts';

/**
 * 工具目录的静态注册表（架构设计 §7.9；产品设计 §2.7）。纯数据，不依赖 Runtime：此刻能不能用由 Runtime 按能力配置、
 * 外部工具与严格离线判断（`tools.list`）。新增工具时在这里加一项；ID 一旦发布就不改（产物的来源记着它）。
 */

/** 转录流程的名字（流程与它的转写步骤同名，§7.9）。 */
export { TRANSCRIBE_PIPELINE };

/** 下载工具与 ffmpeg 在受管外部工具登记表里的名字（§12.9）。 */
const YT_DLP = 'yt-dlp';
const FFMPEG = 'ffmpeg';
const REALESRGAN = 'realesrgan-ncnn-vulkan';
const WAIFU2X = 'waifu2x-ncnn-vulkan';
const UPSCAYL_MODELS = 'upscayl-models';

/** 名字与说明是 getter：读的时候按当前语言生成（目录在模块加载时就构造，不能在那时取文字）。 */
export const TOOL_CATALOGUE: readonly ToolDefinition[] = [
  // 语音与字幕
  {
    id: 'transcribe',
    get label() {
      return T.transcribeLabel().text;
    },
    get description() {
      return T.transcribeDescription().text;
    },
    category: 'speech',
    inputs: ['file', 'video'],
    // 只给文件（`file`）的结果是保存位置里的 TXT 与 SRT；给视频或新建视频时写进视频。
    results: ['artifact', 'video'],
    execution: { kind: 'pipeline', method: 'pipelines.start', pipeline: TRANSCRIBE_PIPELINE },
    capabilities: ['transcribe'],
    optionalCapabilities: [],
    externalTools: [],
    optionalExternalTools: [],
    network: 'none',
    candidates: 'videos',
  },
  {
    id: 'translate-subtitles',
    get label() {
      return T.translateSubtitlesLabel().text;
    },
    get description() {
      return T.translateSubtitlesDescription().text;
    },
    category: 'speech',
    inputs: ['video', 'document', 'file'],
    results: ['video', 'artifact'],
    // 视频输入：从工具入口发起时建立目标语言的字幕层（流程参数默认不建，§7.9）。
    execution: { kind: 'pipeline', method: 'pipelines.start', pipeline: TRANSLATE_PIPELINE, params: { captions: true } },
    // 字幕文件：文件到文件，条数与时间码不变，不碰视频。
    executionByInput: { file: { kind: 'pipeline', method: 'pipelines.start', pipeline: TRANSLATE_SUBTITLES_PIPELINE } },
    capabilities: ['generateText'],
    optionalCapabilities: [],
    externalTools: [],
    optionalExternalTools: [],
    network: 'none',
    candidates: 'videos-with-transcript',
  },
  {
    id: 'dub',
    get label() {
      return T.dubLabel().text;
    },
    get description() {
      return T.dubDescription().text;
    },
    category: 'speech',
    inputs: ['video', 'document'],
    results: ['video'],
    execution: { kind: 'pipeline', method: 'pipelines.start', pipeline: DUB_PIPELINE },
    capabilities: ['synthesizeSpeech'],
    optionalCapabilities: ['generateText'],
    externalTools: [FFMPEG],
    optionalExternalTools: [],
    network: 'none',
    candidates: 'videos-with-transcript',
  },
  {
    id: 'synthesize-speech',
    get label() {
      return T.synthesizeSpeechLabel().text;
    },
    get description() {
      return T.synthesizeSpeechDescription().text;
    },
    category: 'speech',
    // `document`：Space 里的文档、字幕条目，经 `material` 提交（§7.9「Space 条目作为输入」）。
    inputs: ['text', 'document'],
    results: ['artifact'],
    execution: { kind: 'job', method: 'models.synthesizeSpeech', capability: 'synthesizeSpeech' },
    capabilities: ['synthesizeSpeech'],
    optionalCapabilities: [],
    externalTools: [],
    // 参考录音（内置音色、音色库的音色、自己给的文件）要经 ffmpeg 转成引擎读的 WAV；只说声音、不合成录音时用不到它。
    optionalExternalTools: [FFMPEG],
    network: 'none',
    candidates: null,
  },
  // 文字与图片
  {
    id: 'generate-text',
    get label() {
      return T.generateTextLabel().text;
    },
    get description() {
      return T.generateTextDescription().text;
    },
    category: 'text-image',
    // `document`：同生成语音，素材的文字接在提示后面。
    inputs: ['text', 'document'],
    results: ['artifact'],
    execution: { kind: 'job', method: 'models.generateText', capability: 'generateText' },
    capabilities: ['generateText'],
    optionalCapabilities: [],
    externalTools: [],
    optionalExternalTools: [],
    network: 'none',
    candidates: null,
  },
  {
    id: 'generate-image',
    get label() {
      return T.generateImageLabel().text;
    },
    get description() {
      return T.generateImageDescription().text;
    },
    category: 'text-image',
    inputs: ['text'],
    results: ['artifact'],
    execution: { kind: 'job', method: 'models.generateImage', capability: 'generateImage' },
    capabilities: ['generateImage'],
    optionalCapabilities: [],
    externalTools: [],
    optionalExternalTools: [],
    network: 'none',
    candidates: null,
  },
  {
    id: 'upscale-image',
    get label() {
      return T.upscaleImageLabel().text;
    },
    get description() {
      return T.upscaleImageDescription().text;
    },
    category: 'text-image',
    // 本机的图片文件或 Space 里的图片条目（经 `file` 提交 `{ entryId }`），结果写到保存位置。
    inputs: ['file'],
    results: ['artifact'],
    execution: { kind: 'pipeline', method: 'pipelines.start', pipeline: UPSCALE_IMAGE_PIPELINE },
    capabilities: [],
    // 生成式放大用生图模型；本机的引擎各自要它的外部工具（Real-ESRGAN、waifu2x、Upscayl 权重包），插值与缩放要 ffmpeg。
    // 哪个都不是一定要的：缺了的在 `limitations` 里说明，提交时按选的模型拒绝。
    optionalCapabilities: ['generateImage'],
    externalTools: [],
    optionalExternalTools: [REALESRGAN, WAIFU2X, UPSCAYL_MODELS, FFMPEG],
    network: 'none',
    candidates: null,
  },
  {
    id: EDIT_IMAGE_PIPELINES.erase,
    get label() {
      return E.eraseLabel().text;
    },
    get description() {
      return E.eraseDescription().text;
    },
    category: 'text-image',
    // 一张本机图片或 Space 里的图片条目，结果写到保存位置。
    inputs: ['file'],
    results: ['artifact'],
    execution: { kind: 'pipeline', method: 'pipelines.start', pipeline: EDIT_IMAGE_PIPELINES.erase },
    capabilities: [],
    // AI 修补要能改图的图像模型；快速填充只用 ffmpeg。
    optionalCapabilities: ['generateImage'],
    // 选区、贴回与快速填充都由 ffmpeg 做。
    externalTools: [FFMPEG],
    optionalExternalTools: [],
    network: 'none',
    candidates: null,
  },
  {
    id: EDIT_IMAGE_PIPELINES.watermark,
    get label() {
      return E.watermarkLabel().text;
    },
    get description() {
      return E.watermarkDescription().text;
    },
    category: 'text-image',
    // 一张或几张图片（同一组框用于每一张）。
    inputs: ['file'],
    results: ['artifact'],
    execution: { kind: 'pipeline', method: 'pipelines.start', pipeline: EDIT_IMAGE_PIPELINES.watermark },
    capabilities: [],
    // AI 修补要能改图的图像模型；快速填充只用 ffmpeg。
    optionalCapabilities: ['generateImage'],
    // 选区、贴回与快速填充都由 ffmpeg 做。
    externalTools: [FFMPEG],
    optionalExternalTools: [],
    network: 'none',
    candidates: null,
  },
  {
    id: EDIT_IMAGE_PIPELINES.repaint,
    get label() {
      return E.repaintLabel().text;
    },
    get description() {
      return E.repaintDescription().text;
    },
    category: 'text-image',
    // 一张图片；要写改成什么。
    inputs: ['file'],
    results: ['artifact'],
    execution: { kind: 'pipeline', method: 'pipelines.start', pipeline: EDIT_IMAGE_PIPELINES.repaint },
    capabilities: ['generateImage'],
    optionalCapabilities: [],
    // 选区、贴回与快速填充都由 ffmpeg 做。
    externalTools: [FFMPEG],
    optionalExternalTools: [],
    network: 'none',
    candidates: null,
  },
  {
    id: EDIT_IMAGE_PIPELINES.expand,
    get label() {
      return E.expandLabel().text;
    },
    get description() {
      return E.expandDescription().text;
    },
    category: 'text-image',
    // 一张图片；新画布按比例或四边的像素。
    inputs: ['file'],
    results: ['artifact'],
    execution: { kind: 'pipeline', method: 'pipelines.start', pipeline: EDIT_IMAGE_PIPELINES.expand },
    capabilities: ['generateImage'],
    optionalCapabilities: [],
    // 选区、贴回与快速填充都由 ffmpeg 做。
    externalTools: [FFMPEG],
    optionalExternalTools: [],
    network: 'none',
    candidates: null,
  },
  {
    id: 'generate-music',
    get label() {
      return T.generateMusicLabel().text;
    },
    get description() {
      return T.generateMusicDescription().text;
    },
    category: 'music',
    inputs: ['text'],
    results: ['artifact'],
    execution: { kind: 'job', method: 'models.generateMusic', capability: 'generateMusic' },
    capabilities: ['generateMusic'],
    optionalCapabilities: [],
    externalTools: [],
    optionalExternalTools: [],
    network: 'none',
    candidates: null,
  },
  // 视频文件
  {
    id: 'link-import',
    get label() {
      return T.linkImportLabel().text;
    },
    get description() {
      return T.linkImportDescription().text;
    },
    category: 'video-file',
    inputs: ['link'],
    results: ['artifact'],
    execution: { kind: 'pipeline', method: 'pipelines.start', pipeline: LINK_IMPORT_PIPELINE },
    capabilities: [],
    optionalCapabilities: ['transcribe'],
    externalTools: [YT_DLP],
    optionalExternalTools: [],
    network: 'required',
    candidates: null,
  },
  {
    id: 'compress-video',
    get label() {
      return T.compressVideoLabel().text;
    },
    get description() {
      return T.compressVideoDescription().text;
    },
    category: 'video-file',
    inputs: ['file'],
    results: ['artifact'],
    execution: { kind: 'pipeline', method: 'pipelines.start', pipeline: TRANSCODE_PIPELINE, params: { action: 'compress' } },
    capabilities: [],
    optionalCapabilities: [],
    externalTools: [FFMPEG],
    optionalExternalTools: [],
    network: 'none',
    candidates: null,
  },
  {
    id: 'merge-video',
    get label() {
      return T.mergeVideoLabel().text;
    },
    get description() {
      return T.mergeVideoDescription().text;
    },
    category: 'video-file',
    inputs: ['file'],
    results: ['artifact'],
    execution: { kind: 'pipeline', method: 'pipelines.start', pipeline: TRANSCODE_PIPELINE, params: { action: 'merge' } },
    capabilities: [],
    optionalCapabilities: [],
    externalTools: [FFMPEG],
    optionalExternalTools: [],
    network: 'none',
    candidates: null,
  },
  {
    id: 'extract-audio',
    get label() {
      return T.extractAudioLabel().text;
    },
    get description() {
      return T.extractAudioDescription().text;
    },
    category: 'video-file',
    inputs: ['file'],
    results: ['artifact'],
    execution: { kind: 'pipeline', method: 'pipelines.start', pipeline: TRANSCODE_PIPELINE, params: { action: 'extract-audio' } },
    capabilities: [],
    optionalCapabilities: [],
    externalTools: [FFMPEG],
    optionalExternalTools: [],
    network: 'none',
    candidates: null,
  },
];

/** 按 ID 找工具；没有时 null。 */
export function toolDefinition(id: string): ToolDefinition | null {
  return TOOL_CATALOGUE.find((tool) => tool.id === id) ?? null;
}
