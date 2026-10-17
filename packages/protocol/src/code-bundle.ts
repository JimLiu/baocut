import type { Id } from './domain.ts';
import type { AssetRecord, CodeEdit, CompositionItem, MediaTime, Rate, Revision, VersionRef } from './video.ts';
import type { MediaHandle } from './methods.ts';

/**
 * 代码包（代码包规范 §2、§6、§7；架构设计 §8）的线上类型。
 *
 * 清单的语义以代码包规范为准，这里是按它手写的镜像；验证报告、烘焙记录与错误码是第一期（导入、验证、取帧、烘焙）
 * 在 Runtime 与客户端之间传递的形状。
 */

export const CODE_BUNDLE_FORMAT = 'baocut.code-bundle';
export const CODE_BUNDLE_SCHEMA_VERSION = 1;

/**
 * 浏览器作者合同的标识（代码包规范 §4.1、§4.7）。
 *
 * - `baocut/1`：BaoCut 自己的合同，页面在 `window.__baocutCompositions[<compositionId>]` 上暴露 `AuthoredComposition`
 *   （`initialize` / `renderAt(time, params)` / `dispose`）。
 * - `hyperframes/1`：HyperFrames 的公开合同（Apache-2.0）：根元素带 `data-composition-id` 等 `data-*` 属性，
 *   `window.__timelines[<compositionId>]` 是暂停的、可 `seek(秒)` 的时间线。
 */
export const CODE_BUNDLE_CONTRACTS = ['baocut/1', 'hyperframes/1'] as const;
export type CodeBundleContract = (typeof CODE_BUNDLE_CONTRACTS)[number];

export interface CodeBundleFileEntry {
  /** 包内相对路径，`/` 分隔。 */
  path: string;
  /** 字节数。 */
  size: number;
  /** 小写十六进制。 */
  sha256: string;
}

/**
 * `contentHash` 的前缀。取值是 `'sha256-' + sha256(JSON.stringify(entries))`：`entries` 是按 `path` 排序的
 * `CodeBundleFileEntry[]`（键顺序 `path`、`size`、`sha256`，紧凑 JSON），不含 `CODE_BUNDLE_UNHASHED_FILES` 里的文件；
 * `files.manifest.json` 的内容就是这份 `entries`。
 */
export const CODE_BUNDLE_HASH_PREFIX = 'sha256-';

/**
 * 不参与 `contentHash` 的文件：清单与验证报告引用这个摘要，文件清单列出自己的摘要，三者都会循环。
 * 与 `skills/baocut/built-in-skills/motion-graphics/scripts/build-bundle.mjs` 写包的算法一致。
 */
export const CODE_BUNDLE_UNHASHED_FILES = ['bundle.manifest.json', 'files.manifest.json', 'verification.json'] as const;

export type CodeBundleRuntime =
  | { engine: 'browser'; contract: CodeBundleContract | string; entry: string; frameworkHints: string[] }
  | { engine: 'remotion'; entry: string; compositionId: string };

export type CodeBundleTimeDependency =
  | { kind: 'local-only' }
  | { kind: 'placement' }
  | { kind: 'cue-track'; ref: VersionRef }
  | { kind: 'sequence-clock' };

/** 代码包规范 §2.1。 */
export interface CodeBundleManifest {
  format: typeof CODE_BUNDLE_FORMAT;
  schemaVersion: typeof CODE_BUNDLE_SCHEMA_VERSION;
  bundleId: Id;
  revision: Revision;
  contentHash: string;
  runtime: CodeBundleRuntime;
  source: { filesManifest: string; dependencyLock: string; buildRecipe: string };
  intrinsic: { width: number; height: number; fps: Rate; durationFrames: number };
  output: { alpha: boolean; colorSpace: string; audio: 'none' | 'stems' | 'mixed' };
  timing: { access: 'random' | 'sequential' | 'checkpointed'; fixedStep?: Rate };
  timeDependencies?: CodeBundleTimeDependency[];
  parametersSchemaRef?: string;
  exposedLayers?: Array<{ id: Id; isolation: 'independent' | 'requires-backdrop' }>;
  permissions: { network: 'deny'; assetIds: Id[] };
}

/** 实测得到的能力（架构设计 §8.3）：与清单声明不一致时以这里为准。 */
export interface VerifiedCapabilities {
  contract: CodeBundleContract;
  /** 可以按任意顺序取帧；以乱序采样且同一时刻两次取帧相同为证。 */
  randomAccess: boolean;
  /** 实测有透明像素（清单声明 `output.alpha` 而实测全不透明时为 false）。 */
  alpha: boolean;
  audio: 'none' | 'stems' | 'mixed';
  /** 实际宽高、帧率与时长（来自清单与根元素的交叉核对）。 */
  width: number;
  height: number;
  fps: Rate;
  durationFrames: number;
  /** 执行环境：第一期只有 Electron 离屏窗口。 */
  host: 'electron-offscreen';
  /** 沙箱状态：网络是否被实际拦截。 */
  networkIsolated: boolean;
}

/** 一次取帧的票据（架构设计 §8.4 的第一期子集）。 */
export interface FrameTicket {
  requestId: Id;
  /** 导入前的预览还没有素材版本，为 null。 */
  bundleRef: VersionRef | null;
  compositionId: string;
  /** 合成内部的局部时间。 */
  localTime: MediaTime;
  /** 输出帧序号与帧率（按序列或导出帧率取帧，不是包的局部帧率）。 */
  frameIndex: number;
  fps: Rate;
  width: number;
  height: number;
  parametersHash: string;
  quality: 'draft' | 'interactive' | 'export-exact';
}

/** 取帧回执：实际采样到的时间与像素信息。 */
export interface FrameReceipt {
  requestId: Id;
  /** 页面回读到的实际时间（秒）。 */
  sampledSeconds: number;
  /** 请求时间（秒）。 */
  requestedSeconds: number;
  /** 末帧被夹到时长上。 */
  clampedToDuration: boolean;
  width: number;
  height: number;
  pixelFormat: 'rgba8' | 'png';
  alphaMode: 'straight' | 'opaque';
  /** 帧 bytes 的 sha256（小写十六进制），供确定性校验。 */
  sha256: string;
}

export type CodeBundleCheckId =
  | 'manifest'
  | 'files'
  | 'content-hash'
  | 'network-static'
  | 'network-runtime'
  | 'root'
  | 'timeline'
  | 'seek'
  | 'determinism'
  | 'alpha'
  | 'duration';

export interface CodeBundleCheck {
  id: CodeBundleCheckId;
  status: 'passed' | 'failed' | 'skipped';
  /** 失败时的错误码（`CodeBundleErrorCode`）。 */
  code?: CodeBundleErrorCode;
  detail?: string;
}

/** 代码包规范 §6.2 的验证报告（`verification.json`）。 */
export interface CodeBundleVerificationReport {
  format: 'baocut.code-bundle-verification';
  schemaVersion: 1;
  bundleId: Id;
  revision: Revision;
  contentHash: string;
  verifiedAt: string;
  status: 'passed' | 'failed';
  capabilities: VerifiedCapabilities | null;
  checks: CodeBundleCheck[];
  /** 验证时取过的帧（时间与摘要），供复核。 */
  sampledFrames: Array<{ seconds: number; sha256: string }>;
}

/** 代码包规范 §7。 */
export interface BakeRecord {
  bakedAssetRef: VersionRef;
  sourceBundleRef: VersionRef;
  parameterValuesHash: string;
  timeMapHash: string;
  outputProfileHash: string;
  bakedAt: string;
  status: 'current' | 'stale';
  /** 烘焙输出的编码（ProRes 封进 QuickTime：带 alpha 时 4444，不透明时 422 HQ；编码器是 `prores_videotoolbox` 或 `prores_ks`）。 */
  encoding: { container: 'mov'; codec: string; pixelFormat: string; alpha: boolean; fps: Rate; frames: number };
}

/** 烘焙渲染器的选择（代码包规范 §7）：`auto` 先走指令、画不出来时整段回退像素；`ops` 只走指令；`pixels` 只走像素。 */
export type CompositionBakeMode = 'auto' | 'ops' | 'pixels';

/** 一次烘焙实际用的渲染器、用时与回退原因（`compositions.import` 结果的 `bake`，代码包规范 §7.3）。 */
export interface CompositionBakeInfo {
  /** `drawop-cpu`：录制 Canvas 调用、Render Worker 光栅；`browser-pixels`：浏览器逐帧截图。 */
  renderer: 'drawop-cpu' | 'browser-pixels';
  /** 整段烘焙的平均帧率（帧数 ÷ 总用时）。 */
  fps: number;
  seconds: number;
  /** `auto` 回退到像素时的原因（英文诊断）。 */
  fallback?: { reason: string };
  /** 指令路线各阶段的用时与吞吐（诊断用，字段可能增减）。 */
  stages?: Record<string, Record<string, number | string>>;
}

/** 预渲染素材 `provenance.origin` 的取值；`provenance.source` 是 `BakeRecord`。 */
export const BAKE_PROVENANCE_ORIGIN = 'composition-bake';

/**
 * 替身为什么不能代表实例现在的画面（代码包规范 §7.4）：`missing` 没有替身；`bundle-changed` 替身烘焙自别的代码包版本
 * （`BakeRecord.sourceBundleRef` 与实例 `source.assetRef` 所指清单的 `bundleId` / `revision` 不同）；`fps-mismatch` 替身的帧率与所在序列不同。
 */
export type PrerenderStaleReason = 'missing' | 'bundle-changed' | 'fps-mismatch';

export interface PrerenderStaleness {
  itemId: Id;
  reason: PrerenderStaleReason;
  /** 替身烘焙自哪个代码包版本（替身没有烘焙记录时省略）。 */
  bakedFrom?: VersionRef;
  /** 实例现在指向的代码包清单身份（`bundleId` / `revision`）。 */
  current?: VersionRef;
}

/**
 * 判断一个合成实例的替身是否过期（代码包规范 §7.4）。预览停住时、导出预检与智能体的检查共用这一处判断。
 * 替身的来源不是烘焙记录（旧数据、手工指定的视频）时只核对帧率：没有记录就不知道烘焙自哪个版本，不按过期处理。
 * 返回 null 表示替身可用。
 */
export function prerenderStaleness(
  item: Pick<CompositionItem, 'id' | 'source' | 'prerender'>,
  assets: Readonly<Record<Id, AssetRecord>>,
  sequenceFps: Rate,
): PrerenderStaleness | null {
  if (!item.prerender) return { itemId: item.id, reason: 'missing' };
  const standIn = assets[item.prerender.id]?.revisions[item.prerender.revision];
  if (!standIn) return { itemId: item.id, reason: 'missing' };
  const bundle = assets[item.source.assetRef.id]?.revisions[item.source.assetRef.revision]?.bundle as
    | { bundleId?: unknown; revision?: unknown }
    | undefined;
  const current =
    typeof bundle?.bundleId === 'string' && typeof bundle.revision === 'string' ? { id: bundle.bundleId, revision: bundle.revision } : undefined;
  const record = standIn.provenance.origin === BAKE_PROVENANCE_ORIGIN ? (standIn.provenance.source as BakeRecord | undefined) : undefined;
  if (record) {
    const from = record.sourceBundleRef;
    if (current && (from.id !== current.id || from.revision !== current.revision)) {
      return { itemId: item.id, reason: 'bundle-changed', bakedFrom: from, current };
    }
    if (record.encoding.fps.num * sequenceFps.den !== sequenceFps.num * record.encoding.fps.den) {
      return { itemId: item.id, reason: 'fps-mismatch', bakedFrom: from, ...(current ? { current } : {}) };
    }
    return null;
  }
  const rate = standIn.video?.frameRate;
  const fps = rate?.kind === 'cfr' ? rate.rate : rate?.nominal;
  if (fps && fps.num * sequenceFps.den !== sequenceFps.num * fps.den) {
    return { itemId: item.id, reason: 'fps-mismatch', ...(current ? { current } : {}) };
  }
  return null;
}

/** 后台烘焙任务（`JobRecord.bake`，`kind: 'bake'`）：给哪个实例烘、烘哪个代码包版本、按什么帧率与渲染器。 */
export interface CompositionBakeJob {
  sequenceId: Id;
  itemId: Id;
  /** 代码包素材的版本（实例的 `source.assetRef`）。 */
  bundle: VersionRef;
  /** 清单里的身份，写进 `BakeRecord.sourceBundleRef`。 */
  bundleId: string;
  manifestRevision: Revision;
  fps: Rate;
  mode: CompositionBakeMode;
}

/**
 * 编辑器实时合成层的桥（动效视频设计 §4.1；架构设计 §9.4）：舞台里的代码包跑在不开 `allow-same-origin` 的沙箱 `<iframe>` 里，
 * 父页面调不进去，取帧脚本（`composition-adapter.ts`）的三个调用改经 `postMessage` 往返。两端都只认带 `channel` 的消息，
 * 页面只认来自 `window.parent` 的、父页面只认来自那个 iframe 的 `contentWindow` 的；iframe 的来源是不透明的，`targetOrigin` 只能是 `*`。
 */
export const COMPOSITION_BRIDGE_CHANNEL = 'baocut.composition-bridge/1';

/** 页面载入、桥就位时主动发一次：父页面从这时起才发请求。 */
export interface CompositionBridgeHello {
  channel: typeof COMPOSITION_BRIDGE_CHANNEL;
  kind: 'hello';
}

/** 父页面 → 页面：取帧脚本的一个调用；`id` 由父页面编，回信带回。 */
export type CompositionBridgeRequest =
  | {
      channel: typeof COMPOSITION_BRIDGE_CHANNEL;
      kind: 'ready';
      id: number;
      contract: CodeBundleContract;
      /** 省略时页面自己从根元素的 `data-composition-id` 取（没有就是 `main`，与导入时的 `readRootAttributes` 同一规则）。 */
      compositionId?: string;
      timeoutMs: number;
      context: { width: number; height: number; fps: Rate; durationFrames: number };
    }
  | { channel: typeof COMPOSITION_BRIDGE_CHANNEL; kind: 'seek'; id: number; seconds: number }
  | { channel: typeof COMPOSITION_BRIDGE_CHANNEL; kind: 'dispose'; id: number };

/** 页面 → 父页面：取帧脚本的信封原样带回（`{ ok: true, value }` 或 `{ ok: false, code, message }`）。 */
export interface CompositionBridgeResponse {
  channel: typeof COMPOSITION_BRIDGE_CHANNEL;
  kind: 'result';
  id: number;
  result: { ok: true; value: unknown } | { ok: false; code: CodeBundleErrorCode | string; message: string };
}

export type CompositionBridgeMessage = CompositionBridgeHello | CompositionBridgeRequest | CompositionBridgeResponse;

/** 收到的 `message` 事件的 `data` 是不是这座桥的消息（别的来源与别的脚本的 `postMessage` 一律不认）。 */
export function isCompositionBridgeMessage(data: unknown): data is CompositionBridgeMessage {
  return typeof data === 'object' && data !== null && (data as { channel?: unknown }).channel === COMPOSITION_BRIDGE_CHANNEL;
}

export const CODE_BUNDLE_ERROR_CODES = [
  // 导入与验证（§6.2）
  'BUNDLE_MANIFEST_INVALID',
  'BUNDLE_FILE_NOT_ALLOWED',
  'BUNDLE_SYMLINK',
  'BUNDLE_TOO_LARGE',
  'BUNDLE_NETWORK_REFERENCE',
  'BUNDLE_HASH_MISMATCH',
  'BUNDLE_ENTRY_MISSING',
  'BUNDLE_CONTRACT_UNSUPPORTED',
  // 执行与取帧（§4、架构设计 §8.4）
  'COMPOSITION_ROOT_MISSING',
  'COMPOSITION_TIMELINE_MISSING',
  'COMPOSITION_SEEK_MISMATCH',
  'COMPOSITION_INTRINSIC_MISMATCH',
  'COMPOSITION_NONDETERMINISTIC',
  'COMPOSITION_NETWORK_BLOCKED',
  'COMPOSITION_SCRIPT_ERROR',
  'COMPOSITION_RENDER_TIMEOUT',
  'COMPOSITION_HOST_UNAVAILABLE',
] as const;
export type CodeBundleErrorCode = (typeof CODE_BUNDLE_ERROR_CODES)[number];

/** 包的大小上限（代码包规范 §6.2）。 */
export const CODE_BUNDLE_LIMITS = {
  maxFiles: 4096,
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxPathLength: 512,
} as const;

/** 允许进入包的文件扩展名（小写，含点）。 */
export const CODE_BUNDLE_ALLOWED_EXTENSIONS = [
  '.html',
  '.htm',
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.json',
  '.map',
  '.txt',
  '.md',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.avif',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.mp3',
  '.wav',
  '.ogg',
  '.m4a',
  '.mp4',
  '.webm',
  '.mov',
  '.wasm',
  '.lock',
  // 3D 资源（Three.js 等）：glTF 的 JSON 与二进制、分离的缓冲、HDR 环境贴图、KTX2 压缩纹理
  '.gltf',
  '.glb',
  '.bin',
  '.hdr',
  '.ktx2',
] as const;

/**
 * `seek` 后回读时间允许的误差（秒）：采样帧率下的半帧，即 1 / (2 × fps)（代码包规范 §4.7）。
 * fps 取取帧票据的 `fps`；没有票据时取包的 `intrinsic.fps`。30 fps 为 1/60 s。
 */
export function seekToleranceSeconds(fps: Rate): number {
  return fps.den / (2 * fps.num);
}

// ---- 界面直接预览与导入代码画面（`compositions.preview`、`compositions.import`；与工具 compositions_preview / compositions_import 同一个服务）----

/** 内联包文件的上限：单个文件的字节数与文件个数（智能体手写的网页与脚本，不是素材库）。一次 RPC 请求另受网关 4 MiB 帧上限约束。 */
export const COMPOSITION_INLINE_LIMITS = { maxFiles: 200, maxFileBytes: 4 * 1024 * 1024 } as const;
/** 一次预览最多取几帧（与 `videos_frames` 相同）。 */
export const COMPOSITION_PREVIEW_MAX_FRAMES = 24;

/** 内联的一个包文件：包内相对路径（`/` 分隔）加文本或 base64 内容，二选一。 */
export interface CompositionInlineFile {
  path: string;
  content?: string;
  contentBase64?: string;
}

/** 包里没有 `bundle.manifest.json` 时生成清单用的覆盖项（`durationSeconds` 要和 `fps` 一起给）。 */
export interface CompositionManifestOverrides {
  width?: number;
  height?: number;
  fps?: number;
  durationSeconds?: number;
  alpha?: boolean;
  bundleId?: string;
  revision?: string;
  entry?: string;
  contract?: CodeBundleContract;
}

/**
 * `compositions.preview`：在离屏浏览器里按合成内部的时刻取代码画面的帧。代码包给内联文件（`files`）、目录（`path`，相对视频的
 * 来源目录——项目目录或不属于项目的会话的工作目录——且只能在它里面）或这个视频里已经导入的代码包素材（`assetId`），三者给且只给一个。
 * `at` 是十进制秒字符串，超过时长的夹到末帧。视频要已经打开。不改视频、不验证、不烘焙。
 */
export interface CompositionPreviewParams {
  video: Id;
  files?: CompositionInlineFile[];
  path?: string;
  assetId?: Id;
  at: string[];
  compositionId?: string;
  manifest?: CompositionManifestOverrides;
}

/**
 * 预览的一帧。PNG 写在来源目录的 `.baocut-out/frames/<videoId>/` 下（与智能体的 compositions_preview 同一个位置，同一时刻再取时覆盖），
 * `media` 是它的受限读取句柄（同 `media.resolve`），`media.url` 可以直接当图片地址用。帧是代码包自己的画面（透明处保留透明），
 * 不是与视频合成后的画面。
 */
export interface CompositionPreviewFrame {
  at: string;
  /** 页面回读到的实际时间（秒）。 */
  sampledSeconds: number;
  /** 请求的时刻超过时长，夹到了末帧。 */
  clamped: boolean;
  /** PNG 的 sha256：两次取同一时刻摘要相同才说明画面是确定的。 */
  sha256: string;
  width: number;
  height: number;
  media: MediaHandle;
}

export interface CompositionPreviewResult {
  videoId: Id;
  bundleId: string;
  compositionId: string;
  width: number;
  height: number;
  durationSeconds: number;
  alpha: boolean;
  frames: CompositionPreviewFrame[];
}

/**
 * `compositions.import`：把代码包导入视频——验证、按视频根序列的帧率烘焙成带透明的预渲染，代码包与预渲染作为素材收进视频
 * （第一笔修改），再放一个合成片段（第二笔修改，可以分别撤销）。`files` 与 `path` 给且只给一个（`path` 的约束同预览）；
 * `register: true` 时只验证并登记代码包素材。`revision` 不一致时不导入；`commandId` 重试时带同一个值不会重复提交（第二笔用
 * `<commandId>-place`）。给了 `conversationId` 时，每一笔修改在这个会话里放一张变更卡。烘焙可能要几分钟，客户端调用时放宽超时。
 *
 * `replace.itemId` 指向时间线上已有的合成片段时，第二笔不新放片段，而是用 `replaceCodeBundle` 原地换它的代码包版本与预渲染
 * （代码包规范 §3.3）：片段 ID、轨道、起点、几何、效果、关键帧等不变，长度跟新的预渲染走。与 `place`、`register` 互斥。
 */
export interface CompositionImportParams {
  video: Id;
  files?: CompositionInlineFile[];
  path?: string;
  name?: string;
  compositionId?: string;
  manifest?: CompositionManifestOverrides;
  place?: { track?: Id; at?: string };
  replace?: { itemId: Id };
  register?: boolean;
  /** 烘焙渲染器，缺省 `auto`。 */
  bake?: CompositionBakeMode;
  /**
   * true 时烘焙转为后台任务（`kind: 'bake'`，代码包规范 §7.5）：两笔修改只登记代码包、按清单的长度放实例（没有替身），
   * 立刻返回 `bakeJobId`；任务完成后以一笔修改写入替身并把实例的 `prerender` 指过去。缺省 false（等烘焙完再返回）。
   * 与 `register` 互斥。
   */
  background?: boolean;
  revision?: Revision;
  commandId?: Id;
  conversationId?: Id;
}

export interface CompositionImportResult {
  status: 'committed';
  videoId: Id;
  revision: { before: Revision; after: Revision };
  bundle: {
    assetId: Id;
    revision: Revision;
    bundleId: string;
    manifestRevision: Revision;
    contentHash: string;
    contract: CodeBundleContract;
    compositionId: string;
    width: number;
    height: number;
    fps: Rate;
    durationFrames: number;
    durationSeconds: number;
    bytes: number;
    files: number;
    synthesizedManifest: boolean;
  };
  capabilities: VerifiedCapabilities;
  verification: { status: CodeBundleVerificationReport['status']; checks: CodeBundleCheck[] };
  /** 只登记时为 null。 */
  prerender: {
    assetId: Id;
    revision: Revision;
    frames: number;
    fps: Rate;
    encoding: BakeRecord['encoding'];
    hasAlpha: boolean;
  } | null;
  /** 烘焙用的渲染器与用时；回退到像素时带 `fallback.reason`。只登记与后台烘焙时为 null。 */
  bake: CompositionBakeInfo | null;
  /** 后台烘焙（`background: true`）的任务；同步烘焙与只登记时为 null。 */
  bakeJobId: Id | null;
  /** 放到时间线上（或原地替换）的合成片段与它所在的轨；只登记时为 null。 */
  itemId: Id | null;
  trackId: Id | null;
  /** 片段在时间线上的位置（根序列的帧与秒）；只登记时为 null。 */
  item: CompositionPlacement | null;
  /** 给了 `replace` 时：换掉的旧版本与前后的长度（回执 `impact.codeEdits` 的那一项）。 */
  replaced?: CodeEdit;
}

export interface CompositionPlacement {
  itemId: Id;
  trackId: Id;
  fromFrame: number;
  durationFrames: number;
  startSeconds: number;
  endSeconds: number;
}
