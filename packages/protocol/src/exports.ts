import type { Id } from './domain.ts';
import type { JobWarning } from './jobs.ts';
import type { DocumentRecord, Sequence } from './video.ts';

/**
 * 导出（架构设计 §9.11、§9.13）：冻结 → 预检 → 在 staging 里生成 → 校验 → 原子发布。一次导出是一个 Job
 * （`kind: 'export'`），`exports.create` 立即返回 `jobId`，进度与结果经 `jobs` 主题送达，取消用 `jobs.cancel`。
 *
 * 交付字幕、文稿、音频、成片（`video`）、便携包（`portable`，视频格式规范 §8）与工程（`project`，其他剪辑软件的交换文件）。
 */

export type ExportKind = 'subtitles' | 'transcript' | 'audio' | 'video' | 'project' | 'portable';

/** 这个版本实现了的种类。 */
export const SUPPORTED_EXPORT_KINDS = ['subtitles', 'transcript', 'audio', 'video', 'portable', 'project'] as const;

/** 字幕：SRT、VTT、ASS（基础样式映射）与带词时间的 JSON。 */
export type SubtitleExportFormat = 'srt' | 'vtt' | 'ass' | 'json';
/** 文稿：Markdown、纯文本与带词时间的 JSON。 */
export type TranscriptExportFormat = 'md' | 'txt' | 'json';
export type AudioExportFormat = 'wav' | 'mp3' | 'm4a';
/** 成片：MP4（H.264 或 HEVC，AAC 声音）与 WebM（VP9，Opus 声音）。 */
export type VideoExportFormat = 'mp4' | 'webm';
export type VideoExportCodec = 'h264' | 'hevc' | 'vp9';

/** 一行的最大宽度（默认值）：按显示宽度计，全角字（中日韩文字与全角标点）算 2，其余算 1。 */
export const EXPORT_MAX_CHARS_PER_LINE = 42;
/** 一条字幕最多几行；放不下时拆成几条。 */
export const EXPORT_MAX_LINES_PER_CUE = 2;
/** 由词拼成的一条字幕最长几秒；更长时在词之间拆开。 */
export const EXPORT_MAX_CUE_SECONDS = 7;
/**
 * 文稿的分段（编辑器文稿面板与文稿导出同一套）：标了段首、换了说话人、停顿 `pauseSec` 以上时断；
 * 句末处够长了（`maxWidth` 字符）或停顿稍长（`sentencePauseSec`）且不太短（`minWidth` 字符）也断。宽度按字符数估。
 */
export const TRANSCRIPT_PARAGRAPH = { pauseSec: 2, sentencePauseSec: 0.6, minWidth: 60, maxWidth: 240 } as const;

/** 序列时间的一段 `[start, end)`，秒。 */
export interface ExportRange {
  start: number;
  end: number;
}

/** 范围与序列：不给 `range` / `ranges` 时是整条序列；`ranges` 的每一段各出一个文件（同一个导出 Job 的多个产物）。 */
export interface ExportScope {
  /** 不给时是视频的主序列。 */
  sequenceId?: Id;
  range?: ExportRange;
  ranges?: ExportRange[];
}

/** 字幕与文稿的参数。 */
export interface TextExportOptions {
  /**
   * 主文档：`speech`（转写）或 `caption`（字幕）。不给时依次取：序列里启用的字幕实例显示的文档、唯一的 `speech` 文档
   * （给了 `language` 时只看这种语言的）；仍然确定不了时以 `EXPORT_SOURCE_AMBIGUOUS` 拒绝，`details.candidates` 列出候选（显示着的字幕与转写都列上）。
   */
  documentId?: Id;
  /** 只在不给 `documentId` 时用来挑文档（BCP 47）。 */
  language?: string;
  /**
   * 双语合并：`true` 时取主文档的译文（`translation` 文档，`sourceDocumentId` 指向主文档；有几份时要 `language`
   * 或显式的 `documentId`），也可以直接给另一份文档（译文，或另一种语言的字幕 / 转写）。没有可用的另一份时拒绝。
   */
  bilingual?: boolean | { documentId?: Id; language?: string };
  /** 一行的最大宽度，默认 `EXPORT_MAX_CHARS_PER_LINE`。 */
  maxCharsPerLine?: number;
  /** 文稿（Markdown、纯文本）在每段末尾写这一段开始的时间（`[mm:ss]`，满一小时 `[hh:mm:ss]`），默认不写。 */
  timestamps?: boolean;
  /** 只经这些实例投影（源素材时钟的文档）。不给时按字幕实例、再按引用文档来源素材的实例。 */
  scopeItemIds?: Id[];
}

/**
 * 文稿独有的选项（命令与协议规范 §4.4）。默认值保持智能体与 CLI 原来的结果：不写文首元信息与章节小标题，写说话人，跳过剪掉的部分。
 */
export interface TranscriptExportOptions {
  /**
   * Markdown 的文首元信息（YAML，`---` 之间）：title、description、source、author、published、platform、duration、language、
   * translation，之后是正文里的说话人与章节表；缺的字段不写。纯文本与 JSON 不写。默认 false。
   */
  frontmatter?: boolean;
  /** 章节小标题：序列上 `kind: 'chapter'` 的标记，写在这一章的第一段前面（没有段落的章不写）。默认 false。 */
  chapters?: boolean;
  /** 说话人：段里有说话人时每段都写（Markdown `**名字:**`，纯文本 `名字: `；JSON 的 `speaker`）。默认 true。 */
  speakers?: boolean;
  /**
   * 跳过剪掉的部分，默认 true：正文来自时间线投影，剪掉的词不出现，时间是时间线时间。false 时不经投影取文档的原文
   * （隐藏的词仍然不写），时间是文档的时钟（素材时间）；给了范围时取这段范围投影到的第一个与最后一个词之间的原文。
   */
  skipCut?: boolean;
}

/**
 * 响度标准化的目标（架构设计 §9.13 的母带）：BS.1770 综合响度归一与真峰值限幅交替三轮，再按真峰值静态兜底；
 * 测量值与施加的增益写进校验结果。综合响度在 [−70, 0] LUFS，真峰值上限在 [−20, 0] dBTP。
 */
export interface LoudnessTarget {
  /** 综合响度，LUFS。 */
  integratedLufs: number;
  /** 真峰值上限，dBTP。 */
  truePeakDb: number;
}

/**
 * 文稿里的时刻（向下取整到秒）：不满一小时 `mm:ss`，满一小时 `hh:mm:ss`（小时补到两位）。导出文稿的段末时间戳、章节、
 * 文首的时长与章节表，以及编辑器文稿面板的复制与引用都用它。
 */
export function transcriptStamp(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(total % 60)}` : `${pad(m)}:${pad(total % 60)}`;
}

/** Markdown 文稿里的文字（正文、说话人、章节名）：转义 Markdown 的标记字符。导出的文稿与编辑器文稿面板的复制同一个写法。 */
export function transcriptMarkdownText(text: string): string {
  return text.replace(/([\\`*_[\]<>#|])/g, '\\$1');
}

/** 空白（含换行）折成一个空格：文稿的小标题、文首的值都只占一行。 */
export function transcriptOneLine(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(' ');
}

/**
 * 成片画面里烧着的字幕是哪些语言（成片的默认文件名后缀，命令与协议规范 §4）：启用的字幕实例所在的字幕轨这次画进画面
 * （可见；有视觉组的轨在独显时只算独显的），取它们字幕文档的语言。按时间线从上到下排，去重；没写语言的文档不算。
 * 导出面板的预计文件名与 Runtime 的默认命名读同一份。
 */
export function burnedCaptionLanguages(sequence: Pick<Sequence, 'tracks' | 'items'>, documents: Readonly<Record<Id, Pick<DocumentRecord, 'language'>>>): string[] {
  const visualSolo = sequence.tracks.some((t) => t.solo.enabled && t.solo.group === 'visual');
  const languages: string[] = [];
  const tracks = sequence.tracks
    .filter((t) => t.kind === 'subtitle' && t.visible && (!visualSolo || (t.solo.enabled && t.solo.group === 'visual')))
    .sort((a, b) => b.order - a.order);
  for (const track of tracks) {
    for (const item of sequence.items) {
      if (item.trackId !== track.id || !item.enabled || item.type !== 'caption') continue;
      const language = documents[item.documentId]?.language;
      if (language && !languages.includes(language)) languages.push(language);
    }
  }
  return languages;
}

export const DEFAULT_LOUDNESS_TARGET: Required<LoudnessTarget> = { integratedLufs: -16, truePeakDb: -1.2 };

export interface AudioExportOptions {
  /** 默认 48000。 */
  sampleRate?: number;
  /** 默认 2。 */
  channels?: 1 | 2;
  /** MP3 与 M4A 的码率，默认 192；WAV 不接受。 */
  bitrateKbps?: number;
  /** 响度标准化；默认关闭，按视频里的混音原样导出。 */
  loudness?: LoudnessTarget | null;
}

/**
 * 音频导出的声音来源（架构设计 §9.13）：`mix`（默认）是时间线的混音；`original` 只要原声：去掉全部配音（带 `baocut.dub`
 * 标记的实例，含分离出的背景），配音静音掉的原声恢复，配音触发的压低随之消失；`{ dubGroupId }` 只要这一组配音
 * （实例的 `extensions['baocut.dub'].groupId`），原声、音乐与别的配音都不要。用于 `kind: 'audio'` 与 `kind: 'video'`：
 * 只改这一次导出的声音计划（成片的画面不受影响），不改视频。
 */
export type AudioExportSource = 'mix' | 'original' | { dubGroupId: string };

/**
 * 成片的参数（架构设计 §9.13）。画面由原生合成按帧计划逐帧画出（与预览同一份计划），声音是音频导出的混音。
 * 画不出来的内容（没有预渲染替身的代码包、只有预览实现的内置生成器、认不出的效果与转场、解不出画面的素材……）
 * 在提交时逐项列出：默认以 `EXPORT_UNSUPPORTED_CONTENT` 拒绝（`details.items`）；`onUnsupported: 'skip'` 时跳过它们
 * （整层不画、跳过那个效果、转场按硬切），每一项记一条任务警告。
 */
export interface VideoExportOptions {
  /** MP4 默认 `h264`，可选 `hevc`；WebM 只有 `vp9`。本机 ffmpeg 没有对应的编码器时以 `EXPORT_TOOL_MISSING` 拒绝。 */
  codec?: VideoExportCodec;
  /**
   * 输出宽度（像素）。只给宽时高度按画布比例；与 `height` 都给时输出就是这个尺寸，画面按画布比例放到放得下的最大
   * （居中），其余是黑边，排版不按输出的比例重排。宽高都取偶数（yuv420p 的要求），调整过时记一条警告。
   */
  width?: number;
  /** 输出高度（像素）；只给高时宽度按画布比例。宽高都取偶数，调整过时记一条警告。都不给时是画布尺寸。 */
  height?: number;
  /** 输出帧率；默认是序列帧率。不同时按输出帧的精确时刻取画面（架构设计 §9.10）。 */
  fps?: { num: number; den: number };
  /** 恒定质量（H.264 / HEVC 0–51，VP9 0–63；默认 20 / 23 / 32）。与 `bitrateKbps` 只能给一个。 */
  crf?: number;
  /** 视频的目标码率（kbps）。 */
  bitrateKbps?: number;
  /** 把时间线上的字幕画进画面，默认 `true`；只影响这一次导出。 */
  burnCaptions?: boolean;
  /** 画不出来的内容：`fail`（默认）拒绝，`skip` 跳过并逐项警告。 */
  onUnsupported?: 'fail' | 'skip';
  /** 声音：与音频导出相同的参数（码率默认 MP4 192、WebM 128 kbps）。 */
  audio?: AudioExportOptions;
}

/**
 * 便携包（架构设计 §5.8，视频格式规范 §8）：一个 `.baocut` 文件，里面是视频的快照、全部文档版本的正文与全部素材版本的 bytes
 * （链接的素材也收进来），连同逐个文件的长度与 sha256。不带本机路径、密钥、授权、任务记录与会话。
 */
export interface PortableExportOptions {
  /**
   * 读不到的素材版本（文件不在、已经不是登记时的内容、相对路径越出项目）：`fail`（默认）在提交时逐项拒绝；
   * `skip` 不收进包，清单里如实标 `missing`，打开包得到的视频里它们是缺失的链接素材。
   */
  missingAssets?: 'fail' | 'skip';
}

/**
 * 工程导出的格式（架构设计 §9.13）：`xmeml` 是 Final Cut Pro 7 XML（xmeml v5），Premiere Pro 与 DaVinci Resolve 能导入。
 * 素材按引用写出（本机的绝对路径）；表达不了的对象逐项写进任务警告。
 */
export type ProjectExportFormat = 'xmeml';

/** `preview` 是智能体内部检查的文件，不作为会话交付；省略时按 `deliverable` 处理。 */
export type ExportPurpose = 'deliverable' | 'preview';

export type ExportSettings = { purpose?: ExportPurpose } & (
  | ({ kind: 'subtitles'; format: SubtitleExportFormat } & ExportScope & TextExportOptions)
  | ({ kind: 'transcript'; format: TranscriptExportFormat } & ExportScope & TextExportOptions & TranscriptExportOptions)
  | ({ kind: 'audio'; format: AudioExportFormat; source?: AudioExportSource } & ExportScope & AudioExportOptions)
  | ({ kind: 'video'; format: VideoExportFormat; source?: AudioExportSource } & ExportScope & VideoExportOptions)
  | ({ kind: 'portable'; format?: 'baocut' } & PortableExportOptions)
  | { kind: 'project'; format: ProjectExportFormat; sequenceId?: Id }
);

/**
 * 输出的位置。不给 `dir` 时是视频来源目录（项目目录；不在项目里的视频是视频目录的上一级）下的 `exports/`；
 * 给了的 `dir` 必须是已经存在、可写的绝对路径。文件名默认是「视频名.种类后缀.扩展名」（成片的后缀是画面里烧着的字幕语言，
 * 没有时不加，见 `burnedCaptionLanguages`），重名时加序号；
 * 给了 `fileName` 而文件已经存在时，除非 `overwrite`，以 `EXPORT_DESTINATION_EXISTS` 拒绝。
 */
export interface ExportDestination {
  dir?: string;
  /** 只在只出一个文件时可用；不含目录。扩展名不对时补上正确的。 */
  fileName?: string;
  overwrite?: boolean;
}

export interface ExportCreateRequest {
  videoId: Id;
  settings: ExportSettings;
  destination?: ExportDestination;
  commandId?: Id;
}

/** 字幕与文稿的设置：`exports.renderText` 只接受这两种。 */
export type TextExportSettings = Extract<ExportSettings, { kind: 'subtitles' | 'transcript' }>;

/**
 * `exports.renderText`：不写文件、不建任务，按与 `exports.create` 相同的冻结、预检与写法排出正文（导出面板文稿页的预览与
 * 「复制文本」）。拿到的正文与同样设置导出的文件逐字节相同。
 */
export interface ExportRenderTextRequest {
  videoId: Id;
  settings: TextExportSettings;
}

/** 排出来的一份：几段范围时每段一份，与导出的文件一一对应。 */
export interface RenderedTextOutput {
  /** 默认目标下预计的文件名（重名时真正导出会再加序号）。 */
  fileName: string;
  format: SubtitleExportFormat | TranscriptExportFormat;
  mediaType: string;
  content: string;
  /** 条数：字幕是条，JSON 是句子，Markdown 与纯文本是段落。 */
  entries: number;
  /** 最后一条的结束时间（秒，相对范围起点）。 */
  durationSec: number;
  /** 主文档正文（不含标题、说话人、时间码与译文）里的拉丁词数与汉字数，给界面说篇幅。 */
  words: number;
  cjkCharacters: number;
}

export interface ExportRenderTextResult {
  outputs: RenderedTextOutput[];
  /** 与导出任务相同的警告；几段范围时 `segmentId` 是那一份的文件名。 */
  warnings: JobWarning[];
}

/** 冻结的素材版本：位置与指纹。链接的素材在预检与执行前各按内容摘要核对一次。 */
export interface ExportAssetVersion {
  assetId: Id;
  revision: string;
  name: string;
  storage: 'managed' | 'linked';
  path: string;
  contentHash: string;
  byteLength: number;
}

/**
 * 成片冻结的本机字体 face（架构设计 §9.11 的「字体」）：随渲染内核发布的字体之外、成片排字点了名的「族名、字重、斜体」，
 * 冻结时在本机找到的那一个 face——所在文件、文件里第几个与整个文件的摘要和字节数（执行时按它核对，变了以
 * `FONT_MISSING` 失败）；找不到的记 `fallback`（照回退字体画，结果里有提示）。
 *
 * 按需下载的字体（§9.1）：冻结时下载缓存里已有的照样记文件（`source: 'downloaded'`）；字体目录里有、还没下载的记
 * `download`，任务开始画之前下载（进度与取消随导出任务），下载好的按同样的写法冻结进这次渲染，下载不成或不下载（自动
 * 下载关着、严格离线）时记 `fallback: 'not-downloaded'`，照回退字体画、警告 `FONT_NOT_DOWNLOADED` 说明原因。
 */
export type ExportFontFace = { family: string; weight: number; italic: boolean } & (
  | { path: string; faceIndex: number; contentHash: string; byteLength: number; source?: 'local' | 'downloaded' }
  | { fallback: 'not-found' | 'too-large' | 'not-downloaded' }
  | { download: 'google-fonts' }
);

/** 冻结的文档版本。 */
export interface ExportDocumentVersion {
  documentId: Id;
  revision: string;
  kind: string;
  language: string | null;
  schema: string;
}

/**
 * 导出启动时的冻结（架构设计 §9.11）：之后的编辑不影响这个导出。作为 JSON 产物存下（`JobRecord.export.snapshotArtifactId`）；
 * `parts` 是引擎按这一个视频版本求出的计划（每个输出范围一份：声音的区间计划，或文档在时间线上的投影）。
 */
export interface ExportSnapshot {
  schema: 'baocut.export-snapshot/1';
  videoId: Id;
  videoName: string;
  videoRevision: string;
  sequenceId: Id;
  sequenceRevision: string;
  settings: ExportSettings;
  assets: ExportAssetVersion[];
  /** 成片：用到的本机字体（其它种类的导出没有）。 */
  fonts?: ExportFontFace[];
  documents: ExportDocumentVersion[];
  /** 每个输出一份：范围（秒）、目标文件名与引擎给出的计划。 */
  parts: Array<{ range: ExportRange; fileName: string; plan: unknown }>;
  /** 成片：Render Worker 逐帧求计划用的那部分视频（序列与素材记录）与要画的字幕文档正文。 */
  render?: { document: unknown; documents: unknown[] };
  output: { dir: string; overwrite: boolean };
  frozenAt: string;
}

/** 公开记录里的导出信息。 */
export interface ExportJobInfo {
  settings: ExportSettings;
  snapshotArtifactId: string;
  videoRevision: string;
  sequenceId: Id;
  /** 目标目录与各个输出的文件名（发布时重名会再加序号，实际路径以 `result.outputs[].path` 为准）。 */
  destination: { dir: string; files: string[]; overwrite: boolean };
}

/** 一个输出发布前的校验：解析得出、条数与时长对得上；音频与成片由 ffprobe 读。便携包没有时长，时长的三项为 0。 */
export interface ExportValidation {
  /** 做过的检查项（全部通过才发布）。 */
  checks: string[];
  expectedDurationSec: number;
  durationSec: number;
  toleranceSec: number;
  expectedEntries?: number;
  entries?: number;
  /** 成片：期望的与读到的帧数、尺寸、帧率（`num/den`）与流。 */
  video?: {
    expectedFrames: number;
    frames: number;
    width: number;
    height: number;
    fps: string;
    streams: string[];
  };
  /** 便携包：发布前从写好的归档里重新读出、按清单核对过长度与 sha256 的文件数与总字节数。 */
  package?: { files: number; verifiedFiles: number; bytes: number };
  /**
   * 响度标准化：目标、实测与施加的静态增益。`measured.inputLufs` 是母带前的综合响度，`integratedLufs` 与 `truePeakDb`
   * 是母带后的；`gainDb` 是各轮响度归一的静态增益之和（限幅另算）。
   */
  loudness?: {
    target: Required<LoudnessTarget>;
    measured: { inputLufs: number; integratedLufs: number; truePeakDb: number };
    gainDb: number;
  };
}

// ---- 便携包（视频格式规范 §8）----

export const PACKAGE_FORMAT = 'baocut.package';
/** 这个版本写出与能读的打包版本。更高的版本以 `PACKAGE_VERSION_UNSUPPORTED` 拒绝。 */
export const PACKAGE_VERSION = 1;
export const PACKAGE_EXTENSION = 'baocut';
export const PACKAGE_MANIFEST_FILE = 'video.manifest.json';

/** 清单里的一个素材版本或文档版本。 */
export interface PackageEntry {
  ref: { id: Id; revision: string };
  kind: 'asset' | 'document';
  /** 包里的相对路径；没有收进包的没有。 */
  path?: string;
  contentHash: string;
  byteLength: number;
  /** `included` 收进了包；`missing` 导出时读不到（`missingAssets: 'skip'`）。`linked`、`excluded-license` 为以后的链接式包保留。 */
  inclusion: 'included' | 'linked' | 'missing' | 'excluded-license';
  note?: string;
}

/** 包里的一个文件（清单自己除外）：路径、长度与 sha256。打开时逐个核对，多出或缺少的文件都拒绝。 */
export interface PackageFile {
  path: string;
  byteLength: number;
  sha256: string;
}

/** `video.manifest.json`（视频格式规范 §8.1）。 */
export interface PackageManifest {
  format: typeof PACKAGE_FORMAT;
  packageVersion: number;
  videoSchemaVersion: number;
  timeContractVersion: number;
  /** 导出时的视频身份与版本。打开包得到的是一个新视频，有新的 videoId。 */
  videoId: Id;
  videoName: string;
  videoRevision: string;
  createdAt: string;
  entries: PackageEntry[];
  files: PackageFile[];
}
