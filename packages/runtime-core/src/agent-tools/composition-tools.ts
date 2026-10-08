// i18n-ignore-file: 给模型的工具说明、错误与下一步
import { z } from 'zod';
import { CODE_BUNDLE_CONTRACTS, COMPOSITION_INLINE_LIMITS, type EditResult, type VideoOpenResult } from '@baocut/protocol';
import { RcAgentTools } from '@baocut/protocol/messages/runtime-core';
import type { VideoService } from '../videos/video-service.ts';
import { videoChangeOf, type CompositionEdit, type CompositionService } from '../compositions/composition-service.ts';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import { approvalField, confirmSummary, type ToolAccess, type ToolApprovalNote, type ToolPrincipal, type ToolScope } from './tool-scope.ts';
import { FRAMES_DIR, MAX_FRAMES, framesDirectory } from './video-frames.ts';
import { commandIdArg, videoArg } from './video-tools.ts';

/**
 * 代码画面工具（架构设计 §8，代码包规范 §2、§6、§7）：智能体写的浏览器合成（代码包）导入视频、验证、烘焙成带透明的预渲染替身，
 * 放到时间线上；导入前后都能按局部时间取帧看画面。
 *
 * 导入与预览的主体在 `CompositionService`（与界面的 `compositions.*` 共用）；这里是工具的入口：范围的授权与确认、打开视频、
 * 相对路径与写帧的目录，以及每笔修改的变更卡（`recordChange`）。
 */

export interface CompositionToolsDeps {
  videos: VideoService;
  scope: ToolScope;
  /** 导入与预览的主体（与界面的 `compositions.*` 共用）。 */
  compositions: CompositionService;
}

const secondsText = z.string().regex(/^\d+(\.\d+)?$/);

/** 内联文件的单个文件上限：智能体手写的网页与脚本，不是素材库（与 `compositions.*` 的同一份上限）。 */
const MAX_INLINE_BYTES = COMPOSITION_INLINE_LIMITS.maxFileBytes;
const MAX_INLINE_FILES = COMPOSITION_INLINE_LIMITS.maxFiles;

const inlineFiles = z
  .array(
    z.strictObject({
      path: z.string().min(1).max(512).describe('包内的相对路径（/ 分隔），例如 index.html、assets/logo.svg'),
      content: z.string().max(MAX_INLINE_BYTES).optional().describe('文本内容（UTF-8）；与 contentBase64 只给一个'),
      contentBase64: z
        .string()
        .max(MAX_INLINE_BYTES * 2)
        .optional()
        .describe('二进制内容（图片、字体）的 base64；与 content 只给一个'),
    }),
  )
  .min(1)
  .max(MAX_INLINE_FILES);

const manifestOverrides = z
  .strictObject({
    width: z.number().int().min(16).max(8192).optional().describe('画面宽（像素）'),
    height: z.number().int().min(16).max(8192).optional().describe('画面高（像素）'),
    fps: z.number().positive().max(240).optional().describe('帧率；29.97、23.976、59.94 按 NTSC 帧率处理'),
    durationSeconds: z.number().positive().max(3600).optional().describe('时长（秒）；要同时给 fps'),
    alpha: z.boolean().optional().describe('输出带透明（叠加层）；不给时读根元素的 data-alpha，再缺省为 true。全幅不透明的画面传 false'),
    bundleId: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,100}$/)
      .optional()
      .describe('包的 ID（字母、数字、. _ -）；不给时按内容生成'),
    revision: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,50}$/)
      .optional()
      .describe('包的版本，默认 1'),
    entry: z.string().min(1).max(512).optional().describe('入口 HTML 的包内路径；不给时用 index.html（或唯一的那个 HTML）'),
    contract: z
      .enum(CODE_BUNDLE_CONTRACTS)
      .optional()
      .describe('作者合同：hyperframes/1 或 baocut/1；不给时页面里出现 __baocutCompositions 判为 baocut/1，否则 hyperframes/1'),
  })
  .optional()
  .describe(
    `可选。只在包里没有 bundle.manifest.json 时用：覆盖从根元素 data-* 读出的 width、height、fps、durationSeconds、alpha，以及 bundleId、revision、entry、contract（${CODE_BUNDLE_CONTRACTS.join('、')}）`,
  );

const PATH_DESCRIPTION = '代码包的目录：相对工作目录的路径或绝对路径；与 files 只给一个';
const FILES_DESCRIPTION = `内联的包文件（最多 ${MAX_INLINE_FILES} 个）：每项 path 加 content（文本）或 contentBase64（二进制），至少要有入口 HTML；与 path 只给一个`;

const schemas = {
  compositions_import: z.strictObject({
    video: videoArg,
    path: z.string().min(1).max(4096).optional().describe(PATH_DESCRIPTION),
    files: inlineFiles.optional().describe(FILES_DESCRIPTION),
    name: z.string().min(1).max(200).optional().describe('可选。素材名，也是时间线上片段的名字；不给时用包的 bundleId'),
    compositionId: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('可选。合成的 ID（根元素的 data-composition-id）；不给时读入口页面里第一个带 data-composition-id 的元素，再缺省为 main'),
    manifest: manifestOverrides,
    place: z
      .strictObject({
        track: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe('可选。放到哪条视觉轨（轨道 ID）；不给时用最上面那条视觉轨（它在这段时间里空着、没锁定时），否则在最上面新建一条'),
        at: secondsText.optional().describe('可选。开始时间：时间线上的秒数（十进制字符串），默认 "0"'),
      })
      .optional()
      .describe('可选。放到时间线上的位置；不给时从 0 秒开始、放在最上面的视觉轨。画面铺满画布'),
    replace: z
      .strictObject({
        itemId: z
          .string()
          .min(1)
          .max(200)
          .describe('要替换的合成片段（上一次 compositions_import 返回的 itemId，或 videos_inspect 里 type 为 composition 的片段）'),
      })
      .optional()
      .describe(
        '可选。改了文案或颜色、重新打包（新的 revision）之后，原地替换时间线上已有的那个代码画面：片段 ID、轨道、起点、位置与大小、不透明度、名字、效果、关键帧都不变，只换代码包版本与预渲染；长度跟新的预渲染走（变短就裁掉，变长撞上同轨后面的片段会以 TIMELINE_OVERLAP 拒绝）。不给时会再放一个新片段，叠在旧的上面。与 place、register 互斥',
      ),
    register: z.boolean().optional().describe('可选。true 时只验证并登记代码包素材：不烘焙、不放到时间线上；默认 false'),
    revision: z
      .string()
      .regex(/^\d+$/)
      .optional()
      .describe('可选。视频当前的版本（videos_inspect 或上一次回执的 revision），不一致时不导入；不给时用最新的版本'),
    commandId: commandIdArg.optional().describe('可选。同一次导入重试时带上同一个值，引擎不会重复提交'),
  }),
  compositions_preview: z.strictObject({
    video: videoArg,
    path: z.string().min(1).max(4096).optional().describe('代码包的目录：相对工作目录的路径或绝对路径；与 files、assetId 只给一个'),
    files: inlineFiles.optional().describe(`内联的包文件，写法同 compositions_import；与 path、assetId 只给一个`),
    assetId: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('已经导入这个视频的代码包素材（compositions_import 返回的 bundle.assetId）；与 path、files 只给一个'),
    at: z
      .array(secondsText)
      .min(1)
      .max(MAX_FRAMES)
      .describe(`要取帧的时刻：合成内部的局部时间（秒，十进制字符串，例如 "1.5"），最多 ${MAX_FRAMES} 个；超过时长的夹到末帧`),
    compositionId: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('可选。合成的 ID（根元素的 data-composition-id）；不给时同 compositions_import'),
    manifest: manifestOverrides,
  }),
};

type ToolName = keyof typeof schemas;
type ImportArgs = z.infer<(typeof schemas)['compositions_import']>;
type PreviewArgs = z.infer<(typeof schemas)['compositions_preview']>;

const TINY_OVERLAY = [
  '<!doctype html><html><body style="margin:0;background:transparent">',
  '<div id="root" data-composition-id="main" data-width="1920" data-height="1080" data-fps="30" data-duration="3" data-alpha="true">',
  '<div id="title" style="position:absolute;left:120px;bottom:120px;font:600 64px sans-serif;color:#fff">Hello</div></div>',
  '<script>const el=document.getElementById("title");let t=0;const render=()=>{el.style.opacity=String(Math.min(1,t/0.5));};',
  'window.__timelines={main:{seek(s){t=s;render();},time(){return t;},duration(){return 3;},pause(){},play(){},timeScale(){return 1;}}};render();</script>',
  '</body></html>',
].join('');

const DEFINITIONS: Record<ToolName, ToolInfo> = {
  compositions_import: {
    title: '导入代码画面',
    description: [
      '把一段用网页代码写的动画（代码包）导入视频：验证、烘焙成带透明的预渲染视频，并放到时间线上。',
      '代码包是一个目录（path），或内联的几个文件（files）：入口 HTML（默认 index.html）加它用到的脚本、样式、图片与字体，全部用包内相对路径引用，不能访问网络（CDN、在线字体、fetch 都不行）。',
      '作者合同二选一：hyperframes/1——根元素带 data-composition-id、data-width、data-height、data-fps、data-duration（秒），页面背景透明（没有清单时默认按透明叠加层处理；全幅不透明的画面传 manifest.alpha=false 或写 data-alpha="false"）；页面在 window.__timelines[<compositionId>] 上注册一条暂停的时间线（seek(秒)、time()、duration()、pause()），画面只由 seek 到的时间决定。baocut/1——页面在 window.__baocutCompositions[<compositionId>] 上暴露 initialize / renderAt(time, params) / dispose。包里有 bundle.manifest.json 时按清单，没有时按根元素的 data-* 与 manifest 覆盖生成清单。',
      '导入时在离屏浏览器里验证：根元素与时间线、seek 回读、末帧夹到时长、同一时刻两次取帧一致（确定性）、声明透明时确有透明像素、运行时没有网络请求。通过后按视频根序列的帧率逐帧烘焙成带 alpha 的 ProRes 4444 预渲染（预览与导出用它），代码包与预渲染作为素材收进视频（第一笔修改），再放一个合成片段（第二笔修改，可以分别撤销）：默认从 0 秒、铺满画布、放在最上面的视觉轨（那条轨在这段时间里被占着或锁着时新建一条），place 可以改轨道与开始时间。register: true 时只验证并登记代码包素材。',
      '改已经放上去的代码画面（改文案、改色）：改源文件、用新的 revision 重新打包，再带 replace: { itemId } 导入——第二笔用 replaceCodeBundle 原地换掉那个片段的代码包与预渲染，其余设置都保留；不带 replace 会多出一个叠在上面的片段。',
      '这是给视频加动画标题、字幕条、图表、转场卡等代码画面的正路：不要自己用浏览器录屏或 ffmpeg 渲染 mp4 再当素材导入。导入之前可以先用 compositions_preview 按时刻取帧看画面。',
      '返回 bundle（素材 assetId 与版本、bundleId、contentHash、尺寸、帧率、时长、文件数）、capabilities（实测的透明、随机访问等）、verification（每项检查）、prerender（预渲染素材与帧数）、itemId 与 trackId，以及 item（itemId、trackId、fromFrame、durationFrames、startSeconds、endSeconds；只登记时这三项为 null）；带 replace 时另有 replaced（换掉的旧代码包与预渲染、oldDurationFrames 与 newDurationFrames）。',
      '错误码：BUNDLE_MANIFEST_INVALID（清单不对，或读不出尺寸、帧率、时长）、BUNDLE_FILE_NOT_ALLOWED、BUNDLE_SYMLINK、BUNDLE_TOO_LARGE、BUNDLE_NETWORK_REFERENCE（引用了网络：把库与字体放进包内）、BUNDLE_HASH_MISMATCH、BUNDLE_ENTRY_MISSING、BUNDLE_CONTRACT_UNSUPPORTED、COMPOSITION_ROOT_MISSING（没有 data-composition-id 的根元素）、COMPOSITION_TIMELINE_MISSING（没有注册时间线）、COMPOSITION_SEEK_MISMATCH、COMPOSITION_INTRINSIC_MISMATCH（页面与清单的尺寸、帧率、时长不一致）、COMPOSITION_NONDETERMINISTIC（画面用了 Date.now、Math.random 或自走的动画）、COMPOSITION_ALPHA_MISMATCH（声明透明而画面全不透明）、COMPOSITION_VERIFICATION_FAILED、COMPOSITION_NETWORK_BLOCKED、COMPOSITION_SCRIPT_ERROR、COMPOSITION_RENDER_TIMEOUT、COMPOSITION_HOST_UNAVAILABLE（没有 Electron）。每个错误带 next，按它改包再导入。',
    ].join('\n'),
    effect: 'mutation',
    examples: [
      {
        title: '内联一个透明标题，放到 1.5 秒处',
        args: { video: 'demo', files: [{ path: 'index.html', content: TINY_OVERLAY }], name: '片头标题', place: { at: '1.5' } },
      },
      { title: '导入打包好的目录', args: { video: 'demo', path: 'graphics/lower-third/1' } },
      {
        title: '改色后用第 2 版原地替换时间线上的片段',
        args: { video: 'demo', path: 'graphics/lower-third/2', replace: { itemId: 'item_01J…' } },
      },
    ],
    surfaces: ['agent', 'cli', 'mcp'],
    positional: 'video',
  },
  compositions_preview: {
    title: '预览代码画面',
    description: [
      '在离屏浏览器里按合成内部的时刻取代码画面的帧，写成 PNG，用来检查排版与动画。',
      '代码包给目录（path）、内联文件（files，写法同 compositions_import），或已经导入这个视频的代码包素材（assetId）。at 是合成的局部时间（秒），超过时长的夹到末帧（clamped: true）。帧是代码包自己的画面（透明处保留透明），不是与视频合成后的画面；不改视频、不验证、不烘焙。',
      `文件写在写文件目录（会话与终端是工作目录）下的 ${FRAMES_DIR}/<videoId>/，名为 composition-<bundleId>-at-<毫秒>ms.png，同一时刻再取时覆盖。`,
      '返回 frames（每帧 at、file、实际采样的 sampledSeconds、clamped 与 PNG 的 sha256：两次取同一时刻摘要相同才说明画面是确定的）、尺寸与时长。错误码与 compositions_import 相同。',
    ].join('\n'),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    effect: 'mutation',
    examples: [
      { title: '导入前看几个时刻', args: { video: 'demo', path: 'graphics/lower-third', at: ['0', '1.2', '3.5'] } },
      { title: '看已经导入的代码包', args: { video: 'demo', assetId: 'asset_01J…', at: ['0.5'] } },
    ],
    surfaces: ['agent', 'cli', 'mcp'],
    positional: 'video',
  },
};

export class CompositionTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #deps: CompositionToolsDeps;

  constructor(deps: CompositionToolsDeps) {
    // 目录一致性测试只构造、不调用：依赖用到时才取。
    this.#deps = deps;
  }

  dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    switch (name as ToolName) {
      case 'compositions_import':
        return this.#import(args as ImportArgs, principal);
      case 'compositions_preview':
        return this.#preview(args as PreviewArgs, principal);
    }
    throw new ToolError('UNKNOWN_TOOL', `没有这个工具：${name}`);
  }

  async #import(args: ImportArgs, principal: ToolPrincipal) {
    const { scope, compositions } = this.#deps;
    const access = scope.authorize(principal, true);
    let approval: ToolApprovalNote | void = undefined;
    const result = await compositions.import(args, {
      open: () => scope.open(args.video, access),
      importBase: (opened) => scope.importBase(access, opened),
      confirm: async ({ name, place, replace }) => {
        approval = await scope.confirm(access, {
          tool: 'compositions_import',
          video: args.video,
          ...confirmSummary(
            replace
              ? RcAgentTools.replaceCompositionSummary({ name, clip: replace.clip })
              : RcAgentTools.importAssetSummary({ name, place }),
          ),
        });
      },
      apply: (opened, edit) => this.#apply(access, opened, principal, edit),
    });
    return { ...result, ...approvalField(approval) };
  }

  async #preview(args: PreviewArgs, principal: ToolPrincipal) {
    const { scope, compositions } = this.#deps;
    const access = scope.authorize(principal, false);
    const preview = await compositions.preview(args, {
      open: () => scope.open(args.video, access),
      importBase: (opened) => scope.importBase(access, opened),
      framesDir: (opened) => framesDirectory(scope.saveRoot(access, opened), opened.ref.videoId, scope.importBase(access, opened).confine),
    });
    return {
      ...preview,
      note: '帧是代码包自己的画面（透明处保留透明），不是与视频合成后的画面；超过时长的时刻夹到末帧（clamped: true）。',
    };
  }

  /** 提交一笔修改，回执放一张变更卡（与 `edits_apply` 相同）。 */
  async #apply(access: ToolAccess, opened: VideoOpenResult, principal: ToolPrincipal, edit: CompositionEdit): Promise<EditResult> {
    const { videos, scope } = this.#deps;
    const videoId = opened.ref.videoId;
    const result = await videos.apply(
      {
        videoId,
        commandId: scope.commandId(access, edit.commandId),
        expectedRevision: edit.expectedRevision,
        operations: edit.operations as never,
        label: edit.label,
      },
      principal,
      { ...taskOf(access), protections: scope.protections?.(access, videoId) ?? [] },
    );
    scope.recordChange(access, videoChangeOf(videos, opened, result));
    return result;
  }
}

/** 会话的调用带着进行中的任务号（记进事务的来源）；对外服务的没有。 */
function taskOf(access: ToolAccess): { taskId?: string } {
  const taskId = (access as { taskId?: unknown }).taskId;
  return typeof taskId === 'string' ? { taskId } : {};
}
