import type { ToolDefinition } from '@baocut/protocol';
import { JobsToolCatalogue as T } from '@baocut/protocol/messages/jobs/tool-catalogue.ts';
import { DUB_PIPELINE } from './pipelines/dub.ts';
import { LINK_IMPORT_PIPELINE } from './pipelines/link-import.ts';
import { TRANSCODE_PIPELINE } from './pipelines/transcode.ts';
import { TRANSCRIBE_PIPELINE } from './pipelines/transcribe.ts';
import { TRANSLATE_PIPELINE } from './pipelines/translate.ts';
import { TRANSLATE_SUBTITLES_PIPELINE } from './pipelines/translate-subtitles.ts';

/**
 * 工具目录的静态注册表（架构设计 §7.9；产品设计 §2.7）。纯数据，不依赖 Runtime：此刻能不能用由 Runtime 按能力配置、
 * 外部工具与严格离线判断（`tools.list`）。新增工具时在这里加一项；ID 一旦发布就不改（产物的来源记着它）。
 */

/** 转录流程的名字（流程与它的转写步骤同名，§7.9）。 */
export { TRANSCRIBE_PIPELINE };

/** 下载工具与 ffmpeg 在受管外部工具登记表里的名字（§12.9）。 */
const YT_DLP = 'yt-dlp';
const FFMPEG = 'ffmpeg';

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
    optionalExternalTools: [],
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
