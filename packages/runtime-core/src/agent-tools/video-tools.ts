import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  RpcError,
  newId,
  type DocumentContent,
  type EditOperation,
  type EditResult,
  type Id,
  type VideoChange,
  type VideoCreated,
  type VideoOpenResult,
  type VideoSnapshot,
  type Rate,
  type AssetRevision,
  type DocumentRecord,
  type Sequence,
  itemAssetRef,
  itemTimeMap,
  mediaTimeToSeconds,
} from '@baocut/protocol';
import {
  EditorWasmError,
  sourceChapters,
  type SourceChapterAnchor,
  type SourceChapterRow,
  type SourceChapterStatus,
  type SourceChaptersResult,
} from '@baocut/editor-wasm';
import {
  CAPTION_DOCUMENT_REF,
  EditorWasmUnavailable,
  PipelineStepError,
  generatedImportOperation,
  linkImportAssetOperation,
  planCaptionLayer,
  sourceSentences,
  type CaptionSource,
} from '@baocut/jobs';
import { RcAgentTools } from '@baocut/protocol/messages/runtime-core';
import type { MediaAnalysis } from '../media-analysis.ts';
import type { PackageImporter } from '../videos/package-import.ts';
import type { VideoService } from '../videos/video-service.ts';
import { EDIT_OPERATIONS, OPERATION_FAMILIES, OPERATION_TYPES, describeOperation } from './edit-ops.ts';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import { approvalField, confirmSummary, type ToolAccess, type ToolPrincipal, type ToolScope } from './tool-scope.ts';
import { assetSegments, projectChapters, type ProjectedChapter } from './source-chapters.ts';
import { fillTranslationAlignments } from './translation-alignment.ts';
import { OperationShapeError, digestVideo, digestReceipt, normalizeOperations } from './video-digest.ts';
import {
  DEFAULT_RANGE_COUNT,
  FRAMES_DIR,
  FRAMES_NOTE,
  MAX_FRAMES,
  frameSourceAt,
  frameTimes,
  framesDirectory,
  writeFrame,
} from './video-frames.ts';

/**
 * 视频工具目录（架构设计 §3.5）：智能体经 MCP 调用的那几件事。每一次调用都回到与界面相同的
 * `VideoService`：同一个引擎、同一套版本校验与撤销，操作者由调用方的身份构造（§4.2），会话的任务号由 Runtime 填入。
 *
 * 权限与范围在每次调用时判断（`ToolScope`）：会话里的智能体只在有进行中的任务时可用、规划模式只读（`AgentScope`）；
 * 对外服务的客户端按访问策略（`ServiceScope`，§4.8）。
 */

export interface VideoToolsDeps {
  videos: VideoService;
  scope: ToolScope;
  /** 取帧（`videos_frames`）：与素材库缩略图同一份缓存与 ffmpeg。 */
  analysis: MediaAnalysis;
  /** 打开便携包（`videos_import_package`）：与 `videos.importPackage` 同一个入口。 */
  packages: PackageImporter;
}

// i18n-ignore: 给模型的工具说明、错误与下一步
export const videoArg = z.string().min(1).max(1000).describe('视频：videos_list 给出的 path 或 videoId');
const revisionArg = z.string().regex(/^\d+$/);
export const commandIdArg = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);

/** 字幕与翻译核心的排版 profile（`crates/speech-doc` 的 `layout_profile.rs`）。两者源侧的切条参数相同，只差渲染时的最多行数。 */
const LAYOUT_PROFILES = ['default', 'two-line'] as const;

/** 十进制秒字符串（时间线上的时刻）。 */
const secondsText = z.string().regex(/^\d+(\.\d+)?$/);

// i18n-ignore-start: 给模型的工具说明、错误与下一步
/** 操作里时间与序列的写法，`edits_apply` 的说明与 `edits_ops` 的结果共用。 */
const TIME_CONVENTIONS =
  '时间写秒数（数字，例如 1.5），也可以写 {"unit":"frames","value":30}。sequenceId 省略时用根序列；alignment 省略时为 nearest-frame。';

const PROJECT_DESCRIPTION =
  '可选。新建到哪个项目：项目 id（videos_list 的 projectId），也可以是已登记项目目录的绝对路径。会话里不给时建在会话所属的项目（或会话的工作目录），给了只能是会话所属的项目；对外服务必须给';

const schemas = {
  videos_list: z.strictObject({}),
  videos_create: z.strictObject({
    name: z.string().min(1).max(200).describe('视频名，也是视频目录名'),
    width: z.number().int().min(16).max(8192).optional().describe('画布宽，默认 1920'),
    height: z.number().int().min(16).max(8192).optional().describe('画布高，默认 1080'),
    fps: z.number().positive().max(240).optional().describe('帧率，默认 30；29.97、23.976、59.94 按 NTSC 帧率处理'),
    project: z.string().min(1).max(1000).optional().describe(PROJECT_DESCRIPTION),
  }),
  videos_inspect: z.strictObject({
    video: videoArg,
    fromSeconds: z.number().nonnegative().optional().describe('只列与这段时间相交的片段：起点（秒）'),
    toSeconds: z.number().positive().optional().describe('只列与这段时间相交的片段：终点（秒）'),
    limit: z.number().int().min(1).max(1000).optional().describe('最多列多少个片段，默认 200'),
  }),
  videos_frames: z.strictObject({
    video: videoArg,
    at: z
      .array(secondsText)
      .min(1)
      .max(MAX_FRAMES)
      .optional()
      .describe(`要取帧的时刻：时间线上的秒数（十进制字符串，例如 "12.5"），最多 ${MAX_FRAMES} 个；与 range 只给一个`),
    range: z
      .string()
      .regex(/^\d+(\.\d+)?:\d+(\.\d+)?$/)
      .optional()
      .describe('一段时间 "起:止"（秒，例如 "10:20"），从起点开始等间隔取 count 帧；与 at 只给一个'),
    count: z
      .number()
      .int()
      .min(1)
      .max(MAX_FRAMES)
      .optional()
      .describe(`只和 range 一起用：取几帧，默认 ${DEFAULT_RANGE_COUNT}，最多 ${MAX_FRAMES}`),
    format: z.enum(['png', 'jpeg']).optional().describe('图片格式：png（默认）或 jpeg'),
    maxWidth: z
      .number()
      .int()
      .min(16)
      .max(1920)
      .optional()
      .describe('可选。帧的最大宽度（像素），按比例缩小、不放大；不给时长边不超过 1280'),
  }),
  videos_history: z.strictObject({
    video: videoArg,
    limit: z.number().int().min(1).max(200).optional().describe('最多列多少笔修改（从最近的往前），默认 20'),
  }),
  videos_import_package: z.strictObject({
    file: z.string().min(1).max(4096).describe('便携包（.baocut 文件）：相对工作目录的路径或绝对路径'),
    project: z.string().min(1).max(1000).optional().describe(PROJECT_DESCRIPTION),
    name: z.string().min(1).max(200).optional().describe('可选。新视频的名字，也是视频目录名；不给时用包里的视频名'),
  }),
  documents_read: z.strictObject({
    video: videoArg,
    documentId: z.string().min(1).max(200).describe('videos_inspect 的文档里的 documentId'),
    revision: revisionArg.optional().describe('可选。文档的版本（十进制数字字符串）；不给时读当前版本'),
    translateTo: z
      .string()
      .min(1)
      .max(35)
      .optional()
      .describe('可选。读转写是为了自己把它译成这门语言（BCP 47，例如 en、zh-CN）时给：BaoCut 显示「正在翻译」，写入这门语言的译文后结束'),
  }),
  documents_put: z.strictObject({
    video: videoArg,
    document: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('可选。要替换的文档的 documentId（videos_inspect 的文档里的）；不给时新建一份，这时要给 kind'),
    kind: z
      .string()
      .regex(/^[a-z0-9./-]{1,64}$/)
      .optional()
      .describe('新建时的文档种类，例如 speech（转写）、translation（译文）；替换时不用给，给了要与原来的相同'),
    name: z.string().min(1).max(200).optional().describe('可选。文档名；新建时不给用 kind'),
    language: z.string().min(1).max(35).optional().describe('文档的语言（BCP 47，例如 en、zh-CN）；新建译文时必须给'),
    sourceDocument: z.string().min(1).max(200).optional().describe('来源文档的 documentId；新建译文时必须给（它译自的那份转写）'),
    sourceAsset: z.string().min(1).max(200).optional().describe('可选。来源素材的 assetId（转写所属的素材）'),
    body: z
      .record(z.string(), z.unknown())
      .describe(
        '完整的正文对象，整份替换、不是增量：转写照 documents_read 读出的正文改；译文的形状（baocut.translation/2）见 documents_read 的说明',
      ),
    revision: revisionArg
      .optional()
      .describe(
        '可选。视频当前的版本（videos_inspect 或上一次回执的 revision；不是 documents_read 结果里的文档版本），不一致时不写；不给时用最新的版本',
      ),
    label: z.string().min(1).max(120).optional().describe('可选。这笔修改的说明，显示在历史与撤销里；不给时按文档生成'),
    commandId: commandIdArg.optional().describe('可选。同一笔修改重试时带上同一个值，引擎不会重复提交'),
  }),
  assets_import: z.strictObject({
    video: videoArg,
    path: z.string().min(1).max(4096).optional().describe('素材文件：相对工作目录的路径或绝对路径；与 artifactId 只给一个'),
    artifactId: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('生成的产物（jobs_inspect 的 outputs 里的 artifactId），不重新生成；与 path 只给一个'),
    name: z.string().min(1).max(200).optional().describe('可选。素材名；不给时用文件名'),
    storage: z
      .enum(['linked', 'managed'])
      .optional()
      .describe('只用于 path：linked（默认，文件留在原处，视频只记下位置）或 managed（把 bytes 复制进视频目录）；产物总是 managed'),
    place: z
      .strictObject({
        track: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe('main（默认，第一条未锁定的同类轨道：视频、图片放视觉轨，音频放音频轨）或轨道 ID'),
        at: z
          .string()
          .regex(/^(\d+(\.\d+)?|end)$/)
          .optional()
          .describe('开始时间：时间线上的秒数（十进制字符串），或 end（默认，接在轨道末尾）'),
      })
      .optional()
      .describe('可选。导入后放到时间线上：track 为 main（默认）或轨道 ID，at 为秒数或 end（默认）；不给时只登记为素材'),
    revision: revisionArg
      .optional()
      .describe('可选。视频当前的版本（videos_inspect 或上一次回执的 revision），不一致时不导入；不给时用最新的版本'),
    commandId: commandIdArg.optional().describe('可选。同一笔修改重试时带上同一个值，引擎不会重复提交'),
  }),
  assets_prune: z.strictObject({
    video: videoArg,
    assetIds: z
      .array(z.string().min(1).max(200))
      .min(1)
      .max(500)
      .optional()
      .describe('可选。只看（apply 时只删）这些素材；不给时是全部没有引用的素材。代码包与它的预渲染替身成对处理，列出一个就带上另一个'),
    apply: z.boolean().optional().describe('可选。true 时真的删掉（会向用户确认）；默认 false，只列出能删的素材，不改视频'),
    revision: revisionArg
      .optional()
      .describe('可选。只用于 apply：视频当前的版本（videos_inspect 或上一次回执的 revision），不一致时不删；不给时用最新的版本'),
    commandId: commandIdArg.optional().describe('可选。只用于 apply：同一笔修改重试时带上同一个值，引擎不会重复提交'),
  }),
  chapters_adopt: z.strictObject({
    video: videoArg,
    asset: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('可选。章节来自哪个素材（assetId）；不给时用视频里唯一带来源章节（或简介里有时间戳大纲）的素材'),
    document: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('可选。用来吸附的转写（kind speech 的 documentId）；不给时用这个素材唯一的那份转写，没有转写时不吸附'),
    outline: z
      .union([
        z
          .array(
            z.strictObject({
              at: z.number().nonnegative().describe('章节开始的时间：素材（源）时间的秒，不是时间线上的秒'),
              title: z.string().min(1).max(160).describe('标题'),
            }),
          )
          .min(1)
          .max(400),
        z.string().min(1).max(20_000),
      ])
      .optional()
      .describe(
        '可选。显式大纲，优先于素材的来源：[{ at, title }]（素材时间的秒），或一段带时间戳的原文（例如用户贴来的简介，每行「0:00 标题」，至少两条）',
      ),
    label: z.string().min(1).max(120).optional().describe('可选。这笔修改的简短说明，显示在历史与撤销里；不给时是「采用来源章节」'),
    revision: revisionArg
      .optional()
      .describe('可选。视频当前的版本（videos_inspect 或上一次回执的 revision），不一致时不改；不给时用最新的版本'),
    dryRun: z.boolean().optional().describe('可选。true 时只返回计划（吸附与投影的结果），不改视频、不要确认'),
  }),
  edits_ops: z.strictObject({
    op: z
      .enum(OPERATION_TYPES)
      .optional()
      .describe(`可选。只看这一个操作；不给时按操作族列出全部。操作：${OPERATION_TYPES.join('、')}`),
  }),
  edits_apply: z.strictObject({
    video: videoArg,
    expectedRevision: revisionArg.describe('videos_inspect 或上一次回执给出的版本（revision）'),
    label: z.string().min(1).max(120).describe('这笔修改的简短说明，会显示在历史与撤销里，例如「把 demo.mp4 放到 1 秒处」'),
    operations: z
      .array(z.looseObject({ type: z.enum(OPERATION_TYPES) }))
      .min(1)
      .max(200)
      .describe('按顺序执行的操作，格式见工具说明'),
    commandId: commandIdArg.optional().describe('可选。同一笔修改重试时带上同一个值，引擎不会重复提交'),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        '可选。true 时只预检、不提交：检查操作的形态与参数、引用的对象与素材文件在不在、expectedRevision 是不是当前版本，返回补全后的操作与影响；同轨重叠、锁定与保护只在真正提交时由引擎检查',
      ),
  }),
  edits_undo: z.strictObject({
    video: videoArg,
    transactionId: z.string().min(1).max(200).optional().describe('要撤销的那笔修改；省略时撤销你自己最近的一笔'),
    expectedRevision: revisionArg.optional().describe('可选。视频当前的版本，不一致时不撤销'),
  }),
  captions_create: z.strictObject({
    video: videoArg,
    documentId: z.string().min(1).max(200).describe('转写（kind speech）或译文（kind translation）的 documentId'),
    bilingual: z
      .boolean()
      .optional()
      .describe('只用于译文：true 时译文与原文一起显示（译文为主、原文为辅，共用一份字幕样式）；默认 false，只显示译文'),
    layoutProfileId: z
      .enum(LAYOUT_PROFILES)
      .optional()
      .describe('可选。切字幕条用的排版 profile，默认 default；现有的 default 与 two-line 切条参数相同，切出的字幕条一样'),
  }),
};

type ToolName = keyof typeof schemas;

const DEFINITIONS: Record<ToolName, ToolInfo> = {
  videos_list: {
    title: '列出视频',
    description: '列出工作目录里的视频（含 video.db 的子目录），以及其中已经打开的视频的 videoId 和名字。',
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [{ title: '列出视频', args: {} }],
    surfaces: ['agent', 'mcp', 'cli'],
  },
  videos_create: {
    title: '新建视频',
    description: [
      '新建一个空视频（一条视觉轨、一条音频轨）。',
      '不给 project 时建在工作目录（会话所属的项目，或会话的工作目录）里；给了 project 只能是会话所属的项目。返回与 videos_inspect 相同的摘要。',
    ].join('\n'),
    effect: 'mutation',
    examples: [
      { title: '新建 1080p 横屏视频', args: { name: '产品发布会' } },
      { title: '新建竖屏视频', args: { name: '竖屏短片', width: 1080, height: 1920, fps: 30 } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'name',
  },
  videos_inspect: {
    title: '读取视频',
    description: [
      '读取一个视频的当前状态。',
      '包括版本（revision）、序列（帧率、画布、时长）、轨道、时间线上的片段（含摆法、音量、效果与裁剪）、转场、章节、闪避规则、素材库、文档（转写、译文、字幕等，只列文档头，不含正文）、最近的修改历史。',
      '素材从链接导入（或来源里带着平台信息）时有 source：platform、webpageUrl、uploader、uploadDate、title、description（截到 1200 个字符，descriptionTruncated 说明截没截）与作者章节 chapters [{ at, title }]（素材时间的秒，平台给的章节，没有时是简介里的时间戳大纲；未吸附）。润色转写、识别说话人时当背景参考（人名、术语）；要采用作者章节用 chapters_adopt。',
      '片段的 place 是画幅的百分比：x、y 是框中心，w 是框宽占画幅宽的百分比，只列写了的字段；视频、图片等视觉媒体的 mode 为 fullscreen（铺满画布，位置与宽不起作用）或 pip（画中画）。音量是线性倍数，1 为原音量。',
      '修改之前先调用它，拿到 revision 和对象 ID。片段按开始时间排序；片段多时用 fromSeconds/toSeconds 读一段。',
      '下一步：导入素材并放到时间线上用 assets_import，写文档（转写、译文）用 documents_put，看画面用 videos_frames，采用素材来源自带的章节用 chapters_adopt，其余修改用 edits_apply；完整的修改历史与检查点用 videos_history。',
      '时间同时给秒和帧；帧是引擎的权威单位。',
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [
      { title: '读取视频', args: { video: 'demo' } },
      { title: '只看前 30 秒的片段', args: { video: 'demo', fromSeconds: 0, toSeconds: 30, limit: 50 } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'video',
  },
  documents_read: {
    title: '读取文档',
    description: [
      '读取视频里一份文档（转写、译文、字幕等）的正文。',
      '返回文档头（kind、名字、语言、来源素材与来源文档、各版本）、读到的版本与正文。',
      '改文档时先读当前版本，再用 documents_put 写入新的完整正文（document 给这个 documentId）。',
      '转写（kind speech）另带 translationBasis：写译文要用的 sourceBasis 与按规则切好的句子（id、fingerprint、text、wordIds）。要自己翻译时读转写给 translateTo（目标语言）：BaoCut 在视频卡与字幕面板显示「正在翻译」，用 documents_put 写入这门语言的译文时结束（结果的 translationJob 是这条进度记录的 jobId）。自己翻译后用 documents_put 新建译文：kind "translation"、language 为目标语言、sourceDocument 为这份转写的 documentId，body 为 {"schema":"baocut.translation/2","language":目标语言,"sourceBasis":translationBasis.sourceBasis,"units":[每句一个 {"id":"t-<句子 id>","sourceSentenceId":句子 id,"sourceFingerprint":句子 fingerprint,"naturalText":译文,"alignment":{"basis":"natural","correspondence":"sentence","blocks":[],"sourceWordIds":句子 wordIds},"status":"draft"}]}，字段不多不少。',
      'alignment 是这句译文对应的原文词（句级对齐）：导出双语字幕与建字幕层都按它取时间。textHash（"sha256:" 加 naturalText 的 SHA-256）不用自己算，Runtime 写入时补上；写成 null 的，句子与指纹核对得上时 Runtime 同样补成句级对齐（回执的 filledAlignments 是补了几句）。',
      '要把转写或译文显示在画面上，用 captions_create 建字幕层，不要自己写字幕文档。',
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [{ title: '读一份转写', args: { video: 'demo', documentId: 'doc_speech_1' } }],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'video',
  },
  videos_frames: {
    title: '取视频帧',
    description: [
      '把时间线上的几个时刻取成图片文件，用来看画面。',
      `at 列出时刻，或 range 给一段时间、count 给帧数（等间隔，从起点开始），一次最多 ${MAX_FRAMES} 帧。每个时刻取画面上最上层的视频片段（启用、轨道可见；视觉轨越靠上越优先），按它的时间映射换成素材时间，取素材的那一帧；那个时刻没有视频片段时 file 为 null，不报错。`,
      '帧不是合成后的画面（composited: false）：字幕、文字、贴纸与叠加的元素不在里面，画中画的位置、裁剪与效果也没有套用。',
      `文件写在写文件目录（会话与终端是工作目录，对外服务是项目的 exports）下的 ${FRAMES_DIR}/<videoId>/，名为 at-<毫秒>ms.png（或 .jpg），同一时刻再取时覆盖。默认 png、长边不超过 1280 像素，maxWidth 按宽度缩小。`,
      '返回 frames（每帧 at、file、width、height，以及取自哪个片段 item 与素材 asset）、composited 与 note。',
    ].join('\n'),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    effect: 'mutation',
    examples: [
      { title: '取两个时刻的帧', args: { video: 'demo', at: ['1', '12.5'] } },
      { title: '前 30 秒均匀取 6 帧', args: { video: 'demo', range: '0:30', count: 6, format: 'jpeg', maxWidth: 640 } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'video',
  },
  videos_history: {
    title: '查看修改历史',
    description: [
      '列出一个视频的修改历史与检查点。',
      '历史从最近的往前列：每笔的 transactionId、label、谁改的（by：user、agent 或 system）、改完的版本 revision、时间、是否已撤销（undone）、是不是撤销（undoOf）与现在能不能撤销（undoAvailable）。检查点是 createCheckpoint 留下的（名字、版本、时间与说明）。',
      '要撤销某一笔，把它的 transactionId 交给 edits_undo。',
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [
      { title: '看最近的修改', args: { video: 'demo' } },
      { title: '看最近 50 笔', args: { video: 'demo', limit: 50 } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'video',
  },
  videos_import_package: {
    title: '打开便携包',
    description: [
      '把一个便携包（.baocut 文件）打开成一个新视频。',
      '边核对边解开（格式与版本、每个文件的长度与 sha256），建成一个新的视频目录（新的 videoId，素材全部收进视频）；任何一步失败都不留下视频目录。',
      '不给 project 时建在工作目录（会话所属的项目，或会话的工作目录）里；给了 project 只能是会话所属的项目。目录名用 name，不给时用包里的视频名，重名时加序号。返回与 videos_inspect 相同的摘要。',
    ].join('\n'),
    effect: 'mutation',
    examples: [
      { title: '打开便携包', args: { file: 'exports/产品发布会.baocut' } },
      { title: '打开并改名', args: { file: '/Users/me/Downloads/demo.baocut', name: '发布会（审阅）' } },
    ],
    surfaces: ['agent', 'cli'],
    positional: 'file',
  },
  documents_put: {
    title: '写入文档',
    description: [
      '写入视频里一份文档（转写、译文等）的新版本，或新建一份文档。',
      '编译成一个 putDocument 操作，一笔修改、可以撤销。body 是完整的正文对象：替换时先用 documents_read 读出当前正文再改，给 document；新建时不给 document，给 kind。',
      '新建译文：kind "translation"、language 为目标语言、sourceDocument 为它译自的转写，body 照 documents_read 返回的 translationBasis 填（形状见 documents_read 的说明）；alignment 写成 null 时 Runtime 按句子补上句级对齐（结果的 filledAlignments 是补了几句）。写完用 captions_create 把译文做成字幕。',
      '正文与原来相同时不产生新版本。不给 revision 时用最新的版本。',
      '返回与 edits_apply 相同的回执，另有文档的 documentId。',
    ].join('\n'),
    effect: 'mutation',
    examples: [
      {
        title: '新建一份英文译文',
        args: {
          video: 'demo',
          kind: 'translation',
          language: 'en',
          sourceDocument: 'doc_speech_1',
          body: {
            schema: 'baocut.translation/2',
            language: 'en',
            sourceBasis: {
              speechRef: { id: 'doc_speech_1', revision: '3' },
              sequenceId: 'seq_1',
              scopeLineage: [],
              editViewHash: 'sha256:…',
            },
            units: [
              {
                id: 't-s1',
                sourceSentenceId: 's1',
                sourceFingerprint: 'sha256:…',
                naturalText: 'Hello, everyone.',
                alignment: null,
                status: 'draft',
              },
            ],
          },
        },
      },
      {
        title: '替换转写的正文',
        args: {
          video: 'demo',
          document: 'doc_speech_1',
          revision: '12',
          body: {
            schema: 'baocut.speech/1',
            clock: 'source-asset',
            timescale: 1000,
            speakers: [],
            words: [],
            sentences: null,
            chapters: [],
          },
          label: '修正转写里的错字',
        },
      },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'video',
  },
  assets_import: {
    title: '导入素材',
    description: [
      '把一个媒体文件或生成的产物导入为视频的素材，可以同时放到时间线上。',
      '编译成 importAsset（给了 place 时再加一个 addItem），一笔修改、可以撤销。path 默认 linked：文件留在原处，之后移动或删除它素材就缺失了；用户要求复制进视频，或文件是之后会清理的临时文件时给 storage "managed"。artifactId 是 jobs_inspect 的 outputs 里的产物，bytes 总是收进视频。',
      'place.track 为 main（默认）时放在第一条未锁定的同类轨道上（视频、图片放视觉轨，音频放音频轨），也可以给轨道 ID；place.at 为秒数，或 end（默认，接在轨道末尾）。',
      '返回与 edits_apply 相同的回执，另有 assetId 与 itemId（没有放到时间线上时 itemId 为 null）。',
    ].join('\n'),
    effect: 'mutation',
    examples: [
      { title: '导入并接在主轨末尾', args: { video: 'demo', path: 'clips/intro.mp4', place: {} } },
      { title: '导入背景音乐放到 0 秒', args: { video: 'demo', path: 'music/bgm.mp3', storage: 'managed', place: { at: '0' } } },
      { title: '导入生成的图片（只登记）', args: { video: 'demo', artifactId: 'sha256:3f2a…' } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'video',
  },
  assets_prune: {
    title: '清理没用的素材',
    description: [
      '列出并删掉视频里没有任何引用的素材：所有序列上的片段与它的预渲染替身、章节缩略图、文档（转写、剪口集合、剪辑提案）的来源都不再指向它。引用由引擎判断。',
      '默认只列出（不改视频、不要确认）：每项 assetId、name、kind、mediaType、byteLength（当前版本的字节数）、storage（managed 在视频目录里，linked 文件留在原处）与 pairedWith（成对的另一半）。apply: true 时编译成 removeAssets 删掉它们（一笔修改、可以撤销），会向用户确认。',
      '代码包与它烘焙出的预渲染替身成对处理：compositions_import 带 replace 换版本之后，旧版本的代码包与替身都没有引用了，删其中一个就带上另一个。',
      '只删素材记录：managed 的 bytes 之后由清理按引用回收（撤销与检查点还用得到时保留），linked 的原文件不动。还有引用的素材拒绝删除（INVALID_OPERATION，details.rule 为 asset-in-use，details.usedBy 列出谁在用）；要删就先删掉或换掉用它的片段。',
      '只在用户要清理、或你自己换掉的旧版本（例如改文案后替换的代码画面）用不着了时用；用户导入、还没放上时间线的素材可能还要用，先问用户。',
    ].join('\n'),
    effect: 'mutation',
    examples: [
      { title: '看看哪些素材没用到', args: { video: 'demo' } },
      { title: '删掉换下来的旧版代码画面', args: { video: 'demo', assetIds: ['asset_01J…'], apply: true } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'video',
  },
  chapters_adopt: {
    title: '采用来源章节',
    description: [
      '把素材来源自带的章节吸附到转写、投影到时间线，整个替换视频的章节列表。',
      '章节来自从链接导入时平台给的 chapters，没有时是简介里的时间戳大纲；或你给的 outline。编译成一个 setChapters（一笔修改、可以撤销），会向用户确认。',
      '吸附：作者的时间戳只精确到秒、常比话题真正开始早几秒，每一章（时间 t）吸到转写最近的结构起点。先在 [t-1, t+2] 秒里依次找段落、句子、cue 的起点，第一个有候选的层定结果：只有一个是 matched，有几个是 ambiguous（取离 t 最近的，同样近取 t 之后的）；都没有时放宽到 [t-4, t+6] 秒、只认段落与句子起点，取最近的（snapped）；再没有时找 [t-1, t+2] 秒里的词起点（matched 或 ambiguous）；都没有就保留原时间（unanchored）。没有转写时全部 unanchored。回执只给选中的锚，ambiguous 的几章对照转写确认。',
      '清洗：丢空标题、按时间排序、同一时刻只留一章、首章钳到 0、丢掉非严格递增的。投影：素材时间换成时间线秒（按这个素材在时间线上的片段；同一段素材放了几次取最早的）；落在剪掉部分的章节标 offTimeline、记 unanchored，落到之后最近的片段起点（之后没有就落到之前最近的那个）；落到同一帧的只留第一章。',
      '回执与 edits_apply 相同，另有 sourceChapters：entries（来源章节条数）、matched / ambiguous / snapped / unanchored（采用的各章的状态计数）与 rows（每章 title、时间线秒 at、素材秒 sourceAt、status、anchor { tier, snippet }、offTimeline）。dryRun: true 只返回同样的计划，不改视频。',
      '素材没有来源章节也没给 outline 时拒绝（NO_SOURCE_CHAPTERS）；素材不在时间线上时拒绝（ASSET_NOT_PLACED）。只要标题与时间，不写摘要；要改个别章节或补摘要，之后用 edits_apply 的 upsertChapter。',
      '采用之前先 dryRun 看计划：ambiguous 与 unanchored 的几章对照转写确认，必要时改 outline 再调用。',
    ].join('\n'),
    effect: 'mutation',
    examples: [
      { title: '先看计划', args: { video: 'demo', dryRun: true } },
      { title: '采用链接导入素材的章节', args: { video: 'demo', asset: 'asset_01J…' } },
      { title: '用用户贴来的大纲', args: { video: 'demo', outline: '0:00 开场\n1:42 产品演示\n5:10 问答' } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'video',
  },
  edits_ops: {
    title: '查看修改操作',
    description: [
      '列出 edits_apply 能用的操作：按操作族分组，每个操作的说明、参数的 JSON Schema 与一个示例。',
      '给 op 时只看那一个。schema 是你写的形态：时间写秒数，sequenceId 与 alignment 可以省略；字段的取值与适用范围仍由引擎校验。',
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [
      { title: '列出全部操作', args: {} },
      { title: '只看 setTransition', args: { op: 'setTransition' } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'op',
  },
  edits_apply: {
    title: '修改视频',
    description: [
      '对一个视频提交一笔修改。',
      'operations 按顺序执行，全部成功才提交；任何一步失败整笔不生效，视频不变。',
      '返回回执：新的版本、创建/修改/删除的对象 ID、时长变化、时间对齐到帧的结果。只有回执里的才是真正改了的。',
      '',
      TIME_CONVENTIONS,
      '',
      '操作（每个操作的参数 JSON Schema 与示例用 edits_ops 查）：',
      ...EDIT_OPERATIONS.flatMap((spec) => spec.doc),
      '',
      '同一轨道上的片段不能重叠；锁定的片段和轨道不能修改。版本冲突（PROJECT_REVISION_CONFLICT）说明视频刚被改过：重新 videos_inspect 再决定。',
      '',
      'dryRun: true 只预检不提交（视频不变、不进历史）：形态、参数、引用的对象与文件、版本对不上时与真正提交同样的错误；通过时返回补全后的操作与影响（committed: false）。重叠、锁定与任务保护只有提交时才知道。',
    ].join('\n'),
    effect: 'mutation',
    examples: [
      {
        title: '导入素材并放到 1 秒处',
        args: {
          video: 'demo',
          expectedRevision: '12',
          label: '把 demo.mp4 放到 1 秒处',
          operations: [
            { type: 'importAsset', path: 'demo.mp4', ref: 'clip' },
            { type: 'addItem', asset: { ref: 'clip' }, at: 1 },
          ],
        },
      },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'video',
  },
  edits_undo: {
    title: '撤销修改',
    description: '撤销一笔修改。默认是你自己最近的一笔，也可以指定 transactionId。撤销本身也是一笔新的修改，返回同样的回执。',
    effect: 'mutation',
    examples: [{ title: '撤销自己最近的一笔', args: { video: 'demo' } }],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'video',
  },
  captions_create: {
    title: '建立字幕层',
    description: [
      '把一份转写或译文做成字幕显示在画面上。',
      '新建一份字幕文档（kind caption）并放到字幕轨上，一笔修改、可以撤销。',
      '转写（kind speech）建原文字幕：按词时间与显示宽度切条，放进空着的字幕轨（没有时新建一条）；同一素材已有原文字幕显示着时，新的一层停用着放上去。',
      '译文（kind translation）建这门语言的字幕：每句译文按句级对齐（alignment.sourceWordIds）取原句的时间，按显示宽度切条，新建一条字幕轨；只看译文时把配对的原文字幕拿下（停用，不删），bilingual 为 true 时译文为主、原文为辅，两层共用一份字幕样式、原文放回画面。译文有 alignment 为 null 的句子时拒绝（TRANSLATION_UNALIGNED）：用 documents_put 重新写一次译文，Runtime 会按句子补上对齐。',
      '同一份文档已经有字幕层时不覆盖，照样新建一层（结果的 existing 指出已有的那层；已有的显示着时新的一层停用着放上去）。素材不在时间线上（CAPTIONS_NOT_ON_TIMELINE）或没有可显示的字幕条（CAPTIONS_EMPTY）时不建。',
      '双语（bilingual: true）时时间线上还没有这份转写的原文字幕层的，同一次调用里先给转写建原文字幕层再建译文的一层（一笔修改，撤销时一起撤），不用先对转写调用一次。',
      '返回：transactionId、新字幕文档的 documentId、trackId、字幕实例的 itemIds、字幕条数 cueCount、是否显示（enabled）与新的版本 revision；译文另有 bilingual 与配对的原文字幕层 pairedOriginal { documentId, itemIds, created }（created 为 true 是这次顺带建的；没有配对的原文时 null，bilingualNote 说明）。',
    ].join('\n'),
    effect: 'mutation',
    examples: [
      { title: '给转写建原文字幕', args: { video: 'demo', documentId: 'doc_speech_1' } },
      { title: '给译文建双语字幕', args: { video: 'demo', documentId: 'doc_translation_1', bilingual: true } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'video',
  },
};
// i18n-ignore-end

/** 帧率：常见的 NTSC 小数帧率换成精确的分数。 */
function rateOf(fps: number): Rate {
  const ntsc: Record<string, Rate> = {
    '23.976': { num: 24000, den: 1001 },
    '29.97': { num: 30000, den: 1001 },
    '59.94': { num: 60000, den: 1001 },
  };
  const key = String(Math.round(fps * 1000) / 1000);
  if (ntsc[key]) return ntsc[key];
  if (Number.isInteger(fps)) return { num: fps, den: 1 };
  return { num: Math.round(fps * 1000), den: 1000 };
}

export class VideoTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #videos: VideoService;
  readonly #scope: ToolScope;
  readonly #deps: VideoToolsDeps;

  constructor(deps: VideoToolsDeps) {
    this.#videos = deps.videos;
    this.#scope = deps.scope;
    // 取帧与打开便携包用到时才取（目录一致性测试只构造、不调用）。
    this.#deps = deps;
  }

  dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    switch (name as ToolName) {
      case 'videos_list':
        return this.#list(principal);
      case 'videos_create':
        return this.#create(args as z.infer<(typeof schemas)['videos_create']>, principal);
      case 'videos_inspect':
        return this.#inspect(args as z.infer<(typeof schemas)['videos_inspect']>, principal);
      case 'documents_read':
        return this.#readDocument(args as z.infer<(typeof schemas)['documents_read']>, principal);
      case 'edits_apply':
        return this.#apply(args as z.infer<(typeof schemas)['edits_apply']>, principal);
      case 'edits_undo':
        return this.#undo(args as z.infer<(typeof schemas)['edits_undo']>, principal);
      case 'captions_create':
        return this.#captions(args as z.infer<(typeof schemas)['captions_create']>, principal);
      case 'videos_frames':
        return this.#frames(args as z.infer<(typeof schemas)['videos_frames']>, principal);
      case 'videos_history':
        return this.#history(args as z.infer<(typeof schemas)['videos_history']>, principal);
      case 'videos_import_package':
        return this.#importPackage(args as z.infer<(typeof schemas)['videos_import_package']>, principal);
      case 'documents_put':
        return this.#putDocument(args as z.infer<(typeof schemas)['documents_put']>, principal);
      case 'assets_import':
        return this.#importAsset(args as z.infer<(typeof schemas)['assets_import']>, principal);
      case 'assets_prune':
        return this.#pruneAssets(args as z.infer<(typeof schemas)['assets_prune']>, principal);
      case 'chapters_adopt':
        return this.#adoptChapters(args as z.infer<(typeof schemas)['chapters_adopt']>, principal);
      case 'edits_ops':
        return Promise.resolve(this.#operations(args as z.infer<(typeof schemas)['edits_ops']>, principal));
    }
  }

  // ---- 工具 ----

  async #list(principal: ToolPrincipal) {
    return this.#scope.listVideos(this.#scope.authorize(principal, false));
  }

  async #create(args: z.infer<(typeof schemas)['videos_create']>, principal: ToolPrincipal) {
    const access = this.#scope.authorize(principal, true);
    // 位置先解析（对外服务缺 project、看不到的项目不弹确认）；确认之后才为新建做准备（无项目会话建项目并绑定，§3.10）。
    await this.#scope.createRoot(access, args.project, { locate: true });
    const approval = await this.#scope.confirm(access, {
      tool: 'videos_create',
      ...confirmSummary(RcAgentTools.createVideoSummary({ name: args.name })),
    });
    const { root, scope, note } = await this.#scope.createRoot(access, args.project);
    const opened = await this.#videos.create(
      {
        name: args.name,
        ...(args.width ? { width: args.width } : {}),
        ...(args.height ? { height: args.height } : {}),
        ...(args.fps ? { fps: rateOf(args.fps) } : {}),
        commandId: newId('cmd'),
      },
      root,
      scope,
      principal,
    );
    const created: VideoCreated = {
      videoId: opened.ref.videoId,
      videoName: opened.snapshot.video.name,
      target: { ...scope, path: opened.ref.relPath },
      videoRevision: opened.snapshot.video.revision,
    };
    await this.#scope.recordCreated?.(access, created);
    return { ...digestVideo(opened.snapshot.video, opened.ref.relPath, []), ...(note ? { note } : {}), ...approvalField(approval) };
  }

  async #inspect(args: z.infer<(typeof schemas)['videos_inspect']>, principal: ToolPrincipal) {
    const access = this.#scope.authorize(principal, false);
    const opened = await this.#scope.open(args.video, access);
    const { entries } = await this.#videos.history(opened.ref.videoId, 10);
    // 打开之后到读历史之间可能又有修改：摘要取最新的镜像。
    const snapshot = this.#videos.mirror(opened.ref.videoId)?.video ?? opened.snapshot.video;
    return digestVideo(snapshot, opened.ref.relPath, entries, {
      ...(args.fromSeconds !== undefined ? { from: args.fromSeconds } : {}),
      ...(args.toSeconds !== undefined ? { to: args.toSeconds } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    });
  }

  async #readDocument(args: z.infer<(typeof schemas)['documents_read']>, principal: ToolPrincipal) {
    // 声明要翻译（translateTo）是要写的意图：规划模式下不登记。
    const access = this.#scope.authorize(principal, args.translateTo !== undefined);
    const opened = await this.#scope.open(args.video, access);
    const videoId = opened.ref.videoId;
    if (!this.#videos.mirror(videoId)?.video.documents[args.documentId]) {
      // i18n-ignore: 给模型的工具说明、错误与下一步
      throw new ToolError('DOCUMENT_NOT_FOUND', `这个视频里没有文档 ${args.documentId}：用 videos_inspect 的文档里的 documentId`);
    }
    const content = await this.#videos.document(videoId, args.documentId, args.revision);
    const sequenceId = this.#videos.mirror(videoId)?.video.rootSequenceId ?? opened.snapshot.video.rootSequenceId;
    const basis = translationBasis(content, sequenceId);
    if (args.translateTo === undefined) return { videoId, ...content, ...basis };
    if (content.document.kind !== 'speech') {
      // i18n-ignore: 给模型的工具说明、错误与下一步
      throw new ToolError('INVALID_ARGUMENTS', `translateTo 只用于转写（kind speech）；文档 ${args.documentId} 是 ${content.document.kind}`);
    }
    const sentences = (basis.translationBasis?.sentences as unknown[] | undefined)?.length ?? 0;
    const jobId = this.#scope.translationStarted?.(access, {
      videoId,
      sourceDocumentId: content.document.id,
      language: args.translateTo,
      sentences,
      sourceRevision: content.revision,
    });
    return { videoId, ...content, ...basis, ...(jobId ? { translationJob: jobId } : {}) };
  }

  async #apply(args: z.infer<(typeof schemas)['edits_apply']>, principal: ToolPrincipal) {
    if (args.dryRun) return this.#preflight(args, principal);
    const access = this.#scope.authorize(principal, true);
    const approval = await this.#scope.confirm(access, {
      tool: 'edits_apply',
      video: args.video,
      ...confirmSummary(
        RcAgentTools.editsSummary({
          label: args.label,
          count: args.operations.length,
          types: [...new Set(args.operations.map((op) => op.type))].join(RcAgentTools.listSeparator().text),
        }),
      ),
    });
    const opened = await this.#scope.open(args.video, access);
    const submitted = await this.#submit(access, opened, principal, {
      expectedRevision: args.expectedRevision,
      label: args.label,
      operations: args.operations,
      commandId: args.commandId,
    });
    return {
      ...submitted.digest,
      ...(submitted.filledAlignments ? { filledAlignments: submitted.filledAlignments } : {}),
      ...approvalField(approval),
    };
  }

  /**
   * `edits_apply` 的预检（`dryRun`，Agent 面设计 §3.3）：走提交路径里引擎之前的每一步（产物换成导入操作、补全操作、对外服务的
   * 路径限制），再按 `edits_ops` 的 schema 检查每个操作的参数、引用的对象 ID 与导入的文件在不在、`expectedRevision` 是不是当前版本。
   * 不提交、不进历史、不要确认（不写任何东西）。命令与协议规范 §7.2 的 `prepareBatch`（引擎按冻结版本做领域校验）还没有实现：
   * 同轨重叠、锁定与任务保护只在提交时由引擎检查，结果的 `note` 照实说明。
   */
  async #preflight(args: z.infer<(typeof schemas)['edits_apply']>, principal: ToolPrincipal) {
    const access = this.#scope.authorize(principal, false);
    const opened = await this.#scope.open(args.video, access);
    const video = this.#current(opened);
    const issues: { index: number; path: string; message: string }[] = [];
    for (const [index, op] of args.operations.entries()) {
      const spec = EDIT_OPERATIONS.find((s) => s.type === op.type)!;
      const parsed = spec.schema.safeParse(op);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) issues.push({ index, path: issue.path.join('.'), message: issue.message });
      }
    }
    if (issues.length > 0) throw preflightError(issues);
    const resolved = await this.#resolveArtifacts(args.operations, access);
    const base = this.#scope.importBase(access, opened);
    const operations = normalizeOperations(resolved, video.rootSequenceId, base.cwd);
    if (base.confine) await confineImports(operations, base.confine);
    const known = knownIds(video);
    const touched = new Set<string>();
    const imports: string[] = [];
    for (const [index, op] of operations.entries()) {
      for (const { path: at, id } of referencedIds(op)) {
        if (known.has(id)) touched.add(id);
        // i18n-ignore: 给模型的工具说明、错误与下一步
        else issues.push({ index, path: at, message: `这个视频里没有 ${id}` });
      }
      if (op.type === 'importAsset' && typeof op.path === 'string') {
        const found = await fs.stat(op.path).then(
          () => true,
          () => false,
        );
        if (found) imports.push(op.path);
        // i18n-ignore: 给模型的工具说明、错误与下一步
        else issues.push({ index, path: 'path', message: `读不到要导入的文件 ${op.path}` });
      }
    }
    if (issues.length > 0) throw preflightError(issues);
    if (args.expectedRevision !== video.revision) {
      // i18n-ignore-start: 给模型的工具说明、错误与下一步
      throw new ToolError('PROJECT_REVISION_CONFLICT', `视频已经是版本 ${video.revision}，不是 ${args.expectedRevision}`, {
        expectedRevision: args.expectedRevision,
        currentRevision: video.revision,
        next: '用 videos_inspect 重新读取，按新的状态决定要不要改、怎么改',
      });
      // i18n-ignore-end
    }
    const counts: Record<string, number> = {};
    for (const op of operations) counts[op.type as string] = (counts[op.type as string] ?? 0) + 1;
    return {
      dryRun: true,
      committed: false,
      videoId: opened.ref.videoId,
      revision: video.revision,
      label: args.label,
      operations,
      impact: { operations: counts, touched: [...touched].sort(), imports },
      // i18n-ignore: 给模型的工具说明、错误与下一步
      note: '只做了预检，视频没有改。同轨重叠、锁定与任务保护只在提交时由引擎检查；去掉 dryRun、带同样的 expectedRevision 再调用一次才会提交。',
    };
  }

  /**
   * 提交一笔修改：与 `edits_apply` 同一条路径（产物换成导入操作、秒数换成引擎的形态、对外服务的素材路径限制在项目里、
   * 译文补句级对齐），`documents_put` 与 `assets_import` 编译出操作后也走这里。
   */
  async #submit(
    access: ToolAccess,
    opened: VideoOpenResult,
    principal: ToolPrincipal,
    edit: { expectedRevision: string; label: string; operations: Record<string, unknown>[]; commandId: string | undefined },
  ) {
    const resolved = await this.#resolveArtifacts(edit.operations, access);
    const base = this.#scope.importBase(access, opened);
    const operations = normalizeOperations(resolved, opened.snapshot.video.rootSequenceId, base.cwd);
    if (base.confine) await confineImports(operations, base.confine);
    // 智能体写的译文：alignment 为 null 或缺字段的单元按句子补上句级对齐（视频格式规范 §5.3）。
    const filledAlignments = await fillTranslationAlignments(
      operations,
      (this.#videos.mirror(opened.ref.videoId)?.video ?? opened.snapshot.video).documents,
      async (documentId, revision) => (await this.#videos.document(opened.ref.videoId, documentId, revision)).body,
    );
    const result = await this.#videos.apply(
      {
        videoId: opened.ref.videoId,
        commandId: this.#scope.commandId(access, edit.commandId),
        expectedRevision: edit.expectedRevision,
        operations: operations as never,
        label: edit.label,
      },
      principal,
      { ...taskOf(access), protections: this.#scope.protections?.(access, opened.ref.videoId) ?? [] },
    );
    // 写入了译文：智能体自己翻译的进度记录（`documents_read` 的 translateTo）随之完成。
    for (const op of operations) {
      const source = (op.sourceDocument as { documentId?: unknown } | undefined)?.documentId;
      if (op.type !== 'putDocument' || op.kind !== 'translation' || typeof source !== 'string' || typeof op.language !== 'string') continue;
      const documentId =
        typeof op.documentId === 'string' ? op.documentId : typeof op.ref === 'string' ? (result.receipt.refs?.[op.ref] ?? null) : null;
      this.#scope.translationWritten?.(access, { videoId: opened.ref.videoId, sourceDocumentId: source, language: op.language, documentId });
    }
    return { result, digest: this.#receipt(opened, result, access), filledAlignments };
  }

  /** 当前的视频：镜像里的最新状态，镜像不在时用打开时的快照。 */
  #current(opened: VideoOpenResult): VideoSnapshot {
    return this.#videos.mirror(opened.ref.videoId)?.video ?? opened.snapshot.video;
  }

  /**
   * 取帧（Agent 面设计 §4.3）：时间线上的时刻 → 最上层的视频片段 → 素材时间 → 素材的一帧（`video-frames.ts`）。
   * 只读视频、不改它，但会写文件：写到范围给的写文件目录（对外服务是项目的 `exports/`）下的 `.baocut-out/frames/<videoId>/`。
   */
  async #frames(args: z.infer<(typeof schemas)['videos_frames']>, principal: ToolPrincipal) {
    const access = this.#scope.authorize(principal, false);
    const times = frameTimes(args);
    const opened = await this.#scope.open(args.video, access);
    const videoId = opened.ref.videoId;
    const video = this.#current(opened);
    const dir = await framesDirectory(this.#scope.saveRoot(access, opened), videoId, this.#scope.importBase(access, opened).confine);
    const format = args.format ?? 'png';
    const frames = [];
    for (const at of times) {
      const source = frameSourceAt(video, Number(at));
      if (!source) {
        frames.push({ at, file: null });
        continue;
      }
      const written = await writeFrame(
        this.#deps.analysis,
        source,
        () => this.#videos.assetFile(videoId, source.assetId, source.revision),
        { dir, at, format, maxWidth: args.maxWidth },
      );
      frames.push({ at, ...written, item: source.item.id, asset: source.assetId });
    }
    return { videoId, revision: video.revision, frames, composited: false, note: FRAMES_NOTE };
  }

  async #history(args: z.infer<(typeof schemas)['videos_history']>, principal: ToolPrincipal) {
    const access = this.#scope.authorize(principal, false);
    const opened = await this.#scope.open(args.video, access);
    const { entries } = await this.#videos.history(opened.ref.videoId, args.limit ?? 20);
    const video = this.#current(opened);
    return {
      videoId: opened.ref.videoId,
      revision: video.revision,
      entries: entries.map((entry) => ({
        transactionId: entry.transactionId,
        label: entry.label,
        by: entry.actor.kind,
        revision: entry.videoRevision,
        committedAt: entry.committedAt,
        undone: Boolean(entry.undoneBy),
        ...(entry.undoOf ? { undoOf: entry.undoOf } : {}),
        undoAvailable: entry.undoAvailable,
      })),
      checkpoints: Object.values(video.checkpoints)
        .sort((a, b) => Number(b.videoRevision) - Number(a.videoRevision))
        .map((c) => ({ id: c.id, name: c.name, revision: c.videoRevision, createdAt: c.createdAt, ...(c.note ? { note: c.note } : {}) })),
    };
  }

  /** 打开便携包（`videos.importPackage` 同一个入口，视频格式规范 §8）：位置同 `videos_create`；给了 name 时目录用它，并改视频名。 */
  async #importPackage(args: z.infer<(typeof schemas)['videos_import_package']>, principal: ToolPrincipal) {
    const access = this.#scope.authorize(principal, true);
    await this.#scope.createRoot(access, args.project, { locate: true });
    const approval = await this.#scope.confirm(access, {
      tool: 'videos_import_package',
      ...confirmSummary(RcAgentTools.importPackageSummary({ file: path.basename(args.file) })),
    });
    // 绑定项目会把工作目录里的东西搬进项目：相对路径在绑定之后按新的工作目录解析。
    const { root, scope, note } = await this.#scope.createRoot(access, args.project);
    const file = path.resolve(this.#scope.saveRoot(access), args.file);
    let opened = await this.#deps.packages.import({ ...scope, path: file }, root, scope, principal, {
      ...(args.name ? { name: args.name } : {}),
    });
    if (args.name && opened.snapshot.video.name !== args.name.trim()) {
      await this.#videos.apply(
        {
          videoId: opened.ref.videoId,
          commandId: newId('cmd'),
          expectedRevision: opened.snapshot.video.revision,
          operations: [{ type: 'renameVideo', name: args.name.trim() }] as never,
          label: RcAgentTools.renameVideoLabel().text,
        },
        principal,
        { ...taskOf(access) },
      );
      opened = { ...opened, snapshot: { ...opened.snapshot, video: this.#current(opened) } };
    }
    const created: VideoCreated = {
      videoId: opened.ref.videoId,
      videoName: opened.snapshot.video.name,
      target: { ...scope, path: opened.ref.relPath },
      videoRevision: opened.snapshot.video.revision,
    };
    await this.#scope.recordCreated?.(access, created);
    return { ...digestVideo(opened.snapshot.video, opened.ref.relPath, []), ...(note ? { note } : {}), ...approvalField(approval) };
  }

  /** `documents_put`：编译成一个 `putDocument`（替换时 kind 取原来的），走 `edits_apply` 的同一条路径。 */
  async #putDocument(args: z.infer<(typeof schemas)['documents_put']>, principal: ToolPrincipal) {
    const access = this.#scope.authorize(principal, true);
    const approval = await this.#scope.confirm(access, {
      tool: 'documents_put',
      video: args.video,
      ...confirmSummary(
        args.document
          ? RcAgentTools.putDocumentSummary({ documentId: args.document })
          : RcAgentTools.newDocumentSummary({ kind: args.kind ?? '?' }),
      ),
    });
    const opened = await this.#scope.open(args.video, access);
    const video = this.#current(opened);
    let kind: string;
    let label: string;
    if (args.document !== undefined) {
      const record = video.documents[args.document];
      // i18n-ignore-start: 给模型的工具说明、错误与下一步
      if (!record) {
        throw new ToolError(
          'DOCUMENT_NOT_FOUND',
          `这个视频里没有文档 ${args.document}：用 videos_inspect 的文档里的 documentId；新建时不给 document`,
        );
      }
      if (args.kind !== undefined && args.kind !== record.kind) {
        throw new ToolError('INVALID_ARGUMENTS', `文档 ${args.document} 是 ${record.kind}，不能改成 ${args.kind}：要别的种类就新建一份`);
      }
      // i18n-ignore-end
      kind = record.kind;
      label = args.label ?? RcAgentTools.updateDocumentLabel({ name: args.name ?? record.name }).text;
    } else {
      // i18n-ignore-start: 给模型的工具说明、错误与下一步
      if (args.kind === undefined)
        throw new ToolError('INVALID_ARGUMENTS', '新建文档要给 kind（例如 translation）；替换已有的文档给 document');
      if (args.kind === 'translation' && (args.language === undefined || args.sourceDocument === undefined)) {
        throw new ToolError('INVALID_ARGUMENTS', '新建译文要给 language（目标语言）与 sourceDocument（它译自的转写的 documentId）');
      }
      // i18n-ignore-end
      kind = args.kind;
      label =
        args.label ??
        RcAgentTools.newDocumentLabel({
          name: args.name ?? (kind === 'translation' ? RcAgentTools.translationDocumentName({ language: String(args.language) }).text : kind),
        }).text;
    }
    if (args.sourceDocument !== undefined && !video.documents[args.sourceDocument]) {
      // i18n-ignore: 给模型的工具说明、错误与下一步
      throw new ToolError('DOCUMENT_NOT_FOUND', `这个视频里没有文档 ${args.sourceDocument}（sourceDocument）`);
    }
    const operation: Record<string, unknown> = {
      type: 'putDocument',
      ...(args.document !== undefined ? { documentId: args.document } : {}),
      kind,
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.language !== undefined ? { language: args.language } : {}),
      ...(args.sourceAsset !== undefined ? { sourceAsset: { assetId: args.sourceAsset } } : {}),
      ...(args.sourceDocument !== undefined ? { sourceDocument: { documentId: args.sourceDocument } } : {}),
      body: args.body,
      ref: PUT_DOCUMENT_REF,
    };
    const submitted = await this.#submit(access, opened, principal, {
      expectedRevision: args.revision ?? video.revision,
      label,
      operations: [operation],
      commandId: args.commandId,
    });
    return {
      ...submitted.digest,
      documentId: submitted.result.receipt.refs?.[PUT_DOCUMENT_REF] ?? args.document ?? null,
      ...(submitted.filledAlignments ? { filledAlignments: submitted.filledAlignments } : {}),
      ...approvalField(approval),
    };
  }

  /** `assets_import`：编译成 `importAsset`（给了 place 时再加 `addItem`），一笔事务。 */
  async #importAsset(args: z.infer<(typeof schemas)['assets_import']>, principal: ToolPrincipal) {
    const access = this.#scope.authorize(principal, true);
    // i18n-ignore-start: 给模型的工具说明、错误与下一步
    if ((args.path === undefined) === (args.artifactId === undefined)) {
      throw new ToolError('INVALID_ARGUMENTS', 'path 与 artifactId 给且只给一个');
    }
    if (args.artifactId !== undefined && args.storage === 'linked') {
      throw new ToolError('INVALID_ARGUMENTS', '产物总是收进视频（managed），不能链接');
    }
    // i18n-ignore-end
    const what = args.path !== undefined ? path.basename(args.path) : args.artifactId!;
    const approval = await this.#scope.confirm(access, {
      tool: 'assets_import',
      video: args.video,
      ...confirmSummary(RcAgentTools.importAssetSummary({ name: what, place: Boolean(args.place) })),
    });
    const opened = await this.#scope.open(args.video, access);
    const video = this.#current(opened);
    const operations: Record<string, unknown>[] = [
      {
        type: 'importAsset',
        ...(args.path !== undefined ? { path: args.path } : { artifactId: args.artifactId }),
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.storage !== undefined && args.path !== undefined ? { storage: args.storage } : {}),
        ref: IMPORT_ASSET_REF,
      },
    ];
    if (args.place) {
      const track = args.place.track;
      const at = args.place.at;
      operations.push({
        type: 'addItem',
        asset: { ref: IMPORT_ASSET_REF },
        ...(track !== undefined && track !== 'main' ? { trackId: track } : {}),
        ...(at !== undefined && at !== 'end' ? { at: Number(at) } : {}),
        ...(args.name !== undefined ? { name: args.name } : {}),
      });
    }
    const submitted = await this.#submit(access, opened, principal, {
      expectedRevision: args.revision ?? video.revision,
      label: RcAgentTools.importAssetLabel({ name: what, place: Boolean(args.place) }).text,
      operations,
      commandId: args.commandId,
    });
    const { receipt } = submitted.result;
    const after = this.#current(opened);
    const created = new Set(receipt.createdIds);
    const item = args.place ? (after.sequences[after.rootSequenceId]?.items.find((it) => created.has(it.id)) ?? null) : null;
    return {
      ...submitted.digest,
      assetId: receipt.refs?.[IMPORT_ASSET_REF] ?? null,
      itemId: item?.id ?? null,
      ...approvalField(approval),
    };
  }

  /**
   * `assets_prune`：没有引用的素材由引擎列出（`videos.unusedAssets`，与 `removeAssets` 同一套引用判断）。默认只列出、不要确认；
   * `apply` 时编译成一个 `removeAssets`，一笔可撤销的事务。成对的代码包与预渲染替身在这里就带上，列表与引擎删的一致。
   */
  async #pruneAssets(args: z.infer<(typeof schemas)['assets_prune']>, principal: ToolPrincipal) {
    const apply = args.apply === true;
    const access = this.#scope.authorize(principal, apply);
    const opened = await this.#scope.open(args.video, access);
    const videoId = opened.ref.videoId;
    const video = this.#current(opened);
    const { unused } = await this.#videos.unusedAssets(videoId);
    const byId = new Map(unused.map((asset) => [asset.assetId, asset]));
    const requested = args.assetIds ? [...new Set(args.assetIds)] : [...byId.keys()];
    const missing = requested.filter((id) => !video.assets[id]);
    const inUse = requested.filter((id) => video.assets[id] && !byId.has(id));
    const selected = new Set(requested.filter((id) => byId.has(id)));
    for (const id of [...selected]) for (const partner of byId.get(id)!.pairedWith ?? []) selected.add(partner);
    const assets = unused.filter((asset) => selected.has(asset.assetId));
    const managedBytes = assets.reduce((sum, asset) => sum + (asset.storage === 'managed' ? asset.byteLength : 0), 0);
    const listing = { videoId, revision: video.revision, assets, managedBytes };
    // i18n-ignore-start: 给模型的工具说明、错误与下一步
    if (!apply) {
      return {
        ...listing,
        ...(missing.length ? { notFound: missing } : {}),
        ...(inUse.length ? { inUse } : {}),
        next: assets.length
          ? '这些素材没有任何引用。确认用不着之后带 apply: true（可以只给 assetIds 删其中几个）删掉；用户导入、还没放上时间线的素材先问用户。'
          : '没有可清理的素材。',
      };
    }
    if (missing.length) {
      throw new ToolError('ENTITY_NOT_FOUND', `视频里没有这些素材：${missing.join('、')}`, { assetIds: missing });
    }
    if (inUse.length) {
      throw new ToolError('INVALID_OPERATION', `这些素材还有引用，不能删：${inUse.join('、')}`, {
        details: { rule: 'asset-in-use', assetIds: inUse },
        next: '先不带 apply 调用看能删哪些；要删还在用的素材，先用 edits_apply 删掉或换掉用它的片段、章节缩略图',
      });
    }
    if (!assets.length) return { ...listing, removed: [], next: '没有可清理的素材，视频没有改。' };
    // i18n-ignore-end
    const shown = assets.slice(0, 5).map((asset) => asset.name);
    const approval = await this.#scope.confirm(access, {
      tool: 'assets_prune',
      video: args.video,
      ...confirmSummary(
        RcAgentTools.pruneAssetsSummary({
          count: assets.length,
          names: shown.join(RcAgentTools.listSeparator().text) + (assets.length > shown.length ? '…' : ''),
        }),
      ),
    });
    const submitted = await this.#submit(access, opened, principal, {
      expectedRevision: args.revision ?? video.revision,
      label: RcAgentTools.pruneAssetsLabel({ count: assets.length }).text,
      operations: [{ type: 'removeAssets', assetIds: [...selected].sort() }],
      commandId: args.commandId,
    });
    return {
      ...submitted.digest,
      removed: assets,
      managedBytes,
      ...approvalField(approval),
      // i18n-ignore: 给模型的工具说明、错误与下一步
      note: '只删了素材记录，可以用 edits_undo 撤销。managed 的 bytes 之后由清理按引用回收，linked 的原文件没有动。',
    };
  }

  /**
   * `chapters_adopt`（架构设计 §7.9）：素材来源自带的章节（或显式大纲）由字幕与翻译核心解析、吸附到转写（`bc_source_chapters`，
   * 源时间），这里投影到时间线（`source-chapters.ts`），编译成一个 `setChapters`，一笔可撤销的事务。`dryRun` 时只返回计划。
   */
  async #adoptChapters(args: z.infer<(typeof schemas)['chapters_adopt']>, principal: ToolPrincipal) {
    const dryRun = args.dryRun === true;
    const access = this.#scope.authorize(principal, !dryRun);
    const opened = await this.#scope.open(args.video, access);
    const videoId = opened.ref.videoId;
    const video = this.#current(opened);
    const sequence = video.sequences[video.rootSequenceId]!;
    const assetId = adoptedAsset(video, sequence, args);
    const asset = video.assets[assetId]!;
    const revision = asset.revisions[asset.currentRevision];
    const speechDocument = adoptedSpeech(video, assetId, args.document);
    const speech = speechDocument ? (await this.#videos.document(videoId, speechDocument.id)).body : undefined;
    const durationSeconds = revision?.duration ? mediaTimeToSeconds(revision.duration) : lastWordEnd(speech);
    let plan: SourceChaptersResult;
    try {
      plan = sourceChapters({
        ...(speech !== undefined ? { speech } : {}),
        ...(revision?.provenance.source !== undefined ? { source: revision.provenance.source } : {}),
        ...(args.outline !== undefined ? { outline: args.outline } : {}),
        durationSeconds,
      });
    } catch (error) {
      // i18n-ignore-start: 给模型的工具说明、错误与下一步
      if (error instanceof EditorWasmUnavailable)
        throw new ToolError('TOOL_UNAVAILABLE', '字幕与翻译核心（editor-wasm）没有构建，不能解析来源章节');
      if (error instanceof EditorWasmError) {
        throw new ToolError(
          error.code === 'INVALID_SPEECH' ? 'INVALID_OPERATION' : 'INVALID_ARGUMENTS',
          `来源章节读不懂：${error.message}`,
          {
            details: { rule: error.code },
          },
        );
      }
      throw error;
    }
    if (!plan.rows.length) {
      throw new ToolError(
        'NO_SOURCE_CHAPTERS',
        args.outline !== undefined
          ? '给的 outline 里没有可用的章节（至少一条有时间与标题；原文至少两行时间戳）'
          : `素材 ${assetId} 的来源没有章节，简介里也没有时间戳大纲`,
        {
          assetId,
          next: '看 videos_inspect 的 assets[].source；用户有大纲时用 outline 给出；否则按转写自己分章，用 edits_apply 的 setChapters',
        },
      );
    }
    const segments = assetSegments(sequence, assetId);
    if (!segments.length) {
      throw new ToolError('ASSET_NOT_PLACED', `素材 ${assetId} 不在时间线上，章节没有落点`, {
        assetId,
        next: '先用 assets_import 或 edits_apply 的 addItem 把素材放到时间线上',
      });
    }
    // i18n-ignore-end
    const { kept, dropped } = projectChapters(
      plan.rows.map((row, index) => ({
        title: row.title,
        start: row.start,
        row: { status: row.status, anchor: rowAnchor(plan, index, row) },
      })),
      segments,
      sequence.fps,
    );
    const rows = kept.map(adoptedRow);
    const counts = { matched: 0, ambiguous: 0, snapped: 0, unanchored: 0 };
    for (const row of rows) counts[row.status] += 1;
    const report = {
      entries: plan.summary.entries,
      ...counts,
      rows,
      ...(dropped.length ? { dropped: dropped.map(adoptedRow) } : {}),
    };
    const chapters = kept.map((chapter) => ({ at: chapter.at, title: chapter.title }));
    const existing = sequence.markers.filter((marker) => marker.kind === 'chapter').length;
    // i18n-ignore-start: 给模型的工具说明、错误与下一步
    const notes = [
      ...(speechDocument ? [] : ['素材没有转写，章节没有吸附，都按来源的原时间（unanchored）。先转录再采用能对准话题的起点。']),
      ...(dropped.length ? ['有几章投影到时间线后与前一章落在同一帧（多半都落在剪口之后的同一个起点），没有采用，见 dropped。'] : []),
      ...(existing ? [`会整个替换视频现有的 ${existing} 个章节。`] : []),
    ];
    if (dryRun) {
      return {
        videoId,
        revision: video.revision,
        committed: false,
        assetId,
        ...(speechDocument ? { documentId: speechDocument.id } : {}),
        chapters: chapters.map((chapter) => ({ ...chapter, at: roundSeconds(chapter.at) })),
        sourceChapters: report,
        ...(notes.length ? { notes } : {}),
        next: '确认 ambiguous 与 unanchored 的几章之后不带 dryRun 再调用；要换时间或标题用 outline 给出。',
      };
    }
    // i18n-ignore-end
    const approval = await this.#scope.confirm(access, {
      tool: 'chapters_adopt',
      video: args.video,
      ...confirmSummary(RcAgentTools.adoptChaptersSummary({ count: chapters.length, existing, asset: asset.name })),
    });
    const submitted = await this.#submit(access, opened, principal, {
      expectedRevision: args.revision ?? video.revision,
      label: args.label ?? RcAgentTools.adoptChaptersLabel().text,
      operations: [{ type: 'setChapters', chapters }],
      commandId: undefined,
    });
    return {
      ...submitted.digest,
      assetId,
      ...(speechDocument ? { documentId: speechDocument.id } : {}),
      sourceChapters: report,
      ...(notes.length ? { notes } : {}),
      ...approvalField(approval),
    };
  }

  /** `edits_ops`：操作族与每个操作的说明、JSON Schema 与示例（`edit-ops.ts`）。不读视频，只看调用方能不能用目录。 */
  #operations(args: z.infer<(typeof schemas)['edits_ops']>, principal: ToolPrincipal) {
    this.#scope.authorize(principal, false);
    if (args.op !== undefined) {
      const spec = EDIT_OPERATIONS.find((s) => s.type === args.op)!;
      return { conventions: TIME_CONVENTIONS, operation: describeOperation(spec) };
    }
    return editOperationsCatalog();
  }

  /**
   * 给一份转写或译文建字幕层（架构设计 §7.9「给智能体建字幕层的操作」）：与固定流程的 `captions` 一步同一份算法
   * （`planCaptionLayer`），译文按句级对齐切条（不经 Worker）。提交前按镜像的版本算，期间视频被改过时重新读、重新算。
   */
  async #captions(args: z.infer<(typeof schemas)['captions_create']>, principal: ToolPrincipal) {
    const access = this.#scope.authorize(principal, true);
    const approval = await this.#scope.confirm(access, {
      tool: 'captions_create',
      video: args.video,
      ...confirmSummary(RcAgentTools.captionsSummary({ documentId: args.documentId, bilingual: args.bilingual ?? false })),
    });
    const opened = await this.#scope.open(args.video, access);
    const videoId = opened.ref.videoId;
    const layoutProfileId = args.layoutProfileId ?? 'default';
    const reader = {
      document: async (v: Id, d: Id, revision?: string) => {
        const content = await this.#videos.document(v, d, revision);
        return { revision: content.revision, body: content.body };
      },
    };
    for (let attempt = 1; ; attempt++) {
      const video = this.#videos.mirror(videoId)?.video ?? opened.snapshot.video;
      const record = video.documents[args.documentId];
      if (!record) {
        // i18n-ignore: 给模型的工具说明、错误与下一步
        throw new ToolError('DOCUMENT_NOT_FOUND', `这个视频里没有文档 ${args.documentId}：用 videos_inspect 的文档里的 documentId`);
      }
      if (record.kind !== 'speech' && record.kind !== 'translation') {
        // i18n-ignore-start: 给模型的工具说明、错误与下一步
        throw new ToolError(
          'INVALID_ARGUMENTS',
          `文档 ${args.documentId} 是 ${record.kind}：只能给转写（speech）或译文（translation）建字幕层`,
        );
      }
      if (record.kind === 'speech' && args.bilingual) {
        throw new ToolError('INVALID_ARGUMENTS', 'bilingual 只用于译文：转写建的是原文字幕，双语要给译文的 documentId');
      }
        // i18n-ignore-end
      const sequence = video.sequences[video.rootSequenceId]!;
      const source: CaptionSource =
        record.kind === 'speech'
          ? { kind: 'speech', documentId: record.id }
          : { kind: 'translation', documentId: record.id, bilingual: args.bilingual ?? false, cues: 'sentence-alignment' };
      const plan = await planCaptionLayer(reader, { videoId, sequence, documents: video.documents, source, pairOriginal: true }).catch(
        (error: unknown) => {
          throw captionError(error);
        },
      );
      if ('reason' in plan) {
        // i18n-ignore-start: 给模型的工具说明、错误与下一步
        throw plan.reason === 'empty'
          ? new ToolError('CAPTIONS_EMPTY', '文档里没有可以显示的字幕条：没有建立字幕层')
          : new ToolError('CAPTIONS_NOT_ON_TIMELINE', '时间线上没有取用这份文档的素材的片段：字幕投不到画面上，没有建立字幕层', {
              next: '先用 assets_import（place）或 edits_apply 的 addItem 把素材放到时间线上，再建字幕层',
            });
        // i18n-ignore-end
      }
      let result: EditResult;
      try {
        result = await this.#videos.apply(
          {
            videoId,
            commandId: this.#scope.commandId(access, undefined),
            expectedRevision: video.revision,
            operations: plan.operations as never,
            // 写进视频的历史与撤销：按当前语言。
            label: RcAgentTools.captionsLabel().text,
          },
          principal,
          { ...taskOf(access), protections: this.#scope.protections?.(access, videoId) ?? [] },
        );
      } catch (error) {
        // 视频在读与写之间被改过：按新的状态重新算，换一个命令再提交。
        if (revisionConflict(error) && attempt < CAPTION_ATTEMPTS) continue;
        throw error;
      }
      const digest = this.#receipt(opened, result, access);
      const refs = result.receipt.refs ?? {};
      const documentId = refs[CAPTION_DOCUMENT_REF] ?? null;
      const originalId = plan.original ? (refs[plan.original.documentRef] ?? null) : null;
      const created = captionItemsCreated(
        result.receipt.createdIds,
        refs,
        this.#videos.mirror(videoId)?.video ?? null,
        documentId,
        originalId,
      );
      const translation = source.kind === 'translation';
      // 配对的原文字幕层：已有的那层，或这一笔顺带建的（created）；都没有时 null，并说明只显示了译文。
      const pairedOriginal = plan.paired
        ? { ...plan.paired, created: false }
        : originalId
          ? { documentId: originalId, itemIds: created.original, created: true }
          : null;
      return {
        transactionId: digest.transactionId,
        revision: digest.revision,
        documentId,
        trackId: insertedTrack(plan.operations, refs),
        itemIds: created.items,
        cueCount: plan.cueCount,
        enabled: plan.enabled,
        ...(translation ? { bilingual: source.bilingual } : {}),
        layoutProfileId,
        existing: plan.existing,
        ...(plan.existing
          ? {
              note: plan.enabled
                // i18n-ignore-start: 给模型的工具说明、错误与下一步
                ? '这份文档已经有字幕层（existing），没有覆盖它，另外新建了一层；不要的那层用 edits_apply 的 deleteItems 删掉'
                : '这份文档已经有字幕层（existing）显示着，没有覆盖它；新的一层停用着放在旁边，要换用时用 edits_apply 的 updateItem 切换 enabled',
                // i18n-ignore-end
            }
          : {}),
        ...(translation
          ? {
              pairedOriginal,
              ...(source.bilingual && !pairedOriginal
                ? {
                    bilingualNote: plan.enabled
                      // i18n-ignore-start: 给模型的工具说明、错误与下一步
                      ? '时间线上没有这份转写的原文字幕层，也没能顺带建一层：只显示了译文。要双语时先对转写调用 captions_create，再撤销这一笔、对译文重新调用'
                      : '这份译文已经有一层显示着，新的一层停用着放上去，没有顺带建原文字幕层：要双语时先对转写调用 captions_create',
                      // i18n-ignore-end
                  }
                : {}),
            }
          : {}),
        undoAvailable: digest.undoAvailable,
        ...approvalField(approval),
      };
    }
  }

  async #undo(args: z.infer<(typeof schemas)['edits_undo']>, principal: ToolPrincipal) {
    const access = this.#scope.authorize(principal, true);
    const approval = await this.#scope.confirm(access, {
      tool: 'edits_undo',
      video: args.video,
      ...confirmSummary(
        args.transactionId ? RcAgentTools.undoSummary({ transactionId: args.transactionId }) : RcAgentTools.undoLatestSummary(),
      ),
    });
    const opened = await this.#scope.open(args.video, access);
    const result = await this.#videos.undo(
      {
        videoId: opened.ref.videoId,
        commandId: newId('cmd'),
        target: args.transactionId ? { transaction: args.transactionId } : 'undo',
        ...(args.expectedRevision ? { expectedRevision: args.expectedRevision } : {}),
      },
      principal,
      { protections: this.#scope.protections?.(access, opened.ref.videoId) ?? [] },
    );
    return { ...this.#receipt(opened, result, access), ...approvalField(approval) };
  }

  /**
   * `importAsset` 的另一种来源：产物（`artifactId`）。只接受这次调用看得到的任务生成的输出；换成从产物库导入的同一个操作，
   * bytes 收进视频（`managed`），来源与生成任务带着视频时导入的完全相同（任务、Provider、模型、参数摘要）。不重新生成。
   * 只下载的从链接导入的媒体也可以：文件在下载目录里（内容核对过），来源记 `origin: 'link-import'`，与流程自己导入的相同。
   */
  async #resolveArtifacts(operations: Record<string, unknown>[], access: ToolAccess): Promise<Record<string, unknown>[]> {
    const resolved: Record<string, unknown>[] = [];
    for (const [index, op] of operations.entries()) {
      if (op.type !== 'importAsset' || op.artifactId === undefined) {
        resolved.push(op);
        continue;
      }
      const { artifactId, name, ref, storage, ...rest } = op as Record<string, unknown>;
      delete rest.type;
      // i18n-ignore-start: 给模型的工具说明、错误与下一步
      if (typeof artifactId !== 'string') throw new OperationShapeError(index, 'artifactId 要是字符串（jobs_inspect 的 outputs 里的）');
      if (rest.path !== undefined) throw new OperationShapeError(index, 'path 与 artifactId 只能给一个');
      const extra = Object.keys(rest);
      if (extra.length > 0) throw new OperationShapeError(index, `从产物导入只接受 artifactId、name、ref，不认识 ${extra.join('、')}`);
      if (storage !== undefined && storage !== 'managed') throw new OperationShapeError(index, '产物总是收进视频（managed），不能链接');
      if (name !== undefined && (typeof name !== 'string' || !name.trim())) throw new OperationShapeError(index, 'name 要是非空字符串');
      if (ref !== undefined && typeof ref !== 'string') throw new OperationShapeError(index, 'ref 要是字符串');
      // i18n-ignore-end
      const { record, output, file } = await this.#scope.visibleArtifact(artifactId, access);
      const outputs = record.result?.outputs ?? [];
      const downloaded = linkImportAssetOperation(
        record,
        { artifactId, file },
        {
          ...(typeof name === 'string' ? { name: name.trim() } : {}),
          ...(typeof ref === 'string' ? { ref } : {}),
        },
      );
      if (downloaded) {
        resolved.push(downloaded);
        continue;
      }
      if (!output || !record.generation) {
        // i18n-ignore: 给模型的工具说明、错误与下一步
        throw new ToolError('ARTIFACT_NOT_MEDIA', '这个产物是转写结果，不是媒体，不能导入为素材');
      }
      const imported = generatedImportOperation(
        record,
        { artifactId, file, index: outputs.indexOf(output), total: outputs.length },
        { ...(ref !== undefined ? { ref } : {}) },
      );
      resolved.push(name !== undefined ? { ...imported, name: (name as string).trim() } : imported);
    }
    return resolved;
  }

  /** 回执摘要交给调用方；会话里同一份回执放一张变更卡（产品设计 §6.5）。 */
  #receipt(opened: VideoOpenResult, result: EditResult, access: ToolAccess) {
    const video = opened.snapshot.video;
    const fps = video.sequences[video.rootSequenceId]!.fps;
    const digest = digestReceipt(result.receipt, fps, result.replayed);
    const { ref } = opened;
    const change: VideoChange = {
      videoId: ref.videoId,
      videoName: this.#videos.ref(ref.videoId)?.name ?? ref.name,
      // 没有记会话的视频由范围补上调用方的会话。
      target: ref.source.projectId
        ? { projectId: ref.source.projectId, path: ref.relPath }
        : { conversationId: ref.source.conversationId ?? '', path: ref.relPath },
      transactionId: result.receipt.transactionId,
      label: result.receipt.label,
      previousRevision: result.receipt.previousRevision,
      videoRevision: result.receipt.videoRevision,
      createdIds: result.receipt.createdIds,
      updatedIds: result.receipt.updatedIds,
      deletedIds: result.receipt.deletedIds,
      durationSeconds: digest.durationSeconds,
      undoOf: result.receipt.undoOf ?? null,
    };
    this.#scope.recordChange(access, change);
    return digest;
  }
}

/** `documents_put` 与 `assets_import` 在编译出的操作里用的 ref，从回执的 `refs` 取新对象的 ID。 */
const PUT_DOCUMENT_REF = 'document';
const IMPORT_ASSET_REF = 'asset';

/** `captions_create` 在版本冲突时重新算、重新提交的次数（与固定流程的 `captions` 一步相同）。 */
const CAPTION_ATTEMPTS = 3;

/** 建字幕层的算法抛出的错误交给智能体：带错误码与细节；对不齐的译文给出下一步。 */
function captionError(error: unknown): unknown {
  if (!(error instanceof PipelineStepError)) return error;
  return new ToolError(error.code, error.message, {
    ...(error.details ? { details: error.details } : {}),
    ...(error.code === 'TRANSLATION_UNALIGNED'
      ? {
          // i18n-ignore: 给模型的工具说明、错误与下一步
          next: '用 documents_read 读出译文，原样用 documents_put 写一次（alignment 写成句级对齐或 null 都行，Runtime 按句子补上），再建字幕层',
        }
      : {}),
  });
}

function revisionConflict(error: unknown): boolean {
  if (!(error instanceof RpcError)) return false;
  const code = (error.details as { code?: unknown } | null | undefined)?.code;
  return error.code === 'conflict' || code === 'PROJECT_REVISION_CONFLICT';
}

/** 这次要建的字幕层（文档 ref 是 `caption` 的那个实例）放在哪条轨上：给了轨道 ID 的就是它，新建的轨道按 `ref` 从回执取。 */
function insertedTrack(operations: EditOperation[], refs: Record<string, Id>): Id | null {
  const inserted = operations.flatMap((op) =>
    op.type === 'insertItems' ? (op.items as Array<{ trackId?: Id; trackRef?: string; documentRef?: string }>) : [],
  );
  const item = inserted.find((it) => it.documentRef === CAPTION_DOCUMENT_REF);
  if (item?.trackId) return item.trackId;
  return item?.trackRef ? (refs[item.trackRef] ?? null) : null;
}

/**
 * 这一笔新建的字幕实例按字幕文档分开：`items` 是这次要建的字幕层的，`original` 是顺带建的原文字幕层的。按提交后的镜像里
 * 实例引用的文档分（引擎在回执之前先发事件，镜像已经是提交后的）；镜像不在时退回到「新建的 ID 里不是 ref 的都算字幕实例」。
 */
function captionItemsCreated(
  createdIds: readonly Id[],
  refs: Record<string, Id>,
  video: VideoSnapshot | null,
  documentId: Id | null,
  originalId: Id | null,
): { items: Id[]; original: Id[] } {
  const made = new Set(Object.values(refs));
  const fresh = createdIds.filter((id) => !made.has(id));
  const captions = video?.sequences[video.rootSequenceId]?.items.filter((it) => it.type === 'caption') ?? null;
  if (!captions || (originalId && !captions.some((it) => it.documentId === originalId))) return { items: fresh, original: [] };
  const byDocument = new Map(captions.map((it) => [it.id, it.documentId]));
  return {
    items: fresh.filter((id) => byDocument.get(id) === documentId),
    original: originalId ? fresh.filter((id) => byDocument.get(id) === originalId) : [],
  };
}

/** 会话的调用带着进行中的任务号（记进事务的来源）；对外服务的没有。 */
function taskOf(access: ToolAccess): { taskId?: string } {
  const taskId = (access as { taskId?: unknown }).taskId;
  return typeof taskId === 'string' ? { taskId } : {};
}

/** `edits_ops` 不给 `op` 时的结果：操作族与每个操作的说明、JSON Schema 与示例。CLI 的离线快照也取它（`spec edits.<op>`）。 */
export function editOperationsCatalog() {
  return {
    conventions: TIME_CONVENTIONS,
    families: OPERATION_FAMILIES.map((family) => ({
      family,
      operations: EDIT_OPERATIONS.filter((s) => s.family === family).map(describeOperation),
    })),
  };
}

/** 预检发现的问题：与引擎拒绝一笔修改时同一个错误码，带第一个出问题的操作与全部问题。 */
function preflightError(issues: { index: number; path: string; message: string }[]): ToolError {
  const first = issues[0]!;
  // i18n-ignore-start: 给模型的工具说明、错误与下一步
  return new ToolError('INVALID_OPERATION', `第 ${first.index + 1} 个操作：${first.path ? `${first.path} ` : ''}${first.message}`, {
    operationIndex: first.index,
    issues,
    next: '按 issues 改正操作（每个操作的参数用 edits_ops 查），再预检或提交',
  });
  // i18n-ignore-end
}

/** 视频里现有对象的 ID：序列、轨道、片段、转场、素材、文档与检查点。 */
function knownIds(video: VideoSnapshot): Set<string> {
  const ids = new Set<string>([
    ...Object.keys(video.sequences),
    ...Object.keys(video.assets),
    ...Object.keys(video.documents),
    ...Object.keys(video.checkpoints),
  ]);
  for (const sequence of Object.values(video.sequences)) {
    for (const track of sequence.tracks) ids.add(track.id);
    for (const item of sequence.items) ids.add(item.id);
    for (const transition of sequence.transitions) ids.add(transition.id);
  }
  return ids;
}

/** 预检要核对的 ID 字段（同一笔里的 `ref` / `trackRef` / `documentRef` 不算）。 */
const ID_FIELD = /^(sequenceId|trackId|itemId|assetId|documentId|transitionId|checkpointId)$/;
const ID_LIST_FIELD = /^(itemIds|assetIds|trackIds|documentIds)$/;

/** 一个（补全过的）操作里引用的已有对象 ID，按字段路径（文档的 `body` 不看）。 */
function referencedIds(value: unknown, at = ''): { path: string; id: string }[] {
  if (Array.isArray(value)) return value.flatMap((entry, i) => referencedIds(entry, at ? `${at}.${i}` : String(i)));
  if (typeof value !== 'object' || value === null) return [];
  const found: { path: string; id: string }[] = [];
  for (const [key, entry] of Object.entries(value)) {
    // 文档正文里的 ID 是正文自己的（词、句、单元），不是视频里的对象。
    if (key === 'body') continue;
    const here = at ? `${at}.${key}` : key;
    if (ID_FIELD.test(key) && typeof entry === 'string') found.push({ path: here, id: entry });
    else if (ID_LIST_FIELD.test(key) && Array.isArray(entry)) {
      for (const [i, id] of entry.entries()) if (typeof id === 'string') found.push({ path: `${here}.${i}`, id });
    } else found.push(...referencedIds(entry, here));
  }
  return found;
}

/** 对外服务的 `importAsset.path`（§12.8：没有项目目录之外的文件访问）：按真实路径必须在 `root` 里面。 */
async function confineImports(operations: Record<string, unknown>[], root: string): Promise<void> {
  const rootReal = await fs.realpath(root);
  const prefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  for (const [index, op] of operations.entries()) {
    if (op.type !== 'importAsset' || typeof op.path !== 'string') continue;
    const real = await fs.realpath(op.path).catch(() => null);
    if (!real || (real !== rootReal && !real.startsWith(prefix))) {
      // i18n-ignore: 给模型的工具说明、错误与下一步
      throw new ToolError('PATH_OUTSIDE_PROJECT', `第 ${index + 1} 个操作：素材文件要在视频所在的项目目录里（相对项目目录的路径）`);
    }
    op.path = real;
  }
}

/**
 * 转写文档写译文要用的依据（视频格式规范 §5.3）：句子与指纹按字幕与翻译核心的规则从词得出（与翻译流程、界面同一份实现），
 * 智能体自己翻译时照填，不用自己切句、算指纹。不是转写、正文读不了或句子的 WASM 没有构建时不带。
 */
// i18n-ignore-start: 给模型的工具说明、错误与下一步
/**
 * `chapters_adopt` 的素材：给了 `asset` 就是它；没给时取视频里唯一带来源章节（或简介）的素材，几个都带时取其中唯一放在
 * 时间线上的；给了 `outline` 时也可以是时间线上唯一的音视频素材。
 */
function adoptedAsset(video: VideoSnapshot, sequence: Sequence, args: { asset?: string; outline?: unknown }): Id {
  if (args.asset !== undefined) {
    if (!video.assets[args.asset]) throw new ToolError('ENTITY_NOT_FOUND', `视频里没有素材 ${args.asset}`, { assetId: args.asset });
    return args.asset;
  }
  const placed = new Set(
    sequence.items.flatMap((item) => (itemTimeMap(item) ? [itemAssetRef(item)?.id] : [])).filter((id) => id !== undefined),
  );
  const sourced = Object.values(video.assets)
    .filter((asset) => hasSourceText(asset.revisions[asset.currentRevision]?.provenance))
    .map((asset) => asset.id);
  const pick = (ids: Id[]): Id | null => (ids.length === 1 ? ids[0]! : null);
  const chosen =
    args.outline === undefined
      ? (pick(sourced) ?? pick(sourced.filter((id) => placed.has(id))))
      : (pick([...placed]) ?? pick(sourced.filter((id) => placed.has(id))));
  if (chosen) return chosen;
  if (args.outline === undefined && !sourced.length) {
    throw new ToolError('NO_SOURCE_CHAPTERS', '视频里没有带来源章节或简介的素材', {
      next: '用户有大纲时用 outline 给出；否则按转写自己分章，用 edits_apply 的 setChapters',
    });
  }
  if (args.outline !== undefined && !placed.size) {
    throw new ToolError('ASSET_NOT_PLACED', '时间线上没有音视频素材，章节没有落点', { next: '先把素材放到时间线上' });
  }
  const candidates = args.outline === undefined ? sourced : [...placed];
  throw new ToolError('INVALID_ARGUMENTS', `有几个素材都可以，用 asset 指定一个：${candidates.join('、')}`, { assetIds: candidates });
}

/** 用来吸附的转写：给了 `document` 就是它（须是这个素材的 speech）；没给时取这个素材唯一的那份，没有时不吸附。 */
function adoptedSpeech(video: VideoSnapshot, assetId: Id, documentId: string | undefined): DocumentRecord | null {
  if (documentId !== undefined) {
    const document = video.documents[documentId];
    if (!document) throw new ToolError('DOCUMENT_NOT_FOUND', `视频里没有文档 ${documentId}`, { documentId });
    if (document.kind !== 'speech' || document.sourceAssetId !== assetId) {
      throw new ToolError('INVALID_ARGUMENTS', `文档 ${documentId} 不是素材 ${assetId} 的转写（kind speech）`, { documentId });
    }
    return document;
  }
  const speeches = Object.values(video.documents).filter((document) => document.kind === 'speech' && document.sourceAssetId === assetId);
  if (speeches.length > 1) {
    const ids = speeches.map((document) => document.id);
    throw new ToolError('INVALID_ARGUMENTS', `素材 ${assetId} 有几份转写，用 document 指定一份：${ids.join('、')}`, { documentIds: ids });
  }
  return speeches[0] ?? null;
}
// i18n-ignore-end

/** 来源里有章节或简介（可能有时间戳大纲）。 */
function hasSourceText(provenance: AssetRevision['provenance'] | undefined): boolean {
  const source = provenance?.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
  const { chapters, description } = source as { chapters?: unknown; description?: unknown };
  return (Array.isArray(chapters) && chapters.length > 0) || (typeof description === 'string' && description.trim() !== '');
}

/** 没有素材时长时，用转写末词的终点当末章的终点。 */
function lastWordEnd(speech: unknown): number {
  const body = speech as { timescale?: unknown; words?: unknown } | undefined;
  if (!body || typeof body.timescale !== 'number' || body.timescale <= 0 || !Array.isArray(body.words)) return 0;
  const ends = body.words.map((word) => (word as { end?: unknown }).end).filter((end): end is number => typeof end === 'number');
  return ends.length ? Math.max(...ends) / body.timescale : 0;
}

/** 一行清洗后的章节选中的锚：首行（起点钳到了 0）按标题取起点最早的那条，其余按（标题, 吸附后的起点）对上。 */
function rowAnchor(plan: SourceChaptersResult, index: number, row: SourceChapterRow): SourceChapterAnchor | undefined {
  const sameTitle = plan.entries.filter((entry) => entry.source.title.trim() === row.title);
  const entry =
    index === 0 ? sameTitle.sort((a, b) => a.source.start - b.source.start)[0] : sameTitle.find((candidate) => candidate.at === row.start);
  return entry?.anchor;
}

type AdoptedRow = {
  title: string;
  at: number;
  sourceAt: number;
  status: SourceChapterStatus;
  anchor?: { tier: SourceChapterAnchor['tier']; snippet: string };
  offTimeline?: true;
};

/** 回执的一行：落在剪掉部分的章节记 unanchored、不带锚（锚所在的话已经剪掉）。 */
function adoptedRow(chapter: ProjectedChapter<{ status: SourceChapterStatus; anchor: SourceChapterAnchor | undefined }>): AdoptedRow {
  const { anchor, status } = chapter.row;
  return {
    title: chapter.title,
    at: roundSeconds(chapter.at),
    sourceAt: roundSeconds(chapter.sourceAt),
    status: chapter.offTimeline ? 'unanchored' : status,
    ...(anchor && !chapter.offTimeline ? { anchor: { tier: anchor.tier, snippet: anchor.snippet } } : {}),
    ...(chapter.offTimeline ? { offTimeline: true as const } : {}),
  };
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function translationBasis(content: DocumentContent, sequenceId: Id): { translationBasis?: Record<string, unknown> } {
  if (content.document.kind !== 'speech') return {};
  let read: ReturnType<typeof sourceSentences>;
  try {
    read = sourceSentences(content.body);
  } catch (error) {
    if (error instanceof EditorWasmUnavailable) return {};
    throw error;
  }
  if ('problem' in read) return {};
  return {
    translationBasis: {
      sourceBasis: {
        speechRef: { id: content.document.id, revision: content.revision },
        sequenceId,
        scopeLineage: [],
        editViewHash: read.editViewHash,
      },
      sentences: read.sentences.map((s) => ({ id: s.id, fingerprint: s.fingerprint, text: s.text, wordIds: s.wordIds })),
    },
  };
}
