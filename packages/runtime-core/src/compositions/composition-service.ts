// i18n-ignore-file: ToolError 的消息与下一步给模型看；界面经 RPC 显示的是 rcVideo 目录里的文案，原话只放在 details 里
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  BAKE_PROVENANCE_ORIGIN,
  CODE_BUNDLE_CONTRACTS,
  type BakeRecord,
  type CodeBundleCheck,
  type CodeBundleContract,
  type CodeBundleErrorCode,
  type CodeBundleVerificationReport,
  type CodeEdit,
  type CompositionImportResult,
  type CompositionPlacement,
  type CompositionInlineFile,
  type EditResult,
  type Id,
  type Sequence,
  type VideoChange,
  type VideoOpenResult,
  type VideoSnapshot,
} from '@baocut/protocol';
import { RcAgentTools } from '@baocut/protocol/messages/runtime-core';
import {
  CodeBundleError,
  CompositionHost,
  bakeComposition,
  frameTicketAt,
  inspectBundle,
  readRootAttributes,
  verifyBundle,
  type BakeResult,
  type CompositionHostOptions,
  type InspectedBundle,
  type SynthesizeOverrides,
} from '@baocut/code-runtime';
import type { Logger } from '@baocut/harness';
import type { VideoService } from '../videos/video-service.ts';
import { inside } from '../agent-tools/artifact-save.ts';
import { ToolError, errorBody } from '../agent-tools/tool-catalog.ts';
import { digestReceipt, resolveUserPath } from '../agent-tools/video-digest.ts';
import { frameTimes } from '../agent-tools/video-frames.ts';

/**
 * 代码画面服务（架构设计 §8，代码包规范 §2、§6、§7）：浏览器合成（代码包）的导入与预览。界面经 RPC（`compositions.*`）、
 * 智能体与对外服务经工具（`compositions_import` / `compositions_preview`）走的都是这里，区别只在调用方传进来的上下文：
 * 怎么打开视频、相对路径按哪里解析、确认与提交（谁是操作者、变更卡放在哪里）、帧写到哪里。
 *
 * 浏览器合成在 Electron 离屏宿主里执行（`@baocut/code-runtime`）。宿主按需拉起、各次调用共用、串行使用，Runtime 停止时关掉。
 * 写入视频走与界面相同的 `VideoService.apply`：第一笔导入代码包与预渲染两个素材，第二笔放一个合成实例（合成的 `source.assetRef`
 * 与 `prerender` 只收已有素材的版本，不能引用同一笔里 `importAsset` 的 ref，所以分两笔）。
 *
 * 错误照工具的写法抛 `ToolError`（错误码、给模型的原话与 `next`）；RPC 的处理函数再换成 `RpcError`。
 */

/** 宿主的共享句柄：同一个 Runtime 里的各个入口（会话、终端、对外服务、界面）共用一个 Electron 进程，串行使用；死了就重启。 */
export class SharedCompositionHost {
  readonly #options: CompositionHostOptions;
  #host: CompositionHost | null = null;
  #chain: Promise<unknown> = Promise.resolve();
  #closed = false;

  constructor(options: CompositionHostOptions = {}) {
    this.#options = options;
  }

  /** 排队用宿主：前一次用完才轮到下一次（烘焙与取帧不并发抢同一个宿主）。 */
  use<T>(fn: (host: CompositionHost) => Promise<T>): Promise<T> {
    const run = this.#chain.then(async () => fn(await this.#acquire()));
    this.#chain = run.catch(() => {});
    return run;
  }

  async #acquire(): Promise<CompositionHost> {
    if (this.#closed) throw new CodeBundleError('COMPOSITION_HOST_UNAVAILABLE', 'The runtime is stopping');
    if (this.#host?.alive) return this.#host;
    if (this.#host) await this.#host.close().catch(() => {});
    this.#host = null;
    this.#host = await CompositionHost.start(this.#options);
    return this.#host;
  }

  /** Runtime 停止：关掉宿主（正在进行的取帧随之失败），之后的调用回答 `COMPOSITION_HOST_UNAVAILABLE`。 */
  async close(): Promise<void> {
    this.#closed = true;
    const host = this.#host;
    this.#host = null;
    if (host) await host.close();
  }
}

export interface CompositionServiceDeps {
  videos: VideoService;
  /** 烘焙用的 ffmpeg（绝对路径或命令名）。 */
  ffmpeg: () => string | Promise<string>;
  host: SharedCompositionHost;
  log?: Logger;
}

/** 清单覆盖（包里没有 `bundle.manifest.json` 时用）。字段可以显式为 undefined：工具的参数经 zod 解析后就是这样。 */
export interface CompositionManifestInput {
  width?: number | undefined;
  height?: number | undefined;
  fps?: number | undefined;
  durationSeconds?: number | undefined;
  alpha?: boolean | undefined;
  bundleId?: string | undefined;
  revision?: string | undefined;
  entry?: string | undefined;
  contract?: CodeBundleContract | undefined;
}

interface BundleSourceInput {
  path?: string | undefined;
  files?: CompositionInlineFile[] | undefined;
  compositionId?: string | undefined;
  manifest?: CompositionManifestInput | undefined;
}

export interface CompositionImportRequest extends BundleSourceInput {
  name?: string | undefined;
  place?: { track?: string | undefined; at?: string | undefined } | undefined;
  /** 原地替换时间线上已有的合成片段（代码包规范 §3.3）；与 `place`、`register` 互斥。 */
  replace?: { itemId: string } | undefined;
  register?: boolean | undefined;
  revision?: string | undefined;
  commandId?: string | undefined;
}

export interface CompositionPreviewRequest extends BundleSourceInput {
  assetId?: string | undefined;
  at: string[];
}

/** 一笔修改：由调用方提交（操作者、幂等键、保护范围与变更卡都在调用方那边）。 */
export interface CompositionEdit {
  expectedRevision: string;
  label: string;
  operations: Record<string, unknown>[];
  /** 调用方给的幂等键（第二笔是 `<commandId>-place`）；没给时由调用方新生成。 */
  commandId: string | undefined;
}

/** 调用方的上下文：打开视频，以及 `path` 按哪里解析、能不能出这个目录。 */
export interface CompositionCaller {
  open(): Promise<VideoOpenResult>;
  /** `path` 相对的目录；`confine` 不为空时目录（按真实路径）必须在它里面。 */
  importBase(opened: VideoOpenResult): { cwd: string; confine: string | null };
}

export interface CompositionImportCaller extends CompositionCaller {
  /**
   * 有副作用之前的确认（会话里按访问模式问用户）；拒绝时抛出。界面发起的调用直接通过。`replace` 是要原地替换的片段
   * （`clip` 是它的名字，没有名字时是 ID）。
   */
  confirm(request: { name: string; place: boolean; replace: { itemId: Id; clip: string } | null }): Promise<void>;
  apply(opened: VideoOpenResult, edit: CompositionEdit): Promise<EditResult>;
}

export interface CompositionPreviewCaller extends CompositionCaller {
  /** 帧写到的目录（建好的真实路径）。 */
  framesDir(opened: VideoOpenResult): Promise<string>;
}

/** 预览的结果：帧写成了文件（`file` 是绝对路径），调用方决定怎么交出去（工具给路径，RPC 给媒体句柄）。 */
export interface CompositionPreview {
  videoId: Id;
  bundleId: string;
  compositionId: string;
  width: number;
  height: number;
  durationSeconds: number;
  alpha: boolean;
  frames: Array<{ at: string; file: string; sampledSeconds: number; clamped: boolean; sha256: string }>;
}

/** 每个错误码的下一步：智能体据此改包再试（RPC 放进 `details.next`）。 */
export const BUNDLE_NEXT: Record<CodeBundleErrorCode, string> = {
  BUNDLE_MANIFEST_INVALID:
    '清单不对，或包里没有清单而尺寸、帧率、时长读不出来：在根元素上写 data-width、data-height、data-fps、data-duration（或用 manifest 覆盖）；有 bundle.manifest.json 时按 details 改正，也可以删掉它让导入时重新生成',
  BUNDLE_FILE_NOT_ALLOWED:
    '包里只能有网页、脚本、样式、图片、字体与音视频等白名单内的文件，不能有点文件与 node_modules：删掉 details 里列出的文件再试',
  BUNDLE_SYMLINK: '包里不能有符号链接：换成真实的文件再试',
  BUNDLE_TOO_LARGE: '包太大（最多 4096 个文件、单个 64 MiB、合计 256 MiB）：删掉用不到的资源或压缩后再试',
  BUNDLE_NETWORK_REFERENCE: '代码包必须离线：把依赖的库与字体放进包内、用相对路径引用，再导入；不要用 CDN、在线字体或网络请求',
  BUNDLE_HASH_MISMATCH:
    'bundle.manifest.json 的 contentHash 与文件对不上：重新打包，或删掉 bundle.manifest.json 与 files.manifest.json 让导入时重新生成',
  BUNDLE_ENTRY_MISSING: '找不到入口 HTML：在包里放 index.html，或用 manifest.entry 指定入口',
  BUNDLE_CONTRACT_UNSUPPORTED: `只支持 ${CODE_BUNDLE_CONTRACTS.join('、')} 两种浏览器合同：按其中一种改写页面`,
  COMPOSITION_ROOT_MISSING:
    '入口页面里没有带 data-composition-id 的根元素：加上它（值与 compositionId 一致），并写 data-width、data-height、data-fps、data-duration',
  COMPOSITION_TIMELINE_MISSING:
    'hyperframes/1 要在 window.__timelines[<compositionId>] 上注册暂停的、可以 seek(秒) 的时间线；baocut/1 要在 window.__baocutCompositions[<compositionId>] 上暴露 renderAt。改好再试',
  COMPOSITION_SEEK_MISMATCH:
    'seek 之后回读的时间对不上，或越过末尾的请求没有夹到时长：让 time() 返回 seek 到的时间，时长与 data-duration 一致',
  COMPOSITION_INTRINSIC_MISMATCH: '页面报告的尺寸、帧率或时长与清单不一致：让根元素的 data-* 与清单（或 manifest 覆盖）一致',
  COMPOSITION_NONDETERMINISTIC:
    '同一时刻两次取帧不一样：画面只能由 seek 到的时间决定，不要用 Date.now()、performance.now()、Math.random()（要随机就用固定种子）、CSS 动画或 requestAnimationFrame 自己推进',
  COMPOSITION_NETWORK_BLOCKED: '页面运行时发起了网络请求并被拦截：把用到的资源放进包内，用相对路径引用',
  COMPOSITION_SCRIPT_ERROR: '页面脚本出错：按 message 改正脚本再试',
  COMPOSITION_RENDER_TIMEOUT: '页面没有及时就绪或取帧超时：减少每帧的计算量，确认时间线注册了、页面没有卡住',
  COMPOSITION_HOST_UNAVAILABLE: '需要 Electron 才能渲染代码画面；安装桌面端或设置 BAOCUT_ELECTRON',
};

const ALPHA_NEXT = '画面全不透明：传 manifest.alpha=false（或根元素写 data-alpha="false"），或让背景透明';

/** `importAsset` 的 ref：从回执的 `refs` 取新素材的 ID。 */
const BUNDLE_REF = 'bundle';
const PRERENDER_REF = 'prerender';
const TRACK_REF = 'track';

export class CompositionService {
  readonly #deps: CompositionServiceDeps;

  constructor(deps: CompositionServiceDeps) {
    this.#deps = deps;
  }

  /** 导入：验证、烘焙、两笔修改（素材，再放置）。返回的对象就是工具结果（工具另加确认的说明）。 */
  async import(args: CompositionImportRequest, caller: CompositionImportCaller): Promise<CompositionImportResult> {
    const { videos } = this.#deps;
    if ((args.path === undefined) === (args.files === undefined)) {
      throw new ToolError('INVALID_ARGUMENTS', 'path 与 files 给且只给一个：path 是代码包的目录，files 是内联的包文件');
    }
    if (args.replace && (args.place !== undefined || args.register)) {
      throw new ToolError(
        'INVALID_ARGUMENTS',
        'replace 与 place、register 不能同时给：replace 原地替换已有的合成片段，轨道与起点沿用它原来的',
      );
    }
    const opened = await caller.open();
    const videoId = opened.ref.videoId;
    // 要替换的片段先查：不存在或不是合成片段时不必验证与烘焙。
    const target = args.replace ? replaceTarget(current(videos, opened), args.replace.itemId) : null;
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-composition-'));
    try {
      const dir = await sourceDirectory(args, caller.importBase(opened), work);
      const bundle = await inspect(dir, args, work);
      const name = (args.name ?? bundle.manifest.bundleId).trim();
      const register = args.register ?? false;
      await caller.confirm({ name, place: !register, replace: target && { itemId: target.itemId, clip: target.clip } });

      const report = await this.#withHost((host) => verifyBundle(host, bundle));
      if (report.status === 'failed') throw verificationError(report);
      const capabilities = report.capabilities!;

      const before = current(videos, opened);
      // 烘焙帧率与秒→帧的换算都按片段所在的序列（代码包规范 §3.3、§7）：替换取原片段所在的序列，放置放在根序列上。
      const sequence = before.sequences[target?.sequenceId ?? before.rootSequenceId]!;
      const fps = sequence.fps;
      let bake: BakeResult | null = null;
      if (!register) {
        const outputFile = path.join(work, `${safeName(bundle.manifest.bundleId)}-${safeName(bundle.manifest.revision)}.mov`);
        const ffmpeg = await this.#deps.ffmpeg();
        bake = await this.#withHost((host) =>
          bakeComposition(host, bundle, { fps, outputFile, ffmpeg, alpha: bundle.manifest.output.alpha }),
        ).catch((error: unknown) => {
          if (error instanceof CodeBundleError || error instanceof ToolError) throw error;
          throw new ToolError('COMPOSITION_BAKE_FAILED', `烘焙预渲染失败：${error instanceof Error ? error.message : String(error)}`, {
            next: '检查 ffmpeg 是否可用（BAOCUT_FFMPEG 或 PATH 里的 ffmpeg）；也可以先用 register: true 只登记代码包',
          });
        });
      }

      // 第一笔：代码包与预渲染两个素材。
      const identity = { id: bundle.manifest.bundleId, revision: bundle.manifest.revision };
      const operations: Record<string, unknown>[] = [
        {
          type: 'importAsset',
          path: bundle.root,
          name,
          storage: 'managed',
          bundle: bundle.manifest,
          provenance: { origin: 'agent-import', source: { verification: report } },
          ref: BUNDLE_REF,
        },
      ];
      if (bake) {
        // 预渲染与代码包的素材 ID 要等回执才知道：烘焙记录里先写代码包清单的身份（代码包规范 §2.3 的缓存身份），
        // 真正的素材引用在合成片段的 `source.assetRef` 与 `prerender` 上，也在结果里返回。
        const record: BakeRecord = {
          bakedAssetRef: identity,
          sourceBundleRef: identity,
          parameterValuesHash: bake.parameterValuesHash,
          timeMapHash: bake.timeMapHash,
          outputProfileHash: bake.outputProfileHash,
          bakedAt: new Date().toISOString(),
          status: 'current',
          encoding: bake.encoding,
        };
        operations.push({
          type: 'importAsset',
          path: bake.file,
          name: path.basename(bake.file),
          storage: 'managed',
          provenance: { origin: BAKE_PROVENANCE_ORIGIN, source: record },
          ref: PRERENDER_REF,
        });
      }
      const imported = await caller.apply(opened, {
        expectedRevision: args.revision ?? before.revision,
        label: RcAgentTools.importAssetLabel({ name, place: false }).text,
        operations,
        commandId: args.commandId,
      });
      const refs = imported.receipt.refs ?? {};
      const afterImport = current(videos, opened);
      const bundleAssetId = refs[BUNDLE_REF]!;
      const bundleRevision = afterImport.assets[bundleAssetId]!.currentRevision;
      const prerenderAssetId = bake ? refs[PRERENDER_REF]! : null;
      const prerenderRevision = prerenderAssetId ? afterImport.assets[prerenderAssetId]!.currentRevision : null;
      const assets = {
        bundle: { assetId: bundleAssetId, revision: bundleRevision },
        ...(prerenderAssetId ? { prerender: { assetId: prerenderAssetId, revision: prerenderRevision } } : {}),
      };

      // 第二笔：放一个合成片段，源是代码包素材，替身是预渲染；给了 replace 时原地换掉那个片段的代码包与替身。
      let itemId: Id | null = null;
      let trackId: Id | null = null;
      let replaced: CodeEdit | undefined;
      let after = imported.receipt.videoRevision;
      if (target && bake && prerenderAssetId && prerenderRevision) {
        let swapped: EditResult;
        try {
          swapped = await caller.apply(opened, {
            expectedRevision: after,
            label: RcAgentTools.replaceCompositionLabel({ name }).text,
            operations: [
              {
                type: 'replaceCodeBundle',
                sequenceId: target.sequenceId,
                itemId: target.itemId,
                assetRef: { id: bundleAssetId, revision: bundleRevision },
                prerender: { id: prerenderAssetId, revision: prerenderRevision },
              },
            ],
            commandId: args.commandId !== undefined ? `${args.commandId}-place` : undefined,
          });
        } catch (error) {
          // 引擎的 message 并进上面这句话里：留在 extra 里会盖掉它，模型就看不到第一笔已经提交。
          const { message: engineMessage, ...body } = errorBody(error);
          throw new ToolError(body.code, `代码包与预渲染已经导入（第一笔已提交），替换片段 ${target.itemId} 失败：${engineMessage}`, {
            ...body,
            imported: assets,
            revision: after,
            next:
              body.code === 'TIMELINE_OVERLAP'
                ? '新版本比原片段长，撞上了同一轨道上后面的片段：先用 edits_apply 的 moveItem 把后面的片段往后挪（或 deleteItems 删掉），再用 edits_apply 的 replaceCodeBundle 完成替换（assetRef 与 prerender 取 imported 里的 bundle 与 prerender，写成 { id: assetId, revision }）；不要重新导入'
                : '素材已导入：按错误改正后用 edits_apply 的 replaceCodeBundle 完成替换（assetRef 与 prerender 取 imported 里的 bundle 与 prerender，写成 { id: assetId, revision }）；不要重新导入',
          });
        }
        after = swapped.receipt.videoRevision;
        replaced = swapped.receipt.impact.codeEdits?.find((edit) => edit.itemId === target.itemId);
        itemId = target.itemId;
        trackId = target.trackId;
      } else if (bake && prerenderAssetId && prerenderRevision) {
        const fromFrame = Math.round((Number(args.place?.at ?? '0') * fps.num) / fps.den);
        const span = { fromFrame, durationFrames: bake.frames };
        const target = placementTrack(afterImport.sequences[sequence.id]!, args.place?.track, span);
        const item = {
          type: 'composition',
          ...('trackId' in target ? { trackId: target.trackId } : { trackRef: TRACK_REF }),
          name,
          span,
          place: {},
          source: { kind: 'bundle', assetRef: { id: bundleAssetId, revision: bundleRevision } },
          parameterValues: {},
          timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: fps.num }, rate: { num: 1, den: 1 } },
          prerender: { id: prerenderAssetId, revision: prerenderRevision },
        };
        const placeOps: Record<string, unknown>[] = [
          ...('trackId' in target ? [] : [{ type: 'addTrack', sequenceId: sequence.id, kind: 'visual', ref: TRACK_REF }]),
          { type: 'insertItems', sequenceId: sequence.id, items: [item] },
        ];
        let placed: EditResult;
        try {
          placed = await caller.apply(opened, {
            expectedRevision: after,
            // 第一期沿用导入素材的文案（「导入 … 并放到时间线上」），不另加文案键。
            label: RcAgentTools.importAssetLabel({ name, place: true }).text,
            operations: placeOps,
            commandId: args.commandId !== undefined ? `${args.commandId}-place` : undefined,
          });
        } catch (error) {
          // 引擎的 message 并进上面这句话里：留在 extra 里会盖掉它，模型就看不到第一笔已经提交。
          const { message: engineMessage, ...body } = errorBody(error);
          throw new ToolError(body.code, `代码包与预渲染已经导入（第一笔已提交），放到时间线上失败：${engineMessage}`, {
            ...body,
            imported: assets,
            revision: after,
            next: '素材已导入：换一个 place（另一条轨道或开始时间）再调用一次 compositions_import 即可；同一个代码包按内容复用已导入的素材；预渲染会重新烘焙，与上一份逐字节相同才复用，否则多出一份素材（上一份不再被引用）',
          });
        }
        after = placed.receipt.videoRevision;
        const placedRefs = placed.receipt.refs ?? {};
        const created = new Set(placed.receipt.createdIds);
        const finalVideo = current(videos, opened);
        const inserted = finalVideo.sequences[sequence.id]?.items.find((it) => created.has(it.id) && it.type === 'composition');
        itemId = inserted?.id ?? null;
        trackId = inserted?.trackId ?? ('trackId' in target ? target.trackId : (placedRefs[TRACK_REF] ?? null));
      }

      const finalVideo = current(videos, opened);
      const prerenderRecord =
        prerenderAssetId && prerenderRevision ? finalVideo.assets[prerenderAssetId]?.revisions[prerenderRevision] : undefined;
      const { manifest } = bundle;
      const intrinsicFps = manifest.intrinsic.fps;
      return {
        status: 'committed',
        videoId,
        revision: { before: imported.receipt.previousRevision, after },
        bundle: {
          assetId: bundleAssetId,
          revision: bundleRevision,
          bundleId: manifest.bundleId,
          manifestRevision: manifest.revision,
          contentHash: manifest.contentHash,
          contract: capabilities.contract,
          compositionId: bundle.compositionId,
          width: manifest.intrinsic.width,
          height: manifest.intrinsic.height,
          fps: intrinsicFps,
          durationFrames: manifest.intrinsic.durationFrames,
          durationSeconds: round((manifest.intrinsic.durationFrames * intrinsicFps.den) / intrinsicFps.num),
          bytes: bundle.totalBytes,
          files: bundle.entries.length,
          synthesizedManifest: bundle.synthesized,
        },
        capabilities,
        verification: { status: report.status, checks: report.checks },
        prerender:
          bake && prerenderAssetId && prerenderRevision
            ? {
                assetId: prerenderAssetId,
                revision: prerenderRevision,
                frames: bake.frames,
                fps: bake.fps,
                encoding: bake.encoding,
                hasAlpha: prerenderRecord?.video?.hasAlpha ?? bake.encoding.alpha,
              }
            : null,
        itemId,
        trackId,
        item: itemId ? placementOf(finalVideo, itemId) : null,
        ...(replaced ? { replaced } : {}),
      };
    } catch (error) {
      throw toolError(error);
    } finally {
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** 预览：按合成内部的时刻取帧，写成 PNG（同一时刻再取时覆盖）。不改视频、不验证、不烘焙。 */
  async preview(args: CompositionPreviewRequest, caller: CompositionPreviewCaller): Promise<CompositionPreview> {
    const { videos } = this.#deps;
    const given = [args.path, args.files, args.assetId].filter((v) => v !== undefined).length;
    if (given !== 1) throw new ToolError('INVALID_ARGUMENTS', 'path、files 与 assetId 给且只给一个');
    const times = frameTimes({ at: args.at });
    const opened = await caller.open();
    const videoId = opened.ref.videoId;
    const dir = await caller.framesDir(opened);
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-composition-'));
    try {
      let source: string;
      if (args.assetId !== undefined) {
        const asset = current(videos, opened).assets[args.assetId];
        if (!asset || asset.kind !== 'bundle') {
          throw new ToolError('ASSET_NOT_FOUND', `这个视频里没有代码包素材 ${args.assetId}：用 compositions_import 返回的 bundle.assetId`);
        }
        const located = await videos.assetFile(videoId, args.assetId, asset.currentRevision);
        source = path.resolve(located.root, located.file);
      } else {
        source = await sourceDirectory(args, caller.importBase(opened), work);
      }
      const bundle = await inspect(source, args, work);
      const { manifest } = bundle;
      const name = safeName(manifest.bundleId);
      const frames = await this.#withHost(async (host) => {
        const session = await host.open(bundle);
        try {
          const out = [];
          for (const at of times) {
            const ticket = frameTicketAt(bundle, { seconds: Number(at) }, { quality: 'draft' });
            const frame = await session.frame(ticket);
            const file = path.join(dir, `composition-${name}-at-${Math.round(Number(at) * 1000)}ms.png`);
            await writeAtomically(file, frame.png);
            out.push({
              at,
              file,
              sampledSeconds: round(frame.receipt.sampledSeconds),
              clamped: frame.receipt.clampedToDuration,
              sha256: frame.receipt.sha256,
            });
          }
          return { frames: out, page: session.page };
        } finally {
          await session.dispose().catch(() => {});
        }
      });
      return {
        videoId,
        bundleId: manifest.bundleId,
        compositionId: bundle.compositionId,
        width: frames.page.width,
        height: frames.page.height,
        durationSeconds: round(frames.page.durationSeconds),
        alpha: manifest.output.alpha,
        frames: frames.frames,
      };
    } catch (error) {
      throw toolError(error);
    } finally {
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }

  #withHost<T>(fn: (host: CompositionHost) => Promise<T>): Promise<T> {
    return this.#deps.host.use(fn);
  }
}

/** 一笔修改的回执 → 会话里的变更卡（与 `edits_apply` 相同）。不属于项目的视频 `conversationId` 留空，由放卡的一方补上。 */
export function videoChangeOf(videos: VideoService, opened: VideoOpenResult, result: EditResult): VideoChange {
  const videoId = opened.ref.videoId;
  const video = opened.snapshot.video;
  // 回执的 `impact.oldDurationFrames` / `newDurationFrames` 是根序列的长度（引擎 `Video::commit` 按根序列算），
  // 所以换成秒用根序列的帧率，不跟被修改的片段所在的序列走。
  const digest = digestReceipt(result.receipt, video.sequences[video.rootSequenceId]!.fps, result.replayed);
  const { ref } = opened;
  return {
    videoId,
    videoName: videos.ref(videoId)?.name ?? ref.name,
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
}

/** 调用方给的代码包：目录（按 `base` 解析，`confine` 不为空时不能出它）或内联文件（写进临时目录）。 */
async function sourceDirectory(
  args: { path?: string | undefined; files?: CompositionInlineFile[] | undefined },
  base: { cwd: string; confine: string | null },
  work: string,
): Promise<string> {
  if (args.files !== undefined) return writeInlineFiles(args.files, path.join(work, 'source'));
  const resolved = resolveUserPath(args.path!, base.cwd);
  const real = await fs.realpath(resolved).catch(() => null);
  if (!real)
    throw new ToolError('BUNDLE_ENTRY_MISSING', `读不到代码包目录 ${args.path}`, {
      next: 'path 要是代码包的目录（相对工作目录或绝对路径）',
    });
  if (base.confine !== null && !inside(real, await fs.realpath(base.confine))) {
    throw new ToolError('PATH_OUTSIDE_PROJECT', '代码包目录要在视频所在的项目目录里（相对项目目录的路径）');
  }
  const stat = await fs.stat(real);
  if (!stat.isDirectory()) {
    throw new ToolError(
      'INVALID_ARGUMENTS',
      `${args.path} 不是目录：代码包是一个目录（入口 HTML 与它用到的文件）；单个 HTML 用 files 内联`,
    );
  }
  return real;
}

/** 检查代码包；清单覆盖换成 `inspectBundle` 的写法（时长按帧率换成帧数）。合成清单时暂存在 `work` 里，随它删掉。 */
async function inspect(
  dir: string,
  args: { compositionId?: string | undefined; manifest?: CompositionManifestInput | undefined },
  work: string,
): Promise<InspectedBundle> {
  const m = args.manifest;
  const overrides: SynthesizeOverrides = {};
  if (m) {
    if (m.durationSeconds !== undefined && m.fps === undefined) {
      throw new ToolError('INVALID_ARGUMENTS', 'manifest.durationSeconds 要和 manifest.fps 一起给（时长按帧率换成帧数）');
    }
    if (m.width !== undefined) overrides.width = m.width;
    if (m.height !== undefined) overrides.height = m.height;
    if (m.fps !== undefined) overrides.fps = m.fps;
    if (m.durationSeconds !== undefined && m.fps !== undefined)
      overrides.durationFrames = Math.max(1, Math.round(m.durationSeconds * m.fps));
    if (m.bundleId !== undefined) overrides.bundleId = m.bundleId;
    if (m.revision !== undefined) overrides.revision = m.revision;
    if (m.entry !== undefined) overrides.entry = m.entry;
    if (m.contract !== undefined) overrides.contract = m.contract;
  }
  // NTSC 帧率的时长：fps 按 n*1000/1001 处理，帧数用整数比算才准。
  if (m?.durationSeconds !== undefined && m.fps !== undefined && !Number.isInteger(m.fps)) {
    const ntsc = Math.round(m.fps * 1.001);
    if (Math.abs((ntsc * 1000) / 1001 - m.fps) < 0.005)
      overrides.durationFrames = Math.max(1, Math.round((m.durationSeconds * ntsc * 1000) / 1001));
  }
  // 没有清单时默认按透明叠加层合成：调用方与根元素的 data-alpha 都没说时为 true（全幅不透明的画面传 manifest.alpha=false）。
  overrides.alpha = m?.alpha ?? (await rootAlpha(dir, m?.entry)) ?? true;
  return inspectBundle(dir, {
    manifest: overrides,
    ...(args.compositionId !== undefined ? { compositionId: args.compositionId } : {}),
    stagingDir: path.join(work, 'bundle'),
  });
}

/** 入口 HTML 根元素的 `data-alpha`；读不到或没写时 undefined（有清单时覆盖不生效，这里读错也无妨）。 */
async function rootAlpha(dir: string, entry: string | undefined): Promise<boolean | undefined> {
  const html = await fs.readFile(path.join(dir, ...(entry ?? 'index.html').split('/')), 'utf8').catch(() => null);
  return html === null ? undefined : readRootAttributes(html).alpha;
}

/** 内联文件写进 `dir`：路径必须是包内的相对路径（不含 `..`、绝对路径与反斜杠），内容二选一。 */
async function writeInlineFiles(files: CompositionInlineFile[], dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const seen = new Set<string>();
  for (const [index, file] of files.entries()) {
    const segments = file.path.split('/');
    if (
      file.path.startsWith('/') ||
      file.path.includes('\\') ||
      /^[A-Za-z]:/.test(file.path) ||
      segments.some((s) => s === '' || s === '.' || s === '..')
    ) {
      throw new ToolError('INVALID_ARGUMENTS', `files[${index}].path 要是包内的相对路径（/ 分隔，不含 . 与 ..）：${file.path}`);
    }
    if (seen.has(file.path)) throw new ToolError('INVALID_ARGUMENTS', `files 里 ${file.path} 出现了两次`);
    seen.add(file.path);
    if ((file.content === undefined) === (file.contentBase64 === undefined)) {
      throw new ToolError('INVALID_ARGUMENTS', `files[${index}]（${file.path}）的 content 与 contentBase64 给且只给一个`);
    }
    const data = file.content !== undefined ? Buffer.from(file.content, 'utf8') : Buffer.from(file.contentBase64!, 'base64');
    const target = path.join(dir, ...segments);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  }
  return dir;
}

/**
 * 合成片段放在哪条轨：给了轨道 ID 就是它；不给时用最上面那条视觉轨（没锁定、这段时间里空着），否则在最上面新建一条
 * （叠加层要盖在已有画面上面）。
 */
function placementTrack(
  sequence: Sequence,
  track: string | undefined,
  span: { fromFrame: number; durationFrames: number },
): { trackId: Id } | { trackRef: string } {
  if (track !== undefined) return { trackId: track };
  const top = sequence.tracks.filter((t) => t.kind === 'visual').sort((a, b) => b.order - a.order)[0];
  if (!top || top.locked) return { trackRef: TRACK_REF };
  const end = span.fromFrame + span.durationFrames;
  const busy = sequence.items.some((item) => {
    if (item.trackId !== top.id || !('span' in item)) return false;
    const s = item.span;
    return s.fromFrame < end && span.fromFrame < s.fromFrame + s.durationFrames;
  });
  return busy ? { trackRef: TRACK_REF } : { trackId: top.id };
}

/** `replace` 指向的片段：必须在时间线上，而且是合成片段。 */
function replaceTarget(video: VideoSnapshot, itemId: string): { sequenceId: Id; itemId: Id; trackId: Id; clip: string } {
  for (const sequence of Object.values(video.sequences)) {
    const item = sequence.items.find((it) => it.id === itemId);
    if (!item) continue;
    if (item.type !== 'composition') {
      throw new ToolError('INVALID_ARGUMENTS', `片段 ${itemId} 是 ${item.type}，不是合成片段：replace 只能替换代码画面`, {
        next: '用 videos_inspect 找 type 为 composition 的片段 itemId，或去掉 replace 新放一个',
      });
    }
    return { sequenceId: sequence.id, itemId, trackId: item.trackId, clip: item.name?.trim() || itemId };
  }
  throw new ToolError('INVALID_ARGUMENTS', `时间线上没有片段 ${itemId}`, {
    next: 'replace.itemId 用上一次 compositions_import 返回的 itemId，或 videos_inspect 里 type 为 composition 的片段',
  });
}

/** 片段在时间线上的位置：所在序列的帧与秒。 */
function placementOf(video: VideoSnapshot, itemId: Id): CompositionPlacement | null {
  for (const sequence of Object.values(video.sequences)) {
    const item = sequence.items.find((it) => it.id === itemId);
    if (!item || !('span' in item)) continue;
    const { fromFrame, durationFrames } = item.span;
    const seconds = (frames: number) => round((frames * sequence.fps.den) / sequence.fps.num);
    return {
      itemId,
      trackId: item.trackId,
      fromFrame,
      durationFrames,
      startSeconds: seconds(fromFrame),
      endSeconds: seconds(fromFrame + durationFrames),
    };
  }
  return null;
}

/** 验证没通过：第一项失败的检查给出错误码与下一步，全部检查放进错误。 */
function verificationError(report: CodeBundleVerificationReport): ToolError {
  const failed = report.checks.filter((c): c is CodeBundleCheck & { status: 'failed' } => c.status === 'failed');
  const first = failed[0];
  const code = first?.code ?? (first?.id === 'alpha' ? 'COMPOSITION_ALPHA_MISMATCH' : 'COMPOSITION_VERIFICATION_FAILED');
  const next = first?.code ? BUNDLE_NEXT[first.code] : first?.id === 'alpha' ? ALPHA_NEXT : '按 checks 里失败的项改正代码包再试';
  return new ToolError(code, `代码包没有通过验证：${failed.map((c) => `${c.id}${c.detail ? `（${c.detail}）` : ''}`).join('；')}`, {
    checks: report.checks,
    next,
  });
}

/** 代码包运行时的错误换成工具错误：错误码原样，带 details 与下一步。 */
function toolError(error: unknown): unknown {
  if (!(error instanceof CodeBundleError)) return error;
  return new ToolError(error.code, error.message, {
    ...(error.details !== undefined ? { details: error.details } : {}),
    next: BUNDLE_NEXT[error.code],
  });
}

/** 当前的视频：镜像里的最新状态，镜像不在时用打开时的快照。 */
function current(videos: VideoService, opened: VideoOpenResult): VideoSnapshot {
  return videos.mirror(opened.ref.videoId)?.video ?? opened.snapshot.video;
}

async function writeAtomically(file: string, data: Buffer): Promise<void> {
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file).catch(async (error: unknown) => {
    await fs.rm(tmp, { force: true });
    throw error;
  });
}

/** 文件名里用的 ID：只留字母、数字与 . _ -。 */
function safeName(text: string): string {
  return text.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100) || 'bundle';
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
