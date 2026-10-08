import fs from 'node:fs/promises';
import { z } from 'zod';
import {
  DUB_PIPELINE,
  TRANSCODE_PIPELINE,
  TRANSCRIBE_PIPELINE,
  TRANSLATE_PIPELINE,
  TRANSLATE_SUBTITLES_PIPELINE,
  type PipelineRunner,
} from '@baocut/jobs';
import { RpcError, type CapabilityNotConfiguredDetails } from '@baocut/protocol';
import { RcFlowTools } from '@baocut/protocol/messages/runtime-core';
import { errorBody, ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import { approvalField, confirmSummary, type ToolAccess, type ToolPrincipal, type ToolScope } from './tool-scope.ts';
import { startLinkImport, toolErrorOf, type LinkImportToolsDeps } from './link-import-tools.ts';
import { resolveUserPath } from './video-digest.ts';
import { commandIdArg, videoArg } from './video-tools.ts';

/**
 * 一级动词（Agent 面设计 §4.2，架构设计 §3.5、§7.9）：`transcribe`、`translate`、`dub`、`transcode` 各自启动一条固定流程，
 * 立即返回 `jobId`；流程的步骤、产出与重试都在流程里（`packages/jobs` 的 `pipelines/`），这里只把工具参数换成流程参数、
 * 解析路径与落点、按访问模式确认。`transcribe` 给 `url` 时走 `download` 的同一段（`startLinkImport`）。
 *
 * 路径：`file`、`files`、`outDir` 按 `ToolScope.fileBase` 解析（会话是工作目录，终端是 cwd，`~/` 展开成主目录）；
 * 对外服务（§4.8）没有本机路径，给了以 `INVALID_ARGUMENTS` 拒绝，`next` 指向 `video` / `url`。
 *
 * 外发授权由流程检查（`withPipelineGrants`）：没有覆盖的以 `GRANT_REQUIRED` 拒绝，工具目录照统一格式补上 `next`；
 * 这里不在确认里代发授权（流程的检查只认已有的授权）。
 *
 * 文本模型没有配置时 `translate`（与缺译文的 `dub`）以 `CAPABILITY_NOT_CONFIGURED` 拒绝，`next` 改成智能体自己翻译的路径
 * （§4.4）：翻译是智能体自己能做的事，不是要用户去配置的。
 */

export interface FlowToolsDeps {
  pipelines: PipelineRunner;
  scope: ToolScope;
  /** `transcribe` 给 `url` 时用（与 `download` 同一份依赖）。 */
  linkImport: LinkImportToolsDeps;
}

const LANGUAGE = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/;
const languageArg = z.string().regex(LANGUAGE);
const pathArg = z.string().min(1).max(4000);
const providerArg = z.string().min(1).max(200);
// i18n-ignore-start: 给模型的工具说明、错误与下一步
const glossaryArg = z
  .array(
    z.strictObject({
      source: z.string().min(1).max(200).describe('原文里的写法'),
      target: z.string().min(1).max(200).describe('译法'),
      note: z.string().max(500).optional().describe('可选。说明（什么时候这样译）'),
    }),
  )
  .max(500);

const schemas = {
  transcribe: z.strictObject({
    video: videoArg.optional().describe('输入三选一：转写这个已有视频里的素材（videos_list 给出的 path 或 videoId）'),
    asset: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('可选。只与 video 一起给：要转写的素材（assetId）；不给时取根序列主轨上唯一的素材'),
    file: pathArg
      .optional()
      .describe('输入三选一：本机的音频或视频文件（相对路径按工作目录解析）。默认新建视频、导入它并放上时间线；给 noVideo 时只写文稿文件'),
    url: z
      .string()
      .min(1)
      .max(4000)
      .optional()
      .describe(
        '输入三选一：视频页面的链接，先用 yt-dlp 下载（同 download）。默认新建视频并转写；给 noVideo 时只下载并在媒体旁边写 TXT 与 SRT 文稿',
      ),
    project: z
      .string()
      .min(1)
      .max(1000)
      .optional()
      .describe(
        '可选。给 file 或 url 时新视频（或只下载的文件）所在的项目（项目 id 或已登记项目目录的路径）；不给时与 videos_create 同一处',
      ),
    name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        '可选。新视频的名字：给 file 或 url 时默认取文件名（url 时取页面标题）；给 video 而落点是 new-video 时默认「<原名> · 重新转录」',
      ),
    target: z
      .enum(['new-video', 'replace'])
      .optional()
      .describe(
        '可选。只与 video 一起给：视频已有这个素材的文稿时的落点。new-video（缺省）在同一项目新建一部视频，链接同一份素材；replace 取代当前文稿，一笔可撤销的事务里结转译文、字幕与配音。没有文稿的视频两种都直接写进它',
      ),
    translations: z
      .enum(['carry', 'discard'])
      .optional()
      .describe('可选。只与 target: replace 一起给：carry（缺省）结转译文，原文没变的句子保留译文与审阅状态，变了的标过期；discard 不结转'),
    acceptEdited: z
      .boolean()
      .optional()
      .describe(
        '可选。只与 target: replace 一起给：文稿在转录之后被用户改过时仍然取代（会丢掉那些修改，撤销能拿回）；不给时以 TRANSCRIPT_EDITED 拒绝',
      ),
    noVideo: z
      .boolean()
      .optional()
      .describe(
        '可选。不建视频：给 file 时在 outDir（不给时下载目录）写 <文件名>.txt 与 .srt；给 url 时下载的文件与文稿放进下载目录（给了 project 时是那个项目的 downloads/）',
      ),
    outDir: pathArg.optional().describe('可选。只与 file、noVideo 一起给：文稿的输出目录（不存在时创建）'),
    language: languageArg.optional().describe('可选。断言语言（BCP 47，例如 en、zh-CN）；不给时自动检测'),
    provider: providerArg.optional().describe('可选。转写的服务商（models_capabilities 列出的 providerId）；不给时用默认值'),
    model: providerArg.optional().describe('可选。转写模型；只与 provider 一起给'),
    diarize: z.boolean().optional().describe('可选。区分说话人；不给时按模型，能区分的区分'),
    hint: z.string().min(1).max(1000).optional().describe('可选。识别提示：人名、术语、专有名词；视频里启用的转写术语表照样用上'),
    noCaptions: z.boolean().optional().describe('可选。转写之后不建字幕层（默认建）'),
    commandId: commandIdArg.optional().describe('可选。重试同一次提交时带上同一个值，不会重复创建任务'),
  }),
  translate: z.strictObject({
    video: videoArg.optional().describe('输入二选一：翻译这个视频里的转写（videos_list 给出的 path 或 videoId）'),
    file: pathArg.optional().describe('输入二选一：本机的字幕文件（.srt 或 .vtt），译好写成新文件，不碰视频'),
    to: languageArg.describe('目标语言（BCP 47，例如 zh-CN、en、ja）'),
    document: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('可选。只与 video 一起给：源转写（speech 文档的 documentId）；视频里只有一份时可以不给'),
    style: z.string().min(1).max(500).optional().describe('可选。风格提示，例如「口语、简洁」'),
    glossary: glossaryArg.optional().describe('可选。这次用的术语译法（与视频里启用的翻译术语表合在一起用）'),
    bilingual: z
      .boolean()
      .optional()
      .describe('可选。双语：给 video 时原文与译文两层字幕共用一份样式（要建字幕层）；给 file 时每条原文在上、译文在下'),
    noCaptions: z.boolean().optional().describe('可选。只与 video 一起给：写入译文之后不建字幕层（默认建）'),
    from: languageArg.optional().describe('可选。只与 file 一起给：源语言（BCP 47）；不给时由模型判断'),
    format: z.enum(['srt', 'vtt']).optional().describe('可选。只与 file 一起给：输出格式 srt 或 vtt；不给时与输入相同'),
    outDir: pathArg.optional().describe('可选。只与 file 一起给：输出目录（不存在时创建）；不给时是下载目录'),
    provider: providerArg.optional().describe('可选。文本模型的服务商；不给时用默认值'),
    model: providerArg.optional().describe('可选。文本模型；只与 provider 一起给'),
    commandId: commandIdArg.optional().describe('可选。重试同一次提交时带上同一个值，不会重复创建任务'),
  }),
  dub: z.strictObject({
    video: videoArg.describe('要配音的视频（videos_list 给出的 path 或 videoId）'),
    to: languageArg.optional().describe('目标语言（BCP 47）；给了 translation 时可以不给'),
    translation: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('可选。已有的译文（translation 文档的 documentId）；不给时先用文本模型翻译'),
    document: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('可选。源转写（speech 文档的 documentId）；视频里只有一份或给了 translation 时可以不给'),
    voice: z.string().min(1).max(200).optional().describe('可选。音色：模型的音色 ID，或用户库里的 library:<id>；不给时用模型的默认音色'),
    original: z.enum(['duck', 'mute', 'keep']).optional().describe('可选。原声怎么处理：duck 压低（默认）、mute 静音、keep 保持'),
    separateBackground: z.boolean().optional().describe('可选。先分离人声与背景声，只压低或静音人声、保留背景声'),
    provider: providerArg.optional().describe('可选。语音合成的服务商；不给时用默认值'),
    model: providerArg.optional().describe('可选。语音合成模型；只与 provider 一起给'),
    commandId: commandIdArg.optional().describe('可选。重试同一次提交时带上同一个值，不会重复创建任务'),
  }),
  transcode: z.strictObject({
    files: z.array(pathArg).min(1).max(100).describe('本机的输入文件（相对路径按工作目录解析）；merge 时按这个顺序合并'),
    merge: z.boolean().optional().describe('可选。按顺序合并成一个文件；不给 merge 与 extractAudio 时逐个压缩'),
    extractAudio: z.boolean().optional().describe('可选。逐个取出音轨（能流复制时不重新编码）；与 merge 不能同时给'),
    codec: z.enum(['h264', 'hevc']).optional().describe('可选。视频编码 h264（默认）或 hevc'),
    maxHeight: z.number().int().min(16).max(8640).optional().describe('可选。画面高度的上限（像素），例如 1080'),
    crf: z.number().int().min(0).max(51).optional().describe('可选。恒定质量（0–51，越小越清晰、文件越大）'),
    outDir: pathArg.optional().describe('可选。输出目录（不存在时创建）；不给时是下载目录。原文件不动'),
    commandId: commandIdArg.optional().describe('可选。重试同一次提交时带上同一个值，不会重复创建任务'),
  }),
};

type Name = keyof typeof schemas;
type Args<N extends Name> = z.infer<(typeof schemas)[N]>;

const JOB_NOTE =
  '立即返回 jobId：用 jobs_wait 等到 state 为 completed，结果在 pipeline.summary 与 outputs 里；失败时照 error 与 next 处理。';

const DEFINITIONS: Record<Name, ToolInfo> = {
  transcribe: {
    title: '转录',
    description: [
      '转录：转写成一份新文稿并建立字幕层，需要时先新建视频。',
      '输入三选一：video（已有视频，可给 asset）；file（本机媒体：新建视频、导入并放上时间线）；url（链接：先下载，同 download，再新建视频并转写）。给 noVideo 时不建视频，只写 TXT 与 SRT 文稿文件。',
      'video 已有这个素材的文稿时不在同一部视频里加第二份：target 缺省 new-video，在同一项目新建一部视频（链接同一份素材，名字默认「<原名> · 重新转录」）；target: replace 取代当前文稿并结转译文、字幕与配音（translations: discard 不结转译文），文稿被用户改过时以 TRANSCRIPT_EDITED 拒绝，确认要丢掉那些修改再加 acceptEdited: true。新建的视频在之后的步骤失败时保留，不要再新建一次。',
      JOB_NOTE,
      '完成时 pipeline.summary.documentId 是新转写（可以给 documents_read），summary.captions 是字幕层，新建视频时 summary.videoId 是视频；summary.target 是落点（new-video、replace、first），replace 时 summary.replaced.transactionId 可以撤销，summary.translations 写各语言保留与过期的句数。',
      '对外服务不能给 file、outDir：给 video，或给 url 与 project（新视频建在那个已登记的项目里，之后在服务的范围之内；带 noVideo 时只下载并写文稿）。',
    ].join('\n'),
    annotations: { destructiveHint: false, idempotentHint: true },
    effect: 'job',
    examples: [
      { title: '重新转录并取代当前文稿', args: { video: 'demo', target: 'replace' } },
      { title: '从本机文件新建视频并转写', args: { file: '~/Movies/talk.mp4', language: 'en' } },
      { title: '从链接新建视频并转写', args: { url: 'https://example.com/talk' } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'video',
    cliSwitches: [
      { flag: 'replace', field: 'target', value: 'replace' },
      { flag: 'discard-translations', field: 'translations', value: 'discard' },
    ],
  },
  translate: {
    title: '翻译',
    description: [
      '用配置好的文本模型翻译一份转写或字幕文件。',
      '只在用户明确要用配置好的文本模型翻译时用；默认由你自己翻译：documents_read（for: translation）→ 逐句翻译 → documents_put → captions_create。',
      'video + to：写成一份新的译文（translation 文档）并建立目标语言的字幕层（noCaptions 时不建）。file + to：把 SRT / VTT 字幕文件译成新文件，不碰视频。',
      JOB_NOTE,
      '文本模型没有配置时以 CAPABILITY_NOT_CONFIGURED 拒绝：照 next 自己翻译，不要请用户去配置。',
      '对外服务不能给 file、outDir：给 video。',
    ].join('\n'),
    annotations: { destructiveHint: false, idempotentHint: true },
    effect: 'job',
    examples: [
      { title: '把视频的转写译成中文并建字幕层', args: { video: 'demo', to: 'zh-CN' } },
      { title: '双语字幕', args: { video: 'demo', to: 'ja', bilingual: true, style: '口语、简洁' } },
      { title: '翻译字幕文件', args: { file: 'talk.srt', to: 'zh-CN' } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'video',
  },
  dub: {
    title: '翻译配音',
    description: [
      '翻译配音：缺译文时先翻译，逐句合成、对齐，放上一条新的配音轨。',
      '已有译文（例如你自己翻译、documents_put 写入的）时给 translation，不再调用文本模型；没有时给 to，由配置好的文本模型先翻译。',
      'original 决定原声：duck 压低（默认）、mute 静音、keep 保持；separateBackground 先分离人声，只处理人声。',
      JOB_NOTE,
      '完成时 pipeline.summary.trackId 是配音轨，summary.units 说明放上了几句、几句没有合成及原因。',
    ].join('\n'),
    annotations: { destructiveHint: false, idempotentHint: true },
    effect: 'job',
    examples: [
      { title: '用已有译文配音', args: { video: 'demo', translation: 'doc_zh' } },
      { title: '翻译成英文并配音，静音原声', args: { video: 'demo', to: 'en', original: 'mute', voice: 'alloy' } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'video',
  },
  transcode: {
    title: '转码',
    description: [
      '文件到文件：压缩、按顺序合并或取出音轨，不建视频、不动原文件。',
      '默认逐个压缩（codec h264 或 hevc、maxHeight、crf）；merge 按 files 的顺序合并成一个文件（参数一致时流复制）；extractAudio 逐个取出音轨。',
      JOB_NOTE,
      '完成时 outputs 的 path（pipeline.summary.files）是输出的文件：把位置告诉用户。',
    ].join('\n'),
    annotations: { destructiveHint: false, idempotentHint: true },
    effect: 'job',
    examples: [
      { title: '压缩到 1080p', args: { files: ['talk.mov'], maxHeight: 1080 } },
      { title: '按顺序合并', args: { files: ['part1.mp4', 'part2.mp4'], merge: true } },
      { title: '取出音轨', args: { files: ['talk.mp4'], extractAudio: true, outDir: 'audio' } },
    ],
    // 只有本机文件这一种输入，对外服务用不了（§6.2 不列它）。
    surfaces: ['agent', 'cli'],
    positional: 'files',
  },
};

/** 文本模型没有配置时 `translate` 的下一步：智能体自己翻译（Agent 面设计 §4.4）。 */
const SELF_TRANSLATE_NEXT =
  '文本模型没有配置，不要请用户去配置：翻译由你自己完成。documents_read（for: translation）读转写，按句子翻译，用 documents_put 写成 kind 为 translation 的新文档（sourceDocument 指向原文），再用 captions_create 把字幕层放到画面上（双语带 bilingual: true）。';
const SELF_TRANSLATE_FILE_NEXT =
  '文本模型没有配置，不要请用户去配置：字幕文件由你自己翻译。读出原文件，逐条翻译（时间码不变），写成工作目录里的新文件，把位置告诉用户。';
const SELF_TRANSLATE_DUB_NEXT =
  '文本模型没有配置，不要请用户去配置：先自己翻译——documents_read（for: translation）读转写，按句子翻译，用 documents_put 写成 kind 为 translation 的新文档——再调用 dub，带上 translation（新译文的 documentId）。';
// i18n-ignore-end

export class FlowTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #deps: FlowToolsDeps;

  constructor(deps: FlowToolsDeps) {
    this.#deps = deps;
  }

  dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    switch (name) {
      case 'transcribe':
        return this.#transcribe(args as Args<'transcribe'>, principal);
      case 'translate':
        return this.#translate(args as Args<'translate'>, principal);
      case 'dub':
        return this.#dub(args as Args<'dub'>, principal);
      case 'transcode':
        return this.#transcode(args as Args<'transcode'>, principal);
      default:
        // i18n-ignore: 给模型的工具说明、错误与下一步
        return Promise.reject(new ToolError('UNKNOWN_TOOL', `没有这个工具：${name}`));
    }
  }

  async #transcribe(args: Args<'transcribe'>, principal: ToolPrincipal) {
    const inputs = [args.video, args.file, args.url].filter((value) => value !== undefined).length;
    // i18n-ignore-start: 给模型的工具说明、错误与下一步
    if (inputs !== 1) throw new ToolError('INVALID_ARGUMENTS', '输入三选一：video、file、url 给且只给一个');
    if (args.asset !== undefined && args.video === undefined) throw new ToolError('INVALID_ARGUMENTS', 'asset 只与 video 一起给');
    if (args.video !== undefined && (args.noVideo || args.project !== undefined)) {
      throw new ToolError('INVALID_ARGUMENTS', '给 video 时转写已有视频：noVideo、project 不适用');
    }
    if (args.video === undefined && (args.target !== undefined || args.translations !== undefined || args.acceptEdited !== undefined)) {
      throw new ToolError('INVALID_ARGUMENTS', 'target、translations、acceptEdited 只与 video 一起给');
    }
    if (args.target === 'replace' && args.name !== undefined) {
      throw new ToolError('INVALID_ARGUMENTS', 'name 只用于新建视频：target: replace 时不适用');
    }
    if (args.target !== 'replace' && (args.translations !== undefined || args.acceptEdited !== undefined)) {
      throw new ToolError('INVALID_ARGUMENTS', 'translations、acceptEdited 只与 target: replace 一起给');
    }
    if (args.outDir !== undefined && !(args.file !== undefined && args.noVideo)) {
      throw new ToolError('INVALID_ARGUMENTS', 'outDir 只与 file、noVideo 一起给');
    }
    if (args.model !== undefined && args.provider === undefined) throw new ToolError('INVALID_ARGUMENTS', 'model 只与 provider 一起给');
    // i18n-ignore-end
    if (args.url !== undefined) return this.#transcribeLink(args, args.url, principal);

    const { scope } = this.#deps;
    const access = scope.authorize(principal, true);
    const recognition = {
      ...(args.language !== undefined ? { language: args.language } : {}),
      ...(args.provider !== undefined ? { provider: args.provider } : {}),
      ...(args.model !== undefined ? { model: args.model } : {}),
      ...(args.hint !== undefined ? { hint: args.hint } : {}),
      ...(args.diarize !== undefined ? { diarize: args.diarize } : {}),
    };
    if (args.video !== undefined) {
      const opened = await scope.open(args.video, access);
      const approval = await scope.confirm(access, {
        tool: 'transcribe',
        video: args.video,
        ...confirmSummary(
          args.target === 'replace'
            ? RcFlowTools.transcribeReplaceSummary({ asset: args.asset ?? null, ...providerOf(args) })
            : RcFlowTools.transcribeVideoSummary({ asset: args.asset ?? null, ...providerOf(args), captions: !args.noCaptions }),
        ),
      });
      // 工具的 `target` 就是流程参数的 `destination`（落点）。
      const jobId = await this.#start(access, TRANSCRIBE_PIPELINE, args.commandId, {
        videoId: opened.ref.videoId,
        ...(args.asset !== undefined ? { assetId: args.asset } : {}),
        ...recognition,
        captions: !args.noCaptions,
        ...(args.target !== undefined ? { destination: args.target } : {}),
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.translations !== undefined ? { translations: args.translations } : {}),
        ...(args.acceptEdited !== undefined ? { acceptEdited: args.acceptEdited } : {}),
      });
      return {
        jobId,
        ...approvalField(approval),
        // i18n-ignore: 给模型的工具说明、错误与下一步
        next: '转录已提交。用 jobs_wait 等到 completed：pipeline.summary.documentId 是新转写（可以给 documents_read），summary.captions 是字幕层。',
      };
    }

    // 本机文件：对外服务在这里以 INVALID_ARGUMENTS 拒绝（`fileBase`）。
    const base = scope.fileBase(access);
    const file = resolveUserPath(args.file as string, base);
    if (args.noVideo) {
      if (args.project !== undefined || args.name !== undefined)
        // i18n-ignore: 给模型的工具说明、错误与下一步
        throw new ToolError('INVALID_ARGUMENTS', '给 noVideo 时不建视频：project、name 不适用');
      const outDir = args.outDir !== undefined ? resolveUserPath(args.outDir, base) : undefined;
      const approval = await scope.confirm(access, {
        tool: 'transcribe',
        ...confirmSummary(RcFlowTools.transcribeFileSummary({ file, ...providerOf(args), outDir: outDir ?? null })),
      });
      const jobId = await this.#start(access, TRANSCRIBE_PIPELINE, args.commandId, {
        file,
        ...(outDir !== undefined ? { outDir } : {}),
        ...recognition,
      });
      return {
        jobId,
        ...approvalField(approval),
        // i18n-ignore: 给模型的工具说明、错误与下一步
        next: '转录已提交，不建视频。用 jobs_wait 等到 completed：outputs 的 path（pipeline.summary.files）是 TXT 与 SRT 文稿，把位置告诉用户。',
      };
    }
    await scope.createRoot(access, args.project, { locate: true });
    const approval = await scope.confirm(access, {
      tool: 'transcribe',
      ...confirmSummary(
        RcFlowTools.transcribeCreateSummary({ name: args.name ?? null, file, ...providerOf(args), captions: !args.noCaptions }),
      ),
    });
    // 确认之后才为新建做准备：无项目会话在这里建项目并绑定（§3.10），流程的 `create` 目标直接是项目。
    const root = await scope.createRoot(access, args.project);
    // 绑定把工作目录里的东西搬进了项目，旧路径在回合里经链接指过去：换成真实路径，流程之后读的是项目里的文件。
    const media = await fs.realpath(file).catch(() => file);
    const jobId = await this.#start(access, TRANSCRIBE_PIPELINE, args.commandId, {
      target: { create: { ...root.scope, ...(args.name !== undefined ? { name: args.name } : {}), media } },
      ...recognition,
      captions: !args.noCaptions,
    });
    return {
      jobId,
      ...approvalField(approval),
      // i18n-ignore: 给模型的工具说明、错误与下一步
      next: '已提交：新建视频、导入并转写。用 jobs_wait 等到 completed：pipeline.summary.videoId 是新视频（可以给 videos_inspect），summary.documentId 是新转写，summary.captions 是字幕层。新建的视频在之后的步骤失败时保留，不要再新建一次。',
    };
  }

  /**
   * `transcribe` 给 `url`：与 `download` 同一段，新建视频、转写并建字幕层（`noVideo` 时只下载并写文稿）。语言、服务与模型、提示、
   * 说话人与给 file、video 时相同，交给流程的转写一步。
   */
  #transcribeLink(args: Args<'transcribe'>, url: string, principal: ToolPrincipal) {
    if (args.noVideo && (args.name !== undefined || args.diarize !== undefined || args.noCaptions !== undefined)) {
      // i18n-ignore-start: 给模型的工具说明、错误与下一步
      throw new ToolError('INVALID_ARGUMENTS', '给 noVideo 时不建视频，只写 TXT 与 SRT 文稿：name、diarize、noCaptions 不适用', {
        next: '去掉 name、diarize、noCaptions；要新视频与字幕层时不给 noVideo。',
      });
      // i18n-ignore-end
    }
    return startLinkImport(
      this.#deps.linkImport,
      {
        url,
        ...(args.noVideo ? {} : { newVideo: true, captions: !args.noCaptions }),
        ...(args.project !== undefined ? { project: args.project } : {}),
        ...(args.name !== undefined ? { name: args.name } : {}),
        transcribe: true,
        ...(args.language !== undefined ? { language: args.language } : {}),
        ...(args.provider !== undefined ? { provider: args.provider } : {}),
        ...(args.model !== undefined ? { model: args.model } : {}),
        ...(args.hint !== undefined ? { hint: args.hint } : {}),
        ...(args.diarize !== undefined ? { diarize: args.diarize } : {}),
        ...(args.commandId !== undefined ? { commandId: args.commandId } : {}),
      },
      principal,
    );
  }

  async #translate(args: Args<'translate'>, principal: ToolPrincipal) {
    // i18n-ignore-start: 给模型的工具说明、错误与下一步
    if ((args.video === undefined) === (args.file === undefined))
      throw new ToolError('INVALID_ARGUMENTS', '输入二选一：video、file 给且只给一个');
    if (args.model !== undefined && args.provider === undefined) throw new ToolError('INVALID_ARGUMENTS', 'model 只与 provider 一起给');
    // i18n-ignore-end
    const { scope } = this.#deps;
    const access = scope.authorize(principal, true);
    const text = {
      targetLanguage: args.to,
      ...(args.style !== undefined ? { style: args.style } : {}),
      ...(args.glossary !== undefined ? { glossary: args.glossary } : {}),
      ...(args.provider !== undefined ? { provider: args.provider } : {}),
      ...(args.model !== undefined ? { model: args.model } : {}),
      ...(args.bilingual !== undefined ? { bilingual: args.bilingual } : {}),
    };
    if (args.video !== undefined) {
      // i18n-ignore-start: 给模型的工具说明、错误与下一步
      if (args.from !== undefined || args.format !== undefined || args.outDir !== undefined) {
        throw new ToolError('INVALID_ARGUMENTS', 'from、format、outDir 只与 file 一起给');
      }
      if (args.bilingual && args.noCaptions)
        throw new ToolError('INVALID_ARGUMENTS', 'bilingual 是字幕层的显示方式：要建字幕层，不能与 noCaptions 一起给');
      // i18n-ignore-end
      const opened = await scope.open(args.video, access);
      const approval = await scope.confirm(access, {
        tool: 'translate',
        video: args.video,
        ...confirmSummary(
          RcFlowTools.translateVideoSummary({
            to: args.to,
            ...providerOf(args),
            captions: !args.noCaptions,
            bilingual: args.bilingual === true,
          }),
        ),
      });
      const jobId = await this.#start(
        access,
        TRANSLATE_PIPELINE,
        args.commandId,
        {
          videoId: opened.ref.videoId,
          ...(args.document !== undefined ? { documentId: args.document } : {}),
          ...text,
          captions: !args.noCaptions,
        },
        SELF_TRANSLATE_NEXT,
      );
      return {
        jobId,
        ...approvalField(approval),
        // i18n-ignore: 给模型的工具说明、错误与下一步
        next: '翻译已提交。用 jobs_wait 等到 completed：pipeline.summary.documentId 是新译文（translation 文档），summary.captions 是字幕层；要文件时用 export。',
      };
    }
    if (args.document !== undefined || args.noCaptions !== undefined)
      // i18n-ignore: 给模型的工具说明、错误与下一步
      throw new ToolError('INVALID_ARGUMENTS', 'document、noCaptions 只与 video 一起给');
    const base = scope.fileBase(access);
    const input = resolveUserPath(args.file as string, base);
    const outDir = args.outDir !== undefined ? resolveUserPath(args.outDir, base) : undefined;
    const approval = await scope.confirm(access, {
      tool: 'translate',
      ...confirmSummary(RcFlowTools.translateFileSummary({ input, to: args.to, ...providerOf(args), outDir: outDir ?? null })),
    });
    const jobId = await this.#start(
      access,
      TRANSLATE_SUBTITLES_PIPELINE,
      args.commandId,
      {
        input,
        ...text,
        ...(args.from !== undefined ? { sourceLanguage: args.from } : {}),
        ...(args.format !== undefined ? { format: args.format } : {}),
        ...(outDir !== undefined ? { outDir } : {}),
      },
      SELF_TRANSLATE_FILE_NEXT,
    );
    return {
      jobId,
      ...approvalField(approval),
      // i18n-ignore: 给模型的工具说明、错误与下一步
      next: '翻译已提交。用 jobs_wait 等到 completed：pipeline.summary.file（outputs[0].path）是译好的字幕文件，把位置告诉用户。',
    };
  }

  async #dub(args: Args<'dub'>, principal: ToolPrincipal) {
    // i18n-ignore-start: 给模型的工具说明、错误与下一步
    if (args.to === undefined && args.translation === undefined) throw new ToolError('INVALID_ARGUMENTS', 'to 与 translation 至少给一个');
    if (args.model !== undefined && args.provider === undefined) throw new ToolError('INVALID_ARGUMENTS', 'model 只与 provider 一起给');
    // i18n-ignore-end
    const { scope } = this.#deps;
    const access = scope.authorize(principal, true);
    const opened = await scope.open(args.video, access);
    const approval = await scope.confirm(access, {
      tool: 'dub',
      video: args.video,
      ...confirmSummary(
        RcFlowTools.dubSummary({
          to: args.to ?? null,
          translation: args.translation ?? null,
          ...providerOf(args),
          voice: args.voice ?? null,
          original: args.original ?? 'duck',
        }),
      ),
    });
    const jobId = await this.#start(
      access,
      DUB_PIPELINE,
      args.commandId,
      {
        videoId: opened.ref.videoId,
        ...(args.to !== undefined ? { targetLanguage: args.to } : {}),
        ...(args.translation !== undefined ? { translationId: args.translation } : {}),
        ...(args.document !== undefined ? { documentId: args.document } : {}),
        ...(args.voice !== undefined ? { voice: args.voice } : {}),
        ...(args.provider !== undefined ? { provider: args.provider } : {}),
        ...(args.model !== undefined ? { model: args.model } : {}),
        ...(args.original !== undefined ? { originalAudio: args.original } : {}),
        ...(args.separateBackground !== undefined ? { separateBackground: args.separateBackground } : {}),
      },
      args.translation === undefined ? SELF_TRANSLATE_DUB_NEXT : undefined,
    );
    return {
      jobId,
      ...approvalField(approval),
      // i18n-ignore: 给模型的工具说明、错误与下一步
      next: '配音已提交。用 jobs_wait 等到 completed：pipeline.summary.trackId 是配音轨，summary.units 说明放上了几句、几句没有合成；要成片时用 export。',
    };
  }

  async #transcode(args: Args<'transcode'>, principal: ToolPrincipal) {
    // i18n-ignore: 给模型的工具说明、错误与下一步
    if (args.merge && args.extractAudio) throw new ToolError('INVALID_ARGUMENTS', 'merge 与 extractAudio 只能给一个');
    const { scope } = this.#deps;
    const access = scope.authorize(principal, true);
    const base = scope.fileBase(access);
    const inputs = args.files.map((file) => resolveUserPath(file, base));
    const outDir = args.outDir !== undefined ? resolveUserPath(args.outDir, base) : undefined;
    const action = args.merge ? 'merge' : args.extractAudio ? 'extract-audio' : 'compress';
    const approval = await scope.confirm(access, {
      tool: 'transcode',
      ...confirmSummary(
        RcFlowTools.transcodeSummary({
          action,
          count: inputs.length,
          files: inputs.slice(0, 3).join(RcFlowTools.listSeparator().text),
          truncated: inputs.length > 3,
          outDir: outDir ?? null,
        }),
      ),
    });
    const jobId = await this.#start(access, TRANSCODE_PIPELINE, args.commandId, {
      inputs,
      action,
      ...(args.codec !== undefined ? { codec: args.codec } : {}),
      ...(args.maxHeight !== undefined ? { maxHeight: args.maxHeight } : {}),
      ...(args.crf !== undefined ? { crf: args.crf } : {}),
      ...(outDir !== undefined ? { outDir } : {}),
    });
    return {
      jobId,
      ...approvalField(approval),
      // i18n-ignore: 给模型的工具说明、错误与下一步
      next: '转码已提交。用 jobs_wait 等到 completed：outputs 的 path（pipeline.summary.files）是输出的文件，把位置告诉用户。',
    };
  }

  /** 启动流程；文本模型没有配置时把 `next` 换成 `selfTranslate`（给了时）。 */
  async #start(
    access: ToolAccess,
    pipeline: string,
    commandId: string | undefined,
    params: Record<string, unknown>,
    selfTranslate?: string,
  ): Promise<string> {
    const { pipelines, scope } = this.#deps;
    try {
      const { jobId } = await pipelines.start(
        { pipeline, params, ...(commandId !== undefined ? { commandId: scope.commandId(access, commandId) } : {}) },
        access.submitter,
      );
      return jobId;
    } catch (error) {
      if (selfTranslate && error instanceof RpcError && isTextNotConfigured(error.details)) {
        const { code, message, ...rest } = errorBody(error);
        throw new ToolError(code, message, { ...rest, next: selfTranslate });
      }
      const mapped = toolErrorOf(error);
      if (mapped instanceof ToolError && mapped.code === 'TRANSCRIPT_EDITED') {
        // i18n-ignore-start: 给模型的工具错误与下一步
        const next =
          '用户在转录之后改过这份文稿，取代会丢掉那些修改：改用 target: new-video（缺省）另建一部视频；用户确认要丢掉修改时再加 acceptEdited: true 重新调用。';
        // i18n-ignore-end
        throw new ToolError(mapped.code, mapped.message, { ...mapped.extra, next });
      }
      throw mapped;
    }
  }
}

/** 审批摘要里的服务商与模型（没给时为 null）。 */
function providerOf(args: { provider?: string | undefined; model?: string | undefined }): { provider: string | null; model: string | null } {
  return { provider: args.provider ?? null, model: args.model ?? null };
}

function isTextNotConfigured(details: unknown): details is CapabilityNotConfiguredDetails {
  return (
    typeof details === 'object' &&
    details !== null &&
    (details as { code?: unknown }).code === 'CAPABILITY_NOT_CONFIGURED' &&
    (details as { capability?: unknown }).capability === 'generateText'
  );
}
