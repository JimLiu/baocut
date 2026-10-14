import fs from 'node:fs/promises';
import { z } from 'zod';
import {
  IMAGE_FORMATS,
  IMAGE_INPUT_MODES,
  MUSIC_MODES,
  MUSIC_PLANNINGS,
  MODEL_SERVICE_CAPABILITIES,
  SPEECH_FORMATS,
  capabilitySettingsHref,
  type CapabilityView,
  type GrantRequestItem,
  type Id,
  type ImageInputMode,
  type ModelServiceCapability,
  type RiskLevel,
} from '@baocut/protocol';
import type { GenerateImageSubmission, JobGrantHint } from '@baocut/jobs';
import { RcAgentTools } from '@baocut/protocol/messages/runtime-core';
import { outboundPurpose, type OutboundCall, type OutboundPlan } from '../grants/grant-service.ts';
import type { SpaceCatalog } from '../space-catalog.ts';
import { IMAGE_ENTRY_KINDS } from '../space/space-inputs.ts';
import { visibleEntry } from '../space/space-queries.ts';
import { spaceViewerOf } from './space-tools.ts';
import type { ModelJobs } from '../models/model-jobs.ts';
import { prepareArtifactSave } from './artifact-save.ts';
import { modelCallRisk, outboundGrantOf } from './outbound-grants.ts';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import { approvalField, confirmSummary, type ToolAccess, type ToolApprovalNote, type ToolPrincipal, type ToolScope } from './tool-scope.ts';
import { commandIdArg, videoArg } from './video-tools.ts';

/**
 * 模型工具（架构设计 §3.5、§6.2）：智能体查看模型能力、提交语音合成与图片生成、把产物存进工作目录（转写是一级动词 `transcribe`，
 * 见 `flow-tools.ts`；查看、等待、取消任务见 `job-tools.ts`）。每一次调用都回到与网关相同的
 * 进程内服务：`ModelServices` 给能力视图与选择，`JobManager` 检查、冻结并排队；工具层不另做选择或检查。
 *
 * - 提交者由范围给出：会话（`{ kind: 'agent', id: 会话 ID, taskId }`，§7.9）或对外服务的客户端（`{ kind: 'service', … }`，§4.8）；
 *   提交是写操作，规划模式与 `read` 等级下拒绝，`ask` 等级下逐次确认。
 * - 风险等级（§3.12）：本机模型是 `edit`，有授权覆盖的外发是 `command`，没有授权覆盖的外发是 `high`（审批里列出要授权的
 *   数据，允许时发放「只这一次」或持续授权，§12.5）；额度不够的直接 `BUDGET_EXCEEDED`，不进审批；
 *   `artifacts_save` 覆盖已有文件是 `high`，否则 `edit`。
 * - 视频按范围解析（与视频工具相同）。给了视频时结果导入为候选素材，不上时间线。
 * - 没给视频的结果是产物：之后用 `edits_apply` 的 `importAsset` + `artifactId` 导入视频，或用 `artifacts_save` 复制到工作目录。
 * - 工具不能启用、配置 Provider，也不能设默认值，也不能自己发放授权；没有任何工具读写密钥。启用 Provider 时发放一条默认授权
 *   （§6.8 的迁移规则），用户撤销后这个 Provider 的调用重新要审批。
 */

export interface ModelToolsDeps {
  models: ModelJobs;
  scope: ToolScope;
  /** 生图的输入图按 Space 条目给时用（§6.1）；Space 目录在工具目录之后才建好：调用时再取。 */
  space?: () => SpaceCatalog;
}

// i18n-ignore-start: 给模型的工具说明、错误与下一步
const capabilityArg = z.enum(MODEL_SERVICE_CAPABILITIES as [ModelServiceCapability, ...ModelServiceCapability[]]);
const providerArg = z
  .string()
  .min(1)
  .max(200)
  .describe('可选。Provider：local、node:<节点>、openai、google、elevenlabs、custom:<名字>、agent:codex；不给时用这种能力的默认值');
const modelArg = z.string().min(1).max(200).describe('可选。模型 ID（models_capabilities 列出的 modelId）；不给时用 Provider 的默认模型');
const outputVideoArg = videoArg.describe(
  '可选。要导入结果的视频：videos_list 给出的 path，或已经打开的视频的 videoId。给了时结果导入为候选素材（不放上时间线）；不给时只得到产物',
);
const assetNameArg = z.string().min(1).max(200).describe('可选。导入视频时的素材名');
const seedArg = z.number().int().min(0).max(4294967295).describe('可选。随机种子（模型接受 seed 时；供应商尽力复现，不保证）');

const schemas = {
  models_capabilities: z.strictObject({
    capability: capabilityArg
      .optional()
      .describe('可选。只看一种能力：transcribe、synthesizeSpeech、generateImage、generateMusic、generateText、separateAudio；省略时列出全部'),
  }),
  speak: z.strictObject({
    text: z.string().min(1).max(200_000).describe('要合成的文本；不能超过模型的 maxInputChars（models_capabilities 里）'),
    voice: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        '可选。音色 ID，或 library:<用户库的音色 ID>（只限会话里的智能体，要已在这个 Provider 上克隆）；不给时用模型的 defaultVoice（为 null 的模型必须给）',
      ),
    language: z.string().min(1).max(35).optional().describe('可选。文本的语言（BCP 47）'),
    format: z
      .enum(SPEECH_FORMATS as [string, ...string[]])
      .optional()
      .describe(`可选。音频格式：${SPEECH_FORMATS.join('、')}；不给时用模型的 defaultFormat`),
    instructions: z.string().min(1).max(2000).optional().describe('可选。语气与风格的说明；只有 acceptsInstructions 的模型接受'),
    speed: z.number().positive().max(10).optional().describe('可选。语速倍率，在模型的 speedRange 内'),
    seed: seedArg.optional(),
    provider: providerArg.optional(),
    model: modelArg.optional(),
    video: outputVideoArg.optional(),
    name: assetNameArg.optional(),
    commandId: commandIdArg.optional().describe('可选。重试同一次提交时带上同一个值，不会重复创建任务'),
  }),
  image: z.strictObject({
    prompt: z.string().min(1).max(100_000).describe('提示词；不能超过模型的 maxPromptChars'),
    size: z
      .string()
      .regex(/^(\d{1,5}x\d{1,5}|\d{1,3}:\d{1,3})$/)
      .optional()
      .describe('可选。尺寸 WIDTHxHEIGHT（模型的 sizes 之一）或宽高比 W:H（模型的 aspectRatios 之一）；不给时用 defaultSize'),
    count: z
      .number()
      .int()
      .min(1)
      .max(16)
      .optional()
      .describe('可选。张数，默认 1，不超过模型的 maxCount；imageMode 为 img2img 时张数是底图的组数，不用给'),
    format: z
      .enum(IMAGE_FORMATS as [string, ...string[]])
      .optional()
      .describe(`可选。图片格式：${IMAGE_FORMATS.join('、')}；不给时用模型的 defaultFormat`),
    images: z
      .array(
        z.union([
          z.strictObject({ entryId: z.string().min(1).max(200).describe('space_list 给出的图片条目 id（kind 为 image）') }),
          z.strictObject({ assetId: z.string().min(1).max(200).describe('video 那个视频素材库里的图片素材 id（要同时给 video）') }),
        ]),
      )
      .min(1)
      .max(64)
      .optional()
      .describe(
        '可选。输入图，按顺序：Space 的图片条目 { entryId } 或视频素材 { assetId }。张数不超过模型的 referenceImages.max；模型的 referenceImages 为 null 时不能给',
      ),
    imageMode: z
      .enum(IMAGE_INPUT_MODES as [ImageInputMode, ...ImageInputMode[]])
      .optional()
      .describe(
        '可选。输入图的用法：ref（默认）所有图一起进一次请求出图，referenceImages.edit 为 true 的模型按提示词改图，否则只作参考；img2img 以图为底按 strength 重画，只有 img2img 不为 null 的模型接受，每 img2img.max 张底图出一张',
      ),
    strength: z.number().min(0).max(1).optional().describe('可选。img2img 的改动幅度，在模型的 img2img.strength 范围内，不给时用它的 default'),
    seed: seedArg.optional(),
    provider: providerArg.optional(),
    model: modelArg.optional(),
    video: outputVideoArg.optional(),
    name: assetNameArg.optional(),
    commandId: commandIdArg.optional().describe('可选。重试同一次提交时带上同一个值，不会重复创建任务'),
  }),
  music: z.strictObject({
    mode: z.enum(MUSIC_MODES as [string, ...string[]]).describe('song 是带人声的歌曲（必须给 lyrics），instrumental 是纯音乐（不能给 lyrics）'),
    style: z.string().min(1).max(100_000).describe('风格描述（曲风、情绪、乐器、节奏、人声类型等，英文效果最稳）；不能超过模型的 maxStyleChars'),
    lyrics: z.string().min(1).max(200_000).optional().describe('歌词，只在 mode 为 song 时给；不能超过模型的 maxLyricsChars'),
    targetDurationSec: z.number().positive().max(3600).optional().describe('可选。希望的时长（秒），只是给模型的创作意图，不保证精确'),
    maxDurationSec: z
      .number()
      .positive()
      .max(3600)
      .optional()
      .describe('可选。时长上限（秒），不超过模型的 maxDurationSec；不给时取 targetDurationSec，再没有时用模型的 defaultDurationSec。到了上限的结果带 output-truncated 警告'),
    planning: z
      .enum(MUSIC_PLANNINGS as [string, ...string[]])
      .optional()
      .describe('可选。编排：off 不编排，melody 先规划旋律，full 完整规划（更慢）；只能选模型 planning.options 里的，不给时用模型默认'),
    seed: seedArg.optional(),
    provider: providerArg.optional(),
    model: modelArg.optional(),
    video: outputVideoArg.optional(),
    name: assetNameArg.optional(),
    commandId: commandIdArg.optional().describe('可选。重试同一次提交时带上同一个值，不会重复创建任务'),
  }),
  artifacts_save: z.strictObject({
    artifactId: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/)
      .describe('jobs_inspect 的 outputs 里的 artifactId（转写是 result.artifactId）'),
    path: z.string().min(1).max(1000).describe('工作目录里的文件路径（相对工作目录）；省略扩展名时补上产物的扩展名'),
    overwrite: z.boolean().optional().describe('可选。目标文件已经存在时是否替换，默认 false（存在就拒绝）'),
  }),
};

type ToolName = keyof typeof schemas;
type Args<N extends ToolName> = z.infer<(typeof schemas)[N]>;

const ARTIFACT_RULES =
  '不给 video 时只得到产物（artifactId）：之后要放进视频，用 edits_apply 的 {"type":"importAsset","artifactId":…}（不会重新生成）；需要文件本身时用 artifacts_save 复制到工作目录。';

const SUBMIT_RULES = [
  '立即返回 jobId，计算在后台进行：之后用 jobs_wait 等它结束（看进度用 jobs_inspect），state 为 completed 才算完成。',
  'provider 与 model 可选，不给时用这种能力的默认值；先用 models_capabilities 看有哪些可用、限制是多少。',
  '能力没有配置时返回 CAPABILITY_NOT_CONFIGURED：照 next 的说明转告用户，不要换办法绕过。',
].join('\n');

const DEFINITIONS: Record<ToolName, ToolInfo> = {
  models_capabilities: {
    title: '查看模型能力',
    description: [
      '列出每种模型能力可用的 Provider、模型、限制与默认值。',
      '能力有转写（transcribe）、语音合成（synthesizeSpeech）、图片生成（generateImage）、音乐生成（generateMusic）、文本生成（generateText）、人声与背景分离（separateAudio）六种：各 Provider 与模型、是否可用及原因、限制（文本长度、尺寸、张数、音色、格式、时长、上下文与输出上限、推理强度）、默认值。',
      'generateMusic 只在本机（audio.cpp 引擎加本地模型包），生成很慢（几分钟到十几分钟），用 music 提交。',
      'separateAudio 只在本机，由翻译配音的「分离背景声」使用，没有对应的提交工具。',
      '本机语义检索（文本嵌入模型包）不在这里：能不能按意思检索、视频的索引建好没有，用 space_index_status 看；装没装模型包用 models_list。',
      'generateText 是工具页与 CLI 启动的固定流程（翻译、润色等）调用的文本模型，没有对应的提交工具：会话里的翻译、润色、总结由你自己完成，它没有配置也不影响你做，你也不能经它调用别的模型。',
      'effective 是不指定 provider 时实际会用的；为 null 时不指定 provider 的调用会以 CAPABILITY_NOT_CONFIGURED 拒绝。',
      '只读。启用、配置服务与设默认值由用户在设置里完成，你不能代做。',
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [
      { title: '列出全部能力', args: {} },
      { title: '只看转写', args: { capability: 'transcribe' } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
  },
  speak: {
    title: '合成语音',
    description: [
      '把一段文本合成为语音。',
      '文本超过模型的 maxInputChars 时在提交时以 INPUT_TOO_LONG 拒绝（带 limit）：自己按句子或段落切开，逐段提交，Runtime 不截断。',
      '给了 video 时，完成后音频导入为那个视频的候选素材（jobs_inspect 给出 assetId），不会放上时间线；要用时再 edits_apply 的 addItem。',
      ARTIFACT_RULES,
      SUBMIT_RULES,
    ].join('\n'),
    effect: 'job',
    examples: [
      { title: '合成一句旁白', args: { text: '欢迎来到今天的节目。' } },
      { title: '合成并导入视频', args: { text: 'Welcome back.', language: 'en', video: 'demo', name: '开场旁白' } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'text',
  },
  image: {
    title: '生成图片',
    description: [
      '按提示词生成图片。',
      '尺寸、张数、格式要在模型声明的范围内，提示词不能超过 maxPromptChars。',
      '输入图（images）先用 models_capabilities 看模型的 referenceImages（张数上限、edit 是否按提示词改图）与 img2img（以图为底重画、strength 范围）；Space 里的图用 space_list 找 kind 为 image 的条目，视频素材库的图给 assetId 并同时给 video。不接受本机路径。',
      '用户没点名模型时不给 provider 与 model：用用户设的默认，没设时按出厂顺序取第一个能用的（ChatGPT 订阅登录的 Codex › 本机模型 › OpenAI › Google Gemini › 其余已连接的服务）。用户点名了服务或模型才照着给。',
      '给了 video 时，完成后每张图片导入为那个视频的候选素材（jobs_inspect 给出 assetId），不会放上时间线；要用时再 edits_apply 的 addItem。',
      ARTIFACT_RULES,
      SUBMIT_RULES,
    ].join('\n'),
    effect: 'job',
    examples: [
      { title: '生成一张封面', args: { prompt: '夕阳下的海边小镇，水彩风格' } },
      { title: '按宽高比生成两张并导入视频', args: { prompt: 'a minimalist title card', size: '16:9', count: 2, video: 'demo' } },
      { title: '按提示词改一张 Space 里的图', args: { prompt: '把背景换成雪山', images: [{ entryId: 'ent_1' }] } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'prompt',
  },
  music: {
    title: '生成音乐',
    description: [
      '按风格描述（与可选的歌词）生成一段音乐：配乐、片头曲、带人声的歌曲。',
      '只有本机的模型（audio.cpp 引擎加本地模型包），生成一段要几分钟到十几分钟：提交后用 jobs_wait 等，不要重复提交。先用 models_capabilities 看 generateMusic 有没有可用的模型、时长上限与编排选项。',
      '给视频做配乐时：maxDurationSec 按要配的片段长度给（可以略长，之后在时间线上裁），mode 用 instrumental，风格里写清情绪、节奏与乐器。',
      '给了 video 时，完成后音频导入为那个视频的候选素材（jobs_inspect 给出 assetId），不会放上时间线；要用时再 edits_apply 的 addItem。',
      ARTIFACT_RULES,
      SUBMIT_RULES,
    ].join('\n'),
    effect: 'job',
    examples: [
      { title: '给视频配一段背景音乐', args: { mode: 'instrumental', style: 'warm acoustic guitar, gentle, hopeful, 90 bpm', maxDurationSec: 60, video: 'demo' } },
      { title: '生成一首歌', args: { mode: 'song', style: 'upbeat pop, female vocal, bright synths', lyrics: '[verse]\nMorning light on the city street\n[chorus]\nWe keep on running', planning: 'melody' } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'style',
  },
  artifacts_save: {
    title: '保存产物到工作目录',
    description: [
      '把一个产物复制成工作目录里的一个文件。',
      '产物是生成的音频或图片，或转写结果 JSON；供你自己读取或交给别的命令处理。',
      '只用于你需要文件本身的时候；要放进视频不用先保存，直接 edits_apply 的 importAsset + artifactId。',
      '只能用这个会话看得到的任务的产物（与 jobs_inspect 相同）。path 相对工作目录，不能用 .. 或符号链接写到外面，也不能写进视频目录；已有同名文件时拒绝，确实要替换才带 overwrite: true。',
    ].join('\n'),
    effect: 'mutation',
    examples: [
      {
        title: '把生成的旁白存成文件',
        args: { artifactId: 'sha256:abababababababababababababababababababababababababababababababab', path: 'narration' },
      },
    ],
    // 对外服务没有工作目录：设计 §6.2 的补进清单没有它，先不在 MCP 面。
    surfaces: ['agent', 'cli'],
  },
};
// i18n-ignore-end

export class ModelTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #models: ModelJobs;
  readonly #scope: ToolScope;

  readonly #space: (() => SpaceCatalog) | undefined;

  constructor(deps: ModelToolsDeps) {
    this.#models = deps.models;
    this.#scope = deps.scope;
    this.#space = deps.space;
  }

  dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    switch (name as ToolName) {
      case 'models_capabilities':
        return this.#capabilities(args as Args<'models_capabilities'>, principal);
      case 'speak':
        return this.#synthesizeSpeech(args as Args<'speak'>, principal);
      case 'image':
        return this.#generateImage(args as Args<'image'>, principal);
      case 'music':
        return this.#generateMusic(args as Args<'music'>, principal);
      case 'artifacts_save':
        return this.#save(args as Args<'artifacts_save'>, principal);
    }
  }

  // ---- 能力 ----

  async #capabilities(args: Args<'models_capabilities'>, principal: ToolPrincipal) {
    this.#scope.authorize(principal, false);
    const view = await this.#models.services.capabilities();
    const capabilities = args.capability ? [args.capability] : MODEL_SERVICE_CAPABILITIES;
    return { capabilities: capabilities.map((capability) => digestCapability(capability, view[capability])) };
  }

  // ---- 提交 ----

  async #synthesizeSpeech(args: Args<'speak'>, principal: ToolPrincipal) {
    const access = this.#scope.authorize(principal, true);
    const videoId = args.video !== undefined ? (await this.#scope.open(args.video, access)).ref.videoId : undefined;
    const chars = [...args.text].length;
    const plan = await this.#plan(access, {
      capability: 'synthesizeSpeech',
      providerId: args.provider,
      modelId: args.model,
      videoId: videoId ?? null,
      quantity: { chars },
      ...outboundPurpose(RcAgentTools.speechPurpose({ chars })),
    });
    const approval = await this.#scope.confirm(access, {
      tool: 'speak',
      ...(args.video !== undefined ? { video: args.video } : {}),
      ...confirmSummary(RcAgentTools.speechSummary({ chars, provider: args.provider ?? null, voice: args.voice ?? null })),
      ...this.#risk(plan),
    });
    const hint = this.#grantHint(plan, approval, access);
    const { video: _, format, commandId, ...rest } = args;
    const { jobId } = await this.#models.grants.submitWith(hint, () =>
      this.#models.jobs.submitSynthesizeSpeech(
        {
          ...optional(rest),
          ...optional({
            format: format as (typeof SPEECH_FORMATS)[number] | undefined,
            videoId,
            commandId: this.#commandId(access, commandId),
          }),
          text: args.text,
        },
        access.submitter,
        hint,
      ),
    );
    return { ...this.#submitted(jobId), ...approvalField(approval) };
  }

  async #generateImage(args: Args<'image'>, principal: ToolPrincipal) {
    const access = this.#scope.authorize(principal, true);
    const videoId = args.video !== undefined ? (await this.#scope.open(args.video, access)).ref.videoId : undefined;
    const images = this.#imageInputs(args.images, principal);
    // 以图为底重画时张数是底图的组数，选定模型之前不知道：按底图张数（上限）估计额度。
    const count = args.imageMode === 'img2img' ? (images?.length ?? 1) : (args.count ?? 1);
    const prompt = clip(args.prompt, 40);
    const plan = await this.#plan(access, {
      capability: 'generateImage',
      providerId: args.provider,
      modelId: args.model,
      videoId: videoId ?? null,
      quantity: { count },
      ...outboundPurpose(
        images ? RcAgentTools.imageInputsPurpose({ prompt, inputs: images.length }) : RcAgentTools.imagePurpose({ prompt }),
      ),
    });
    const approval = await this.#scope.confirm(access, {
      tool: 'image',
      ...(args.video !== undefined ? { video: args.video } : {}),
      ...confirmSummary(
        RcAgentTools.imageSummary({
          count,
          size: args.size ?? null,
          provider: args.provider ?? null,
          prompt: clip(args.prompt, 80),
        }),
      ),
      ...this.#risk(plan),
    });
    const hint = this.#grantHint(plan, approval, access);
    const { video: _, format, commandId, images: _images, ...rest } = args;
    const { jobId } = await this.#models.grants.submitWith(hint, () =>
      this.#models.jobs.submitGenerateImage(
        {
          ...optional(rest),
          ...optional({
            format: format as (typeof IMAGE_FORMATS)[number] | undefined,
            videoId,
            images,
            commandId: this.#commandId(access, commandId),
          }),
          prompt: args.prompt,
        },
        access.submitter,
        hint,
      ),
    );
    return { ...this.#submitted(jobId), ...approvalField(approval) };
  }

  async #generateMusic(args: Args<'music'>, principal: ToolPrincipal) {
    const access = this.#scope.authorize(principal, true);
    const videoId = args.video !== undefined ? (await this.#scope.open(args.video, access)).ref.videoId : undefined;
    const plan = await this.#plan(access, {
      capability: 'generateMusic',
      providerId: args.provider,
      modelId: args.model,
      videoId: videoId ?? null,
      quantity: {},
      ...outboundPurpose(RcAgentTools.musicPurpose({ style: clip(args.style, 40) })),
    });
    const approval = await this.#scope.confirm(access, {
      tool: 'music',
      ...(args.video !== undefined ? { video: args.video } : {}),
      ...confirmSummary(
        RcAgentTools.musicSummary({
          mode: args.mode,
          seconds: args.maxDurationSec ?? args.targetDurationSec ?? null,
          provider: args.provider ?? null,
          style: clip(args.style, 80),
        }),
      ),
      ...this.#risk(plan),
    });
    const hint = this.#grantHint(plan, approval, access);
    const { video: _, mode, planning, commandId, ...rest } = args;
    const { jobId } = await this.#models.grants.submitWith(hint, () =>
      this.#models.jobs.submitGenerateMusic(
        {
          ...optional(rest),
          ...optional({
            planning: planning as (typeof MUSIC_PLANNINGS)[number] | undefined,
            videoId,
            commandId: this.#commandId(access, commandId),
          }),
          mode: mode as (typeof MUSIC_MODES)[number],
          style: args.style,
        },
        access.submitter,
        hint,
      ),
    );
    return { ...this.#submitted(jobId), ...approvalField(approval) };
  }

  /**
   * 输入图的 Space 条目按调用方能看到的范围换成文件（§6.1、§7.9）：看不到的与不在一样（`not-found`），回收站里的、不是图片的
   * 按 `SpaceCatalog.resolveFile` 拒绝。素材 `{ assetId }` 原样交给任务层，在 `video` 的素材库里取。
   */
  #imageInputs(inputs: Args<'image'>['images'], principal: ToolPrincipal): GenerateImageSubmission['images'] {
    if (!inputs) return undefined;
    return inputs.map((input) => {
      if ('assetId' in input) return { assetId: input.assetId };
      if (!this.#space) throw new ToolError('UNAVAILABLE', RcAgentTools.imageInputsSpaceUnavailable().text);
      const space = this.#space();
      visibleEntry(space, spaceViewerOf(this.#scope, this.#models.jobs, principal), input.entryId);
      const { entry, file } = space.resolveFile(input.entryId, IMAGE_ENTRY_KINDS);
      return { entryId: input.entryId, file, name: entry.fileName || entry.name };
    });
  }

  /**
   * 这次调用的外发判断（§12.5）：交给谁、有没有授权覆盖、额度够不够。先按探测重算一次能力视图（与提交时的选择一致）；
   * 额度不够时抛 `BUDGET_EXCEEDED`，不进审批。
   */
  async #plan(access: ToolAccess, call: Omit<OutboundCall, 'taskId'>): Promise<OutboundPlan> {
    await this.#models.services.capabilities();
    return this.#models.grants.plan({ ...call, taskId: taskOf(access) });
  }

  /** 确认的风险等级（§3.12）与要授权的数据：没有授权覆盖的外发是 `high`，审批里列出它。 */
  #risk(plan: OutboundPlan): { risk: RiskLevel; grants?: GrantRequestItem[] } {
    const risk = modelCallRisk(outboundGrantOf(plan));
    return plan.status === 'approval' ? { risk, grants: [plan.item] } : { risk };
  }

  /**
   * 审批允许之后发放授权（「只这一次」的，或用户选的持续授权），提交时点名使用它。确认没有带回选择时（不会出现在允许的外发上）
   * 不发放：提交时以 `GRANT_REQUIRED` 拒绝。
   */
  #grantHint(plan: OutboundPlan, approval: ToolApprovalNote | void, access: ToolAccess): JobGrantHint | undefined {
    if (plan.status !== 'approval' || !approval?.grant) return undefined;
    const grant = this.#models.grants.issueForApproval(plan.item, approval.grant, { approvalId: null, taskId: taskOf(access) });
    return { grantId: grant.grantId };
  }

  /** 调用方给的幂等键换成提交用的（对外服务按客户端隔开）；没给时不去重。 */
  #commandId(access: ToolAccess, given: string | undefined): string | undefined {
    return given === undefined ? undefined : this.#scope.commandId(access, given);
  }

  /** 提交的回执：任务号与冻结的选择。 */
  #submitted(jobId: Id) {
    const record = this.#models.jobs.inspect(jobId);
    return {
      jobId,
      kind: record.kind,
      state: record.state,
      providerId: record.providerId,
      modelId: record.modelId,
      videoId: record.videoId,
      // i18n-ignore: 给模型的工具说明、错误与下一步
      next: '任务已提交。用 jobs_wait 等它结束（看进度用 jobs_inspect），state 为 completed 才算完成；不要重复提交同一件事。',
    };
  }

  // ---- 产物 ----

  /**
   * 把产物复制到工作目录（只写这一个文件，见 `prepareArtifactSave`）。路径先检查完（不合法的不生成审批），
   * 覆盖已有文件是 `high`，否则 `edit`，确认之后才写。
   */
  async #save(args: Args<'artifacts_save'>, principal: ToolPrincipal) {
    const access = this.#scope.authorize(principal, true);
    const { record, output, file: source } = await this.#scope.visibleArtifact(args.artifactId, access);
    const plan = await prepareArtifactSave({
      source,
      root: this.#scope.saveRoot(access),
      target: args.path,
      overwrite: args.overwrite ?? false,
    });
    const approval = await this.#scope.confirm(access, {
      tool: 'artifacts_save',
      targets: [plan.relPath],
      ...confirmSummary(
        (plan.exists ? RcAgentTools.overwriteArtifactSummary : RcAgentTools.saveArtifactSummary)({ artifactId: args.artifactId, path: plan.relPath }),
      ),
      risk: plan.exists ? 'high' : 'edit',
    });
    const saved = await plan.commit();
    const { size } = await fs.stat(source);
    return {
      artifactId: args.artifactId,
      jobId: record.jobId,
      path: saved.relPath,
      mediaType: output?.mediaType ?? 'application/json',
      byteLength: size,
      overwritten: saved.overwritten,
      ...approvalField(approval),
      // i18n-ignore: 给模型的工具说明、错误与下一步
      next: '文件已写到工作目录（path 相对工作目录）。它只是一份副本：要放进视频仍然用 edits_apply 的 importAsset + artifactId。',
    };
  }
}

/** 会话里的调用属于哪个任务（任务内的授权只覆盖它）。 */
function taskOf(access: ToolAccess): Id | null {
  return access.submitter.kind === 'agent' ? access.submitter.taskId : null;
}

/** 摘要里的长文本只取开头。 */
function clip(text: string, max: number): string {
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('');
}

/** 去掉值为 undefined 的键（请求类型用的是可选属性，不接受显式的 undefined）。 */
function optional<T extends Record<string, unknown>>(values: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };
}

/** 一种能力的视图，给模型看的精简版：不含端点地址与配置细节，密钥本来就不在视图里。 */
function digestCapability(capability: ModelServiceCapability, view: CapabilityView) {
  const providers = view.providers.map((p) => ({
    providerId: p.providerId,
    kind: p.kind,
    label: p.label,
    available: p.available,
    ...(p.unavailableReason ? { unavailableReason: p.unavailableReason } : {}),
    ...(p.detail ? { detail: p.detail } : {}),
    // 在线与智能体 Provider：是否已由用户启用（启用即同意把数据交给它，§6.8、§6.9）。模型的 notes 与 cost 原样带上。
    ...(p.config ? { enabled: p.config.enabled } : {}),
    models: p.models.map((m) => structuredClone(m)),
  }));
  const usable = providers.filter((p) => p.available).map((p) => p.providerId);
  return {
    capability,
    settingsHref: capabilitySettingsHref(capability),
    default: view.default,
    effective: view.effective,
    usableProviders: usable,
    providers,
    ...(view.parameters ? { parameters: view.parameters } : {}),
    // i18n-ignore-start: 给模型的工具说明、错误与下一步
    next:
      capability === 'generateText'
        ? '这是工具页与 CLI 的固定流程用的文本模型：会话里的翻译、润色、总结、写稿由你自己完成，不需要它，没有配置也不要请用户去配置。'
        : capability === 'separateAudio'
          ? view.effective !== null
            ? `翻译配音分离背景声时用本机的 ${view.effective.modelId}。`
            : '本机没有可用的分离模型包：翻译配音要求分离时跳过这一步。需要时请用户在设置的「模型 › 音源分离」里安装，用 settingsHref 写成 Markdown 设置链接。'
          : view.effective !== null
            ? `不指定 provider 时用 ${view.effective.providerId} 的 ${view.effective.modelId}。`
            : usable.length > 0
              ? `没有可用的默认值：调用时显式给出 provider（${usable.join('、')}），或请用户在设置里设默认值，用 settingsHref 写成 Markdown 设置链接。`
              : '没有可用的服务：这种能力现在不能用。告诉用户需要在设置里的模型配置中启用并配置一个服务，用 settingsHref 写成 Markdown 设置链接，链接文字用用户的语言说明对应能力；不要用别的办法绕过。',
    // i18n-ignore-end
  };
}
