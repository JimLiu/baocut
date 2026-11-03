import path from 'node:path';
import { z } from 'zod';
import { SEPARATE_AUDIO_PIPELINE, footageExecutorLabel, footageTools, type PipelineRunner } from '@baocut/jobs';
import {
  FOOTAGE_COLOR_METHODS,
  FOOTAGE_INTERPOLATE_MODES,
  FOOTAGE_MATTE_MODELS,
  FOOTAGE_OPS,
  FOOTAGE_PIPELINE_NAMES,
  FOOTAGE_STRENGTHS,
  FOOTAGE_UPSCALE_MODELS,
  SEPARATE_AUDIO_STEMS,
  type FootageOp,
} from '@baocut/protocol';
import { JobsFootage } from '@baocut/protocol/messages/jobs/footage.ts';
import { RcAgentTools } from '@baocut/protocol/messages/runtime-core';
import type { ExternalToolService } from '../external-tools/external-tool-service.ts';
import type { VideoService } from '../videos/video-service.ts';
import { installStep } from './image-tools.ts';
import { toolErrorOf } from './link-import-tools.ts';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import { approvalField, confirmSummary, type ToolAccess, type ToolPrincipal, type ToolScope } from './tool-scope.ts';
import { resolveUserPath } from './video-digest.ts';
import { commandIdArg, videoArg } from './video-tools.ts';

/**
 * 素材的本机处理（架构设计 §7.9、§12.9）：`assets_process` 启动五条流程之一（去抖、视频超分、插帧、对齐颜色、抠像），`assets_separate` 启动
 * `separate-audio`。文件到文件：输出写到 `outDir`（不给时是保存位置），不动原文件，也不改视频；要放进视频时用 `assets_import`。
 *
 * - 输入是文件路径，或视频里的素材（`video` + `assets`，Runtime 换成素材的文件）。
 * - 要的受管工具没装：按 `external_tools_install`（`high`）确认、提交安装并返回安装任务号（同 `upscale`），装好之后智能体再调用一次。
 * - 对外服务不能用：路径是本机的，安装第三方程序由用户在 BaoCut 里决定。
 */

export interface FootageToolsDeps {
  tools: ExternalToolService;
  pipelines: PipelineRunner;
  videos: VideoService;
  /** 不给 `outDir` 时的保存位置（与流程一样）；只用来写进确认的摘要。 */
  saveDirectory: () => string;
  /** 分轨用哪个模型（同流程启动时的选择）；确认前先选定，确认卡写出它。没有可用的模型时抛 `CAPABILITY_NOT_CONFIGURED`。 */
  separationModel: (model?: string) => Promise<{ providerId: string; modelId: string }>;
  scope: ToolScope;
}

// i18n-ignore-start: 给模型的工具说明、错误与下一步
const inputArgs = {
  files: z
    .array(z.string().min(1).max(4000))
    .min(1)
    .max(20)
    .optional()
    .describe('输入文件，相对路径按工作目录（终端里是当前目录），~/ 是主目录。与 video + assets 二选一'),
  video: videoArg.optional().describe('或者用视频里的素材：视频（路径或 videoId），与 assets 一起给'),
  assets: z.array(z.string().min(1).max(200)).min(1).max(20).optional().describe('素材 ID（videos_inspect 的 assets 里有）'),
};

const schemas = {
  assets_process: z.strictObject({
    op: z
      .enum(FOOTAGE_OPS)
      .describe('stabilize：去抖；upscale：视频超分；interpolate：插帧（慢动作或提高帧率）；match-color：把颜色对齐到一张参考；remove-background：抠出主体'),
    ...inputArgs,
    start: z.number().min(0).optional().describe('可选。只处理源文件里从这一秒开始的一段；图片不收'),
    end: z.number().min(0).optional().describe('可选。只处理到这一秒。超分、插帧、抠像按帧算，很慢：只处理时间线上真正用到的那一段'),
    strength: z.enum(FOOTAGE_STRENGTHS).optional().describe('stabilize：low、medium（默认）、high；越强裁掉的画面越多'),
    scale: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional().describe('upscale：放大倍数，默认 2。输出的边长不能超过 7680 像素'),
    model: z.enum(FOOTAGE_UPSCALE_MODELS).optional().describe('upscale：video（默认，给视频做的轻量模型，快）；photo（实拍，慢得多）；anime（动画，慢得多）'),
    factor: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(8)]).optional().describe('interpolate：倍数，默认 2'),
    mode: z.enum(FOOTAGE_INTERPOLATE_MODES).optional().describe('interpolate：slowmo（默认，帧率不变、时长乘倍数、不带声音）；smooth（时长不变、帧率乘倍数、带声音）'),
    reference: z.string().min(1).max(4000).optional().describe('match-color 必填：参考（图片或视频）。一组镜头都对齐到同一张参考，就统一了色调'),
    referenceAt: z.number().min(0).optional().describe('match-color：参考是视频时取哪一秒，默认中点'),
    method: z
      .enum(FOOTAGE_COLOR_METHODS)
      .optional()
      .describe('match-color：hm-mkl-hm（默认，多数情况最好）；mkl（只对齐均值与协方差，最不容易出色块）；reinhard（只对齐均值与方差，最温和）；histogram（逐通道对齐分布，容易偏色）'),
    amount: z.number().min(0).max(1).optional().describe('match-color：和原色的混合比例，默认 1；效果过头时给 0.5–0.8'),
    matteModel: z
      .enum(FOOTAGE_MATTE_MODELS)
      .optional()
      .describe('remove-background：fast（默认，每帧约 0.25 秒，Apache-2.0）；general（通常更干净、慢约 4 倍，要另下 180 MB；权重的训练集只许可非商业用途，用户要商用时别选）'),
    temporal: z.number().min(0).max(0.95).optional().describe('remove-background：和上一帧混合的比例，压住边缘闪烁，默认 0.3；图片不用'),
    outDir: z.string().min(1).max(4000).optional().describe('可选。输出目录（不存在时创建）；不给时是保存位置（设置 downloads.directory，默认系统的下载文件夹）'),
    commandId: commandIdArg.optional().describe('可选。重试同一次提交时带上同一个值，不会重复创建任务'),
  }),
  assets_separate: z.strictObject({
    ...inputArgs,
    stems: z.enum(SEPARATE_AUDIO_STEMS).optional().describe('vocals（默认）：人声与伴奏两轨；four：人声、鼓、贝斯、其他四轨，另加伴奏（只有 HTDemucs 系的模型收）'),
    model: z.string().min(1).max(200).optional().describe('可选。分离模型包的 ID（models_capabilities 的 separateAudio 里有）；不给时用默认值'),
    outDir: z.string().min(1).max(4000).optional().describe('可选。输出目录（不存在时创建）；不给时是保存位置'),
    commandId: commandIdArg.optional().describe('可选。重试同一次提交时带上同一个值，不会重复创建任务'),
  }),
};

type FootageArgs = z.infer<(typeof schemas)['assets_process']>;
type SeparateArgs = z.infer<(typeof schemas)['assets_separate']>;

/** 每种处理收的参数：给了别的直接拒绝，免得用户同意了再失败。 */
const OP_ARGS: Readonly<Record<FootageOp, readonly (keyof FootageArgs)[]>> = {
  stabilize: ['strength'],
  upscale: ['scale', 'model'],
  interpolate: ['factor', 'mode'],
  'match-color': ['reference', 'referenceAt', 'method', 'amount'],
  'remove-background': ['matteModel', 'temporal'],
};

const OP_LABELS: Readonly<Record<FootageOp, () => { text: string }>> = {
  stabilize: () => JobsFootage.stabilizeLabel(),
  upscale: () => JobsFootage.upscaleLabel(),
  interpolate: () => JobsFootage.interpolateLabel(),
  'match-color': () => JobsFootage.matchColorLabel(),
  'remove-background': () => JobsFootage.removeBackgroundLabel(),
};

const DEFINITIONS: Record<'assets_process' | 'assets_separate', ToolInfo> = {
  assets_process: {
    title: '处理素材',
    description: [
      '在这台电脑上给素材去抖、超分、插帧、统一色调或抠出主体，每个输入写成一个新文件。',
      '文件到文件：不动原文件、不改视频；要放进视频时用 assets_import。op 是 stabilize（去抖）、upscale（视频超分）、interpolate（插帧）、match-color（统一色调）或 remove-background（抠出主体）。',
      'stabilize 用 ffmpeg：带 libvidstab 时走 vid.stab 的两遍；没有时退回 deshake，只修小幅的平移抖动，结果的 summary.warnings 与 executor.engine 会说明，要转告用户。输出 <原名>-stabilized.mp4。',
      'upscale 用 Real-ESRGAN，输出 <原名>-upscaled-<倍数>x.mp4，声音照搬。超分是估计，不能找回真实细节，文字、人脸可能变形。',
      'interpolate 用 RIFE（rife-v4.6）。slowmo 帧率不变、时长乘倍数、不带声音，输出 <原名>-slowmo-<倍数>x.mp4；smooth 时长不变、帧率乘倍数，输出 <原名>-smooth-<倍数>x.mp4。跨硬切的两帧会被插出重影：先用 videos_shots 找到切点，按镜头分别处理（start、end）。',
      'match-color 把每个输入的颜色分布对齐到 reference，烘成 3D LUT 作用到整段，输出 <原名>-color-matched.mp4（图片是 .png）。一个文件里有几个镜头时按镜头分别处理，否则取样会把几个镜头混在一起。这是烧进新文件的处理，不是时间线上可调的效果。',
      'remove-background 逐帧抠出主体（rembg 发布的 U²-Net、IS-Net 权重，只在 CPU 上推理），视频输出带透明的 ProRes 4444 MOV（<原名>-cutout.mov，文件很大），图片输出 PNG。不用绿幕，但只认显著的主体；summary.items[].coverage 接近 0 时是没认出主体。matteModel general 的权重要另外下载，它的训练集只许可非商业用途。',
      '超分、插帧、抠像按帧处理，长素材要很久：先告诉用户大约多少帧，并用 start、end 只处理真正用到的一段。HDR 素材拒绝（FOOTAGE_HDR_UNSUPPORTED）。',
      '会按访问模式向用户确认；要的工具或权重包没有安装时会请用户同意下载（显示来源、版本、大小与许可），这次只提交安装并返回 installJobId：用 jobs_wait 等它 completed，再调用一次本工具。',
      '立即返回 jobId。用 jobs_wait 等它结束；state 为 completed 时 outputs[].path 是新文件。失败时 error.code 是 FOOTAGE_TOOL_FAILED、FOOTAGE_RANGE_EMPTY、FOOTAGE_TOO_LONG、FOOTAGE_OUTPUT_TOO_LARGE、FOOTAGE_HDR_UNSUPPORTED、INPUT_UNREADABLE 等；不要自己运行这些程序绕过。',
    ].join('\n'),
    annotations: { destructiveHint: false, idempotentHint: true },
    effect: 'job',
    examples: [
      { title: '给手持镜头去抖', args: { op: 'stabilize', files: ['clips/walk.mp4'], strength: 'high' } },
      { title: '把一段放大 2 倍', args: { op: 'upscale', files: ['old/1998.mp4'], scale: 2, start: 12, end: 20 } },
      { title: '做 4 倍慢动作', args: { op: 'interpolate', files: ['clips/jump.mp4'], factor: 4, mode: 'slowmo' } },
    ],
    surfaces: ['agent', 'cli'],
  },
  assets_separate: {
    title: '音频分轨',
    description: [
      '用本机的分离模型把音频或视频文件的第一条音轨拆成几轨 WAV。',
      '文件到文件，不动原文件、不改视频；要放进视频时用 assets_import。分离模型是 HTDemucs 系。',
      'stems vocals（默认）出人声与伴奏（<原名>-vocals.wav、-background.wav）；four 另出鼓、贝斯、其他（-drums.wav、-bass.wav、-other.wav）。用来给配乐让人声、取伴奏、取人声重新混音、按鼓点剪辑（对 -drums.wav 用 assets_analyze 比混音更准）。翻译配音已经自带分离，不用先分轨。',
      '会按访问模式向用户确认。没有分离模型时以 CAPABILITY_NOT_CONFIGURED 拒绝，可以用 models_install 下载。stems four 而模型只能分两轨时以 SEPARATION_STEMS_UNSUPPORTED 拒绝。',
      '立即返回 jobId。用 jobs_wait 等它结束；state 为 completed 时 outputs[].path 是各轨的 WAV，summary.items[].files 按轨列出。',
    ].join('\n'),
    annotations: { destructiveHint: false, idempotentHint: true },
    effect: 'job',
    examples: [
      { title: '把一首歌拆成四轨', args: { files: ['music/theme.mp3'], stems: 'four' } },
      { title: '从视频的素材里取出人声', args: { video: 'demo', assets: ['asset_01J…'] } },
    ],
    surfaces: ['agent', 'cli'],
  },
};
// i18n-ignore-end

export class FootageTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #deps: FootageToolsDeps;

  constructor(deps: FootageToolsDeps) {
    this.#deps = deps;
  }

  dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    const run =
      name === 'assets_process'
        ? footage(this.#deps, args as FootageArgs, principal)
        : name === 'assets_separate'
          ? separateAudio(this.#deps, args as SeparateArgs, principal)
          : Promise.reject(new ToolError('UNKNOWN_TOOL', `Unknown tool: ${name}`));
    return run.catch((error: unknown) => {
      throw toolErrorOf(error);
    });
  }
}

/** 输入换成绝对路径：文件按范围的文件基准解析，素材换成视频里它的文件。 */
async function resolveInputs(deps: FootageToolsDeps, access: ToolAccess, args: { files?: string[] | undefined; video?: string | undefined; assets?: string[] | undefined }): Promise<string[]> {
  const { scope, videos } = deps;
  if ((args.files === undefined) === (args.assets === undefined)) throw new ToolError('INVALID_ARGUMENTS', 'Give exactly one of files or video + assets');
  if (args.assets === undefined) {
    if (args.video !== undefined) throw new ToolError('INVALID_ARGUMENTS', 'video goes with assets, not files');
    const base = scope.fileBase(access);
    return args.files!.map((file) => resolveUserPath(file, base));
  }
  if (args.video === undefined) throw new ToolError('INVALID_ARGUMENTS', 'assets needs video');
  const opened = await scope.open(args.video, access);
  const videoId = opened.ref.videoId;
  const video = videos.mirror(videoId)?.video ?? opened.snapshot.video;
  const files: string[] = [];
  for (const assetId of args.assets) {
    if (!video.assets[assetId]) throw new ToolError('ASSET_NOT_FOUND', `No asset ${assetId} in this video`, { next: 'Read asset IDs from videos_inspect' });
    // `file` 是相对 `root` 的路径。
    const located = await videos.assetFile(videoId, assetId);
    files.push(path.resolve(located.root, located.file));
  }
  return files;
}

function rejectForeignService(access: ToolAccess): void {
  if (access.principal.kind === 'service') {
    throw new ToolError('INVALID_ARGUMENTS', 'External services cannot process files on this computer. Ask the user to do this in BaoCut.');
  }
}

async function footage(deps: FootageToolsDeps, args: FootageArgs, principal: ToolPrincipal) {
  const { pipelines, scope } = deps;
  const access = scope.authorize(principal, true);
  rejectForeignService(access);
  const op = args.op;
  // 确认之前先挡住这种处理不收的参数，免得用户同意了再失败。
  const foreign = FOOTAGE_OPS.filter((other) => other !== op)
    .flatMap((other) => OP_ARGS[other])
    .filter((key) => args[key] !== undefined && !OP_ARGS[op].includes(key));
  if (foreign.length) throw new ToolError('INVALID_ARGUMENTS', `${foreign.join(', ')} don't apply to op ${op}.`);
  if (op === 'match-color' && args.reference === undefined) throw new ToolError('INVALID_ARGUMENTS', 'match-color needs reference: the image or video to match.');
  const inputs = await resolveInputs(deps, access, args);
  const base = scope.fileBase(access);
  const outDir = args.outDir !== undefined ? resolveUserPath(args.outDir, base) : undefined;
  // 要的工具没装好时先按安装确认（一次装一个，装好之后智能体再调用一次）。
  for (const name of footageTools(op, args.matteModel)) {
    const pending = await installStep(deps, access, args.commandId, name, { retryTool: 'assets_process', summary: RcAgentTools.installFootageToolSummary });
    if (pending) return pending;
  }
  const dir = outDir ?? deps.saveDirectory();
  const approval = await scope.confirm(access, {
    tool: 'assets_process',
    paid: false,
    ...confirmSummary(RcAgentTools.footageSummary({ tool: OP_LABELS[op]().text, count: inputs.length, executor: footageExecutorLabel(op, args), dir })),
  });
  const passed = (['start', 'end', ...OP_ARGS[op]] as const).filter((key) => args[key] !== undefined);
  const { jobId } = await pipelines.start(
    {
      pipeline: FOOTAGE_PIPELINE_NAMES[op],
      params: {
        inputs,
        ...Object.fromEntries(passed.map((key) => [key, key === 'reference' ? resolveUserPath(args.reference!, base) : args[key]])),
        ...(outDir !== undefined ? { outDir } : {}),
      },
      ...(args.commandId ? { commandId: scope.commandId(access, args.commandId) } : {}),
    },
    access.submitter,
  );
  return {
    jobId,
    installJobId: null,
    ...approvalField(approval),
    next: `Submitted ${FOOTAGE_PIPELINE_NAMES[op]} (${inputs.length} ${inputs.length === 1 ? 'file' : 'files'}); outputs go to ${outDir ?? 'the save location'}. Wait with jobs_wait; when state is completed, outputs[].path is the new file. Tell the user where it is and any summary.warnings; use assets_import to put it in a video.`,
  };
}

async function separateAudio(deps: FootageToolsDeps, args: SeparateArgs, principal: ToolPrincipal) {
  const { pipelines, scope } = deps;
  const access = scope.authorize(principal, true);
  rejectForeignService(access);
  const inputs = await resolveInputs(deps, access, args);
  const outDir = args.outDir !== undefined ? resolveUserPath(args.outDir, scope.fileBase(access)) : undefined;
  const stems = args.stems ?? 'vocals';
  const target = await deps.separationModel(args.model);
  const approval = await scope.confirm(access, {
    tool: 'assets_separate',
    paid: false,
    ...confirmSummary(
      RcAgentTools.separateAudioSummary({ count: inputs.length, stems: stems === 'four' ? 4 : 2, model: target.modelId, dir: outDir ?? deps.saveDirectory() }),
    ),
  });
  const { jobId } = await pipelines.start(
    {
      pipeline: SEPARATE_AUDIO_PIPELINE,
      params: { inputs, stems, model: target.modelId, ...(outDir !== undefined ? { outDir } : {}) },
      ...(args.commandId ? { commandId: scope.commandId(access, args.commandId) } : {}),
    },
    access.submitter,
  );
  return {
    jobId,
    model: target.modelId,
    ...approvalField(approval),
    next: `Submitted separate-audio (${inputs.length} ${inputs.length === 1 ? 'file' : 'files'}, ${stems}, ${target.modelId}); WAVs go to ${outDir ?? 'the save location'}. Wait with jobs_wait; when state is completed, outputs[].path are the stems and summary.items[].files names each one. Use assets_import to put them in a video.`,
  };
}
