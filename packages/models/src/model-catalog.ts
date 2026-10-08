import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  ModelBackend,
  ModelBundleReason,
  ModelBundleState,
  ModelBundleStatus,
  ModelComponentStatus,
  ModelInstallProgress,
} from '@baocut/protocol';
import { ModelsModelCatalog as M } from '@baocut/protocol/messages/models/model-catalog.ts';
import {
  backendSupported,
  candleResidentBytes,
  defaultTranscribeBundle,
  platformBundles,
  requiredSources,
  type BundleComponentSource,
  type BundleDefinition,
} from './bundle-registry.ts';
import { readInstallRecord } from './install-record.ts';
import { stagedBytes } from './model-staging.ts';
import { modelDetail, type ModelText } from './model-text.ts';
import { REPO_MANIFESTS, repoManifestFor, weightBytes, type RepoManifestSpec } from './repo-manifests.ts';
import type { BundleComponent, ModelBundle, ModelFiles } from './worker-contract.ts';

/**
 * 本地模型目录（架构设计 §6.3；Model Worker 协议规范 §4）。
 *
 * 布局：`<models-root>/<owner>/<repo>/`，每个仓库目录带 `.bcut-manifest.json`（与旧版 BaoCut 的下载器兼容）。
 * `installed` 只要求清单存在、`revision` 与登记一致、列出的每个文件都存在且大小相符；sha256 的校验是单独的
 * `verify()`，结果缓存在内存里——不在每次查询状态时把几百 MB 读一遍。
 *
 * Worker 的运行状态（`loading` / `ready` / `busy` / `unloading`）由 Worker 池经 `setRuntimeState` 告知；
 * 加载失败与反复崩溃经 `block` 记下，`enable` 清掉。安装与修复的进度由安装任务经 `setInstallState` 告知（`downloading`）。
 *
 * 状态按组件算：部分组件装好、另一些缺失时是 `not-installed` / `incomplete`，`components` 列出每个组件；暂存区里留着
 * 没下完的部分时带 `install.state: 'paused'`。这些状态的变化经 `onChange` 通知（`models` 主题的 `bundle.updated`）。
 */

export const MANIFEST_FILE = '.bcut-manifest.json';
/** 分离模型包加载后的权重是文件的几倍：16 位存、32 位算（HTDemucs-FT 实测 673 MB 对 336 MB）。 */
const SEPARATE_LOADED_WEIGHT_FACTOR = 2;

export interface BcutManifest {
  format_version: 1;
  repo: string;
  revision: string;
  source?: string;
  files: Array<{ path: string; size: number; sha256: string; source_verified?: boolean }>;
}

export interface ModelCatalogOptions {
  /** 模型目录的根。见 `resolveModelsRoot`。 */
  root: string;
  /** 换掉内置的模型包登记（测试用）：原样登记，不按平台筛。不给时用 `platformBundles` 筛过的内置登记。 */
  bundles?: readonly BundleDefinition[];
  platform?: NodeJS.Platform;
  arch?: string;
  /** 有没有 Model Worker 可执行文件。没有时已安装的模型包显示为 `error` / `worker-missing`。 */
  workerAvailable?: () => boolean;
  /** 交给 Worker 的 CPU 线程数上限。默认取可用核数减二，至少 1、至多 8。 */
  threads?: number;
  /** 换掉内置的仓库清单（测试用）：暂停的安装据它报告总字节数。 */
  manifests?: readonly RepoManifestSpec[];
}

export type RuntimeBundleState = 'loading' | 'ready' | 'busy' | 'unloading';

/** Model Worker 加载一个识别模型包之后约常驻多少（文生图模型包是峰值，见 `imagePeak`）、计在哪个池里（架构设计 §6.5、§7.7）。 */
export interface WorkerFootprint {
  /**
   * 约常驻的字节数：MLX、Core ML 按存储字节；candle 按位宽换算（`candleResidentBytes`）；GGML 是 Whisper 权重的存储字节
   * （whisper.cpp 按量化原样加载）加上 candle 的 VAD 与对齐器。
   */
  bytes: number;
  /**
   * `gpuMemory`：权重在 GPU 上（Metal 的统一内存、CUDA 或 Vulkan 的显存）；`memory`：candle 或 GGML 在 CPU 上跑，权重在进程
   * 内存里。
   */
  pool: 'gpuMemory' | 'memory';
}

export interface VerifyResult {
  ok: boolean;
  problems: Array<{ repo: string; path: string; problem: 'missing' | 'size-mismatch' | 'hash-mismatch' }>;
  verifiedAt: string;
}

interface DiskCheck {
  ok: boolean;
  reason?: ModelBundleReason;
  detail?: ModelText;
  /** 齐全时清单里的大小之和。 */
  bytes?: number;
}

/**
 * 模型目录的根（架构设计 §6.3）：环境变量 `BAOCUT_MODELS_DIR` 优先，其次设置 `models.dir`（`setting`），都没有时
 * `<runtime-home>/models`。
 */
export function resolveModelsRoot(runtimeHomeRoot: string, env: NodeJS.ProcessEnv = process.env, setting: string | null = null): string {
  return resolveModelsDir(runtimeHomeRoot, env, setting).path;
}

/** 同 `resolveModelsRoot`，另说明来源：`env`、`setting` 或 `default`。 */
export function resolveModelsDir(
  runtimeHomeRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  setting: string | null = null,
): { path: string; source: 'env' | 'setting' | 'default'; defaultPath: string } {
  const defaultPath = path.join(runtimeHomeRoot, 'models');
  if (env.BAOCUT_MODELS_DIR) return { path: path.resolve(env.BAOCUT_MODELS_DIR), source: 'env', defaultPath };
  if (setting && path.resolve(setting) !== defaultPath) return { path: path.resolve(setting), source: 'setting', defaultPath };
  return { path: defaultPath, source: 'default', defaultPath };
}

/** 读一个仓库目录的清单；缺失或不合形状时返回 null。 */
export async function readManifest(repoDir: string): Promise<BcutManifest | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(path.join(repoDir, MANIFEST_FILE), 'utf8'));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (m.format_version !== 1 || typeof m.repo !== 'string' || typeof m.revision !== 'string' || !Array.isArray(m.files)) return null;
  for (const file of m.files as unknown[]) {
    if (typeof file !== 'object' || file === null) return null;
    const f = file as Record<string, unknown>;
    if (typeof f.path !== 'string' || !safeRelative(f.path)) return null;
    if (!Number.isSafeInteger(f.size) || (f.size as number) < 0) return null;
    if (typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256)) return null;
  }
  return raw as BcutManifest;
}

export class ModelCatalog {
  #root: string;
  /** 正在移动模型目录：模型包都报告为 `error` / `relocating`，不能提交任务，也不交出文件。 */
  #relocating = false;
  readonly #bundles: Map<string, BundleDefinition>;
  readonly #platform: NodeJS.Platform;
  readonly #arch: string;
  readonly #workerAvailable: () => boolean;
  readonly #threads: number;
  readonly #runtime = new Map<string, RuntimeBundleState>();
  readonly #blocked = new Map<string, { state: 'not-installed' | 'error'; reason: ModelBundleReason; detail?: ModelText }>();
  readonly #verified = new Map<string, VerifyResult>();
  readonly #install = new Map<string, ModelInstallProgress>();
  readonly #listeners = new Set<(bundleId: string) => void>();
  readonly #manifests: readonly RepoManifestSpec[];
  /** Worker 握手报告的设备（按后端，首选的在前）：candle 模型包据此报告并使用 `cuda` 或 `cpu`，GGML 的 `cuda` / `vulkan` 或 `cpu`。 */
  readonly #workerDevices = new Map<ModelBackend, string>();

  constructor(options: ModelCatalogOptions) {
    this.#root = options.root;
    this.#platform = options.platform ?? process.platform;
    this.#arch = options.arch ?? process.arch;
    this.#bundles = new Map((options.bundles ?? platformBundles(this.#platform, this.#arch)).map((b) => [b.bundleId, b]));
    this.#workerAvailable = options.workerAvailable ?? (() => true);
    this.#threads = options.threads ?? Math.max(1, Math.min(8, os.availableParallelism() - 2));
    this.#manifests = options.manifests ?? REPO_MANIFESTS;
  }

  /** 模型目录的根。`setRoot` 之后读到的是新的目录（安装、暂存区、安装记录都跟着它）。 */
  get root(): string {
    return this.#root;
  }

  /**
   * 换模型目录（`models.setDir`，架构设计 §6.3）。调用方先确认没有任务在用、Worker 都已卸下。换过之后，各模型包按新目录里的
   * 文件重算：清掉校验结果、停用记录与运行状态，逐个通知（`models` 主题的 `bundle.updated`）。
   */
  setRoot(root: string): void {
    this.#root = root;
    this.#verified.clear();
    this.#blocked.clear();
    this.#runtime.clear();
    for (const bundleId of this.#bundles.keys()) this.changed(bundleId);
  }

  /** 正在移动模型目录（开始与结束时各调一次）：期间模型包都不可用。 */
  setRelocating(relocating: boolean): void {
    if (this.#relocating === relocating) return;
    this.#relocating = relocating;
    for (const bundleId of this.#bundles.keys()) this.changed(bundleId);
  }

  get relocating(): boolean {
    return this.#relocating;
  }

  /** 全部登记的模型包。 */
  definitions(): BundleDefinition[] {
    return [...this.#bundles.values()];
  }

  /** 一个模型包的状态可能变了（运行状态、安装进度、文件、自检）。监听者自己再读 `status`。 */
  onChange(listener: (bundleId: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** 通知监听者：文件或记录变了（安装、删除、自检之后由调用方告知）。 */
  changed(bundleId: string): void {
    for (const listener of this.#listeners) {
      try {
        listener(bundleId);
      } catch {
        // 监听者自己的错误不影响状态。
      }
    }
  }

  /** 安装任务告知进度；null 表示没有安装在进行（回到按文件判断的状态）。 */
  setInstallState(bundleId: string, progress: ModelInstallProgress | null): void {
    if (progress) this.#install.set(bundleId, { ...progress });
    else this.#install.delete(bundleId);
    this.changed(bundleId);
  }

  installState(bundleId: string): ModelInstallProgress | null {
    return this.#install.get(bundleId) ?? null;
  }

  /** 一个组件（仓库与版本）在磁盘上齐不齐：清单、版本、每个文件存在且大小相符。 */
  async componentInstalled(source: Pick<BundleComponentSource, 'repo' | 'revision'>): Promise<boolean> {
    return (await this.#checkComponent(source)).ok;
  }

  definition(bundleId: string): BundleDefinition | null {
    return this.#bundles.get(bundleId) ?? null;
  }

  /**
   * 交给 Worker 的组件：必需组件，加上此刻装好了的可选组件；识别模型包用的「说话人区分」模型包（`diarization`）装好了时，
   * 再带上它的组件（`segmentation` 与 `speaker`，架构设计 §6.6）。
   */
  async #workerComponents(def: BundleDefinition): Promise<Array<[BundleComponent, BundleComponentSource]>> {
    const out: Array<[BundleComponent, BundleComponentSource]> = [];
    for (const [name, source] of componentsOf(def)) {
      if (source.optional && !(await this.#checkComponent(source)).ok) continue;
      out.push([name, source]);
    }
    const pack = def.diarization ? this.#bundles.get(def.diarization) : undefined;
    if (pack && (await this.#packInstalled(pack))) {
      for (const [name, source] of componentsOf(pack)) if (!out.some(([n]) => n === name)) out.push([name, source]);
    }
    return out;
  }

  /** 一个模型包的必需组件都装好了（「说话人区分」模型包装没装好）。 */
  async #packInstalled(def: BundleDefinition): Promise<boolean> {
    for (const [, source] of componentsOf(def)) if (!source.optional && !(await this.#checkComponent(source)).ok) return false;
    return true;
  }

  /**
   * 识别模型包此刻能不能区分说话人：`native` 是自己区分（MOSS），`pack` 是它用的「说话人区分」模型包装好了，否则 `none`
   * （架构设计 §6.6）。不是识别模型包时 `none`。
   */
  async speakers(bundleId: string): Promise<'native' | 'pack' | 'none'> {
    const def = this.#bundles.get(bundleId);
    if (!def || def.capability !== 'transcribe') return 'none';
    if (def.components.asr?.family === 'moss-transcribe-diarize') return 'native';
    const pack = def.diarization ? this.#bundles.get(def.diarization) : undefined;
    return pack && (await this.#packInstalled(pack)) ? 'pack' : 'none';
  }

  /** 用这个「说话人区分」模型包的识别模型包（它装上或删掉之后，这些模型包空闲的 Worker 要重新加载才带上或去掉它的组件）。 */
  diarizationUsers(packId: string): string[] {
    return [...this.#bundles.values()].filter((b) => b.diarization === packId).map((b) => b.bundleId);
  }

  /**
   * 识别、分离与「说话人区分」模型包的 Model Worker 要加载多少权重（字节），用来估计它的内存需求：必需组件，加上此刻装好了的可选组件（没装的
   * Worker 不加载，不计）与装好了的「说话人区分」模型包的组件，按内置清单加起来。分离的权重存成 16 位、加载时升成 32 位，按文件的两倍算（HTDemucs-FT 实测常驻
   * 673 MB，文件 336 MB）。不认识的模型包、合成的模型包（按固定的需求，待实测）、有组件没有清单时 null。
   */
  async workerWeightBytes(bundleId: string): Promise<number | null> {
    const def = this.#bundles.get(bundleId);
    if (!def || (def.capability !== 'transcribe' && def.capability !== 'separate' && def.capability !== 'diarize')) return null;
    const sources = (await this.#workerComponents(def)).map(([, source]) => source);
    const bytes = weightBytes(sources, this.#manifests);
    return bytes !== null && def.capability === 'separate' ? bytes * SEPARATE_LOADED_WEIGHT_FACTOR : bytes;
  }

  /**
   * 识别、分离与「说话人区分」模型包的 Model Worker 加载后约常驻多少、在哪个池里（`workerWeightBytes` 同样的组件）。MLX、Core ML 是存储字节
   * （分离按两倍，见 `workerWeightBytes`）、计在 GPU 内存；candle 按设备换算：`cuda` 计在 GPU 内存，`cpu` 计在内存。candle 的
   * 分离在两种设备上都升成 f32（同 v2），同样按文件的两倍。GGML 的 Whisper 权重按存储字节，VAD 与对齐器在 candle 的 CPU 上按
   * `cpu` 换算，合计在设备不是 `cpu`（`cuda` 或 `vulkan`）时计在 GPU 内存、`cpu` 时计在内存（架构设计 §6.5）。合成只算 candle 的模型包（同样按设备换算）；
   * MLX 的合成模型包按固定的需求，null。不知道多大时 null。
   */
  async workerFootprint(bundleId: string): Promise<WorkerFootprint | null> {
    const def = this.#bundles.get(bundleId);
    const synthesizeOnCandle = def?.capability === 'synthesize' && def.backend === 'candle';
    const local = def?.capability === 'transcribe' || def?.capability === 'separate' || def?.capability === 'diarize';
    if (!def || (!local && !synthesizeOnCandle)) return null;
    const sources = (await this.#workerComponents(def)).map(([, source]) => source);
    if (def.backend === 'ggml') {
      const [asr, rest] = [sources.filter((s) => s.family === 'whisper-ggml'), sources.filter((s) => s.family !== 'whisper-ggml')];
      const whisper = weightBytes(asr, this.#manifests);
      const candle = this.#candleBytes('cpu', rest);
      if (whisper === null || candle === null) return null;
      return { bytes: whisper + candle, pool: this.#device(def) !== 'cpu' ? 'gpuMemory' : 'memory' };
    }
    if (def.backend !== 'candle') {
      const bytes = weightBytes(sources, this.#manifests);
      if (bytes === null) return null;
      return { bytes: def.capability === 'separate' ? bytes * SEPARATE_LOADED_WEIGHT_FACTOR : bytes, pool: 'gpuMemory' };
    }
    const device = this.#device(def);
    const pool = device === 'cuda' ? 'gpuMemory' : 'memory';
    if (def.capability === 'separate') {
      const bytes = weightBytes(sources, this.#manifests);
      return bytes === null ? null : { bytes: bytes * SEPARATE_LOADED_WEIGHT_FACTOR, pool };
    }
    const bytes = this.#candleBytes(device, sources);
    return bytes === null ? null : { bytes, pool };
  }

  /** 这些组件在 candle 的 `device` 上约常驻多少（`candleResidentBytes`）；有组件没有清单时 null。 */
  #candleBytes(device: string, sources: readonly BundleComponentSource[]): number | null {
    const components: Parameters<typeof candleResidentBytes>[1][number][] = [];
    for (const source of sources) {
      const bytes = weightBytes([source], this.#manifests);
      if (bytes === null) return null;
      components.push({
        bytes,
        ...(source.weightBits ? { weightBits: source.weightBits } : {}),
        ...(source.parameters ? { parameters: source.parameters } : {}),
      });
    }
    return candleResidentBytes(device, components);
  }

  /**
   * 文生图模型包的 Model Worker 峰值、在哪个池里（架构设计 §6.5）：按模型包登记的实测峰值（`image.peakBytes`，Worker 报告的
   * 设备在 `image.devicePeakBytes` 里时用那个值）。MLX 与 candle 的 CUDA 计在 GPU 内存，candle 的 CPU 计在内存。不是文生图
   * 模型包时 null。
   */
  imagePeak(bundleId: string): WorkerFootprint | null {
    const def = this.#bundles.get(bundleId);
    if (!def?.image) return null;
    const device = this.#device(def);
    const bytes = def.image.devicePeakBytes?.[device] ?? def.image.peakBytes;
    return { bytes, pool: def.backend === 'candle' && device !== 'cuda' ? 'memory' : 'gpuMemory' };
  }

  /** 这台机器上的默认转写模型包（Apple Silicon 是 MLX 的，别的平台是 candle 的）。 */
  defaultTranscribeBundle(): string {
    return defaultTranscribeBundle(this.#platform, this.#arch);
  }

  /**
   * Worker 握手报告了一个后端的设备（首选的在前；后端不可用时传 null）。candle 与 GGML 模型包的状态与交给 Worker 的设备随它：
   * candle 有 CUDA 时是 `cuda`，GGML 有 GPU 时是 `cuda` 或 `vulkan`（CUDA 安装包是 `cuda`，Vulkan 安装包是 `vulkan`），否则是登记的
   * `cpu`。MLX 与 Core ML 的设备是登记好的，不受影响。
   */
  setWorkerDevice(backend: ModelBackend, device: string | null): void {
    if (!followsWorkerDevice(backend)) return;
    const before = this.#workerDevices.get(backend) ?? null;
    if (device === before) return;
    if (device) this.#workerDevices.set(backend, device);
    else this.#workerDevices.delete(backend);
    for (const def of this.#bundles.values()) if (def.backend === backend) this.changed(def.bundleId);
  }

  #device(def: BundleDefinition): string {
    return (followsWorkerDevice(def.backend) ? this.#workerDevices.get(def.backend) : undefined) ?? def.device;
  }

  async list(): Promise<ModelBundleStatus[]> {
    return Promise.all([...this.#bundles.keys()].map((bundleId) => this.status(bundleId) as Promise<ModelBundleStatus>));
  }

  /** 一个模型包此刻的状态；不认识的模型包返回 null。 */
  async status(bundleId: string): Promise<ModelBundleStatus | null> {
    const def = this.#bundles.get(bundleId);
    if (!def) return null;
    const base = {
      bundleId,
      capability: def.capability,
      backend: def.backend,
      device: this.#device(def),
      ...(def.label ? { label: def.label } : {}),
      ...(def.license ? { license: def.license } : {}),
      estimatedBytes: weightBytes(requiredSources(def), this.#manifests),
    };
    const checks = await Promise.all(
      componentsOf(def).map(async ([name, source]) => ({ name, source, check: await this.#checkComponent(source) })),
    );
    const components: ModelComponentStatus[] = checks.map(({ name, source, check }) => ({
      component: name,
      repo: source.repo,
      revision: source.revision,
      state: check.ok ? 'installed' : 'missing',
      bytes: check.ok ? (check.bytes ?? 0) : null,
      estimatedBytes: weightBytes([source], this.#manifests),
      sharedWith: this.#sharers(bundleId, source),
      ...(source.optional ? { optional: true } : {}),
      ...(source.license ? { license: source.license } : {}),
    }));
    // 缺可选的组件不影响装没装好；暂停的安装照样算上它在暂存区里的部分。
    const missingAny = checks.filter((c) => !c.check.ok);
    const required = checks.filter((c) => !c.source.optional);
    const missing = required.filter((c) => !c.check.ok);
    const install = this.#install.get(bundleId) ?? (missingAny.length > 0 ? await this.#paused(missingAny.map((c) => c.source)) : null);
    const selfTest = (await readInstallRecord(this.root)).bundles[bundleId]?.selfTest;
    const make = (state: ModelBundleState, reason?: ModelBundleReason, detail?: ModelText): ModelBundleStatus => ({
      ...base,
      state,
      ...(reason ? { reason } : {}),
      ...(detail ? modelDetail(detail) : {}),
      components,
      ...(install ? { install: { ...install } } : {}),
      ...(selfTest ? { selfTest } : {}),
    });
    if (!backendSupported(def.backend, this.#platform, this.#arch)) {
      return make('error', 'unsupported', M.backendUnsupported({ backend: def.backend, platform: this.#platform, arch: this.#arch }));
    }
    if (this.#relocating) return make('error', 'relocating', M.relocating());
    if (this.#install.has(bundleId)) return make('downloading');
    if (missing.length > 0 && missing.length < required.length) {
      // 组件列表先连成一串（参数不收数组）：各组件的原因只留当前语言的文本。
      const names = missing
        .map((c) => M.missingComponent({ name: c.name, detail: c.check.detail ?? c.source.repo }).text)
        .join(M.listSeparator().text);
      return make('not-installed', 'incomplete', M.incomplete({ names }));
    }
    if (missing.length > 0) return make('not-installed', missing[0]!.check.reason, missing[0]!.check.detail);
    const verified = this.#verified.get(bundleId);
    if (verified && !verified.ok) return make('not-installed', 'hash-mismatch', describeProblems(verified));
    const blocked = this.#blocked.get(bundleId);
    if (blocked) return make(blocked.state, blocked.reason, blocked.detail);
    if (!this.#workerAvailable()) return make('error', 'worker-missing', M.workerMissing());
    const runtime = this.#runtime.get(bundleId);
    return make(runtime ?? 'installed');
  }

  /**
   * Worker 交给 `model.load` 的模型包描述（协议规范 §4）。文件不齐时抛错。`device` 是这个 Worker 握手报告的设备（candle 的
   * `cuda` 或 `cpu`，GGML 的 `cuda` / `vulkan` 或 `cpu`）；不给时用 `setWorkerDevice` 记下的，再没有就用登记的。
   */
  async bundleFor(bundleId: string, options: { memoryBudgetBytes?: number | null; device?: string } = {}): Promise<ModelBundle> {
    const def = this.#bundles.get(bundleId);
    if (!def) throw new Error(M.noBundle({ bundleId }).text);
    if (this.#relocating) throw new Error(M.moving().text);
    const components: ModelBundle['components'] = {};
    // 没装好的可选组件不交给 Worker；装好了的「说话人区分」模型包的组件一并交给它。
    for (const [name, source] of await this.#workerComponents(def)) {
      const dir = this.repoDir(source.repo);
      const manifest = await readManifest(dir);
      if (!manifest || manifest.revision !== source.revision) throw new Error(M.notInstalled({ repo: source.repo }).text);
      const files: ModelFiles['files'] = manifest.files.map((f) => ({ path: f.path, sha256: f.sha256, byteLength: f.size }));
      components[name] = source.subdir
        ? scopedFiles(source.family, source.revision, dir, files, source.subdir)
        : { family: source.family, revision: source.revision, dir, files };
    }
    return {
      bundleId,
      backend: def.backend,
      device: options.device ?? this.#device(def),
      components,
      threads: this.#threads,
      memoryBudgetBytes: options.memoryBudgetBytes ?? null,
    };
  }

  /** 逐个文件算 sha256 并与清单比对。结果缓存在内存里，`status` 据此报告 `hash-mismatch`。 */
  async verify(bundleId: string): Promise<VerifyResult> {
    const def = this.#bundles.get(bundleId);
    if (!def) throw new Error(M.noBundle({ bundleId }).text);
    const problems: VerifyResult['problems'] = [];
    for (const [, source] of componentsOf(def)) {
      const dir = this.repoDir(source.repo);
      const manifest = await readManifest(dir);
      // 没装的可选组件不算问题。
      if (source.optional && manifest?.revision !== source.revision) continue;
      if (!manifest) {
        problems.push({ repo: source.repo, path: MANIFEST_FILE, problem: 'missing' });
        continue;
      }
      for (const file of manifest.files) {
        const full = path.join(dir, file.path);
        const stat = await fs.stat(full).catch(() => null);
        if (!stat?.isFile()) problems.push({ repo: source.repo, path: file.path, problem: 'missing' });
        else if (stat.size !== file.size) problems.push({ repo: source.repo, path: file.path, problem: 'size-mismatch' });
        else if ((await sha256File(full)) !== file.sha256) problems.push({ repo: source.repo, path: file.path, problem: 'hash-mismatch' });
      }
    }
    const result: VerifyResult = { ok: problems.length === 0, problems, verifiedAt: new Date().toISOString() };
    this.#verified.set(bundleId, result);
    return result;
  }

  repoDir(repo: string): string {
    return path.join(this.root, ...repo.split('/'));
  }

  /** Worker 池告知运行状态；null 表示没有 Worker 持有它（回到 `installed`）。 */
  setRuntimeState(bundleId: string, state: RuntimeBundleState | null): void {
    const before = this.#runtime.get(bundleId) ?? null;
    if (state) this.#runtime.set(bundleId, state);
    else this.#runtime.delete(bundleId);
    if (before !== state) this.changed(bundleId);
  }

  /** 加载失败或反复崩溃：不再自动拉起，直到 `enable`。 */
  block(bundleId: string, state: 'not-installed' | 'error', reason: ModelBundleReason, detail?: ModelText): void {
    this.#blocked.set(bundleId, { state, reason, ...(detail ? { detail } : {}) });
    this.#runtime.delete(bundleId);
    this.changed(bundleId);
  }

  blocked(bundleId: string): boolean {
    return this.#blocked.has(bundleId);
  }

  /** 用户重新启用：清掉加载失败、停用与校验的记录。 */
  enable(bundleId: string): void {
    this.#blocked.delete(bundleId);
    this.#verified.delete(bundleId);
    this.changed(bundleId);
  }

  async #checkComponent(source: Pick<BundleComponentSource, 'repo' | 'revision'>): Promise<DiskCheck> {
    const dir = this.repoDir(source.repo);
    const manifest = await readManifest(dir);
    if (!manifest) return { ok: false, reason: 'missing-manifest', detail: M.noManifest({ repo: source.repo }) };
    if (manifest.revision !== source.revision) {
      return { ok: false, reason: 'missing-manifest', detail: M.wrongRevision({ repo: source.repo, revision: source.revision.slice(0, 7) }) };
    }
    let bytes = 0;
    for (const file of manifest.files) {
      const stat = await fs.stat(path.join(dir, file.path)).catch(() => null);
      if (!stat?.isFile()) return { ok: false, reason: 'missing-file', detail: M.missingFile({ repo: source.repo, file: file.path }) };
      if (stat.size !== file.size) return { ok: false, reason: 'size-mismatch', detail: M.sizeMismatch({ repo: source.repo, file: file.path }) };
      bytes += file.size;
    }
    return { ok: true, bytes };
  }

  /** 同样用到这个组件（同一仓库与版本）的其他模型包。 */
  #sharers(bundleId: string, source: BundleComponentSource): string[] {
    return [...this.#bundles.values()]
      .filter((b) => b.bundleId !== bundleId && componentsOf(b).some(([, s]) => s.repo === source.repo && s.revision === source.revision))
      .map((b) => b.bundleId);
  }

  /** 缺的组件在暂存区里留下的部分：有时报告为暂停的安装。总字节数只在内置清单给出全部大小时才有。 */
  async #paused(sources: BundleComponentSource[]): Promise<ModelInstallProgress | null> {
    let received = 0;
    let total: number | null = 0;
    for (const source of sources) {
      received += await stagedBytes(this.root, source.repo, source.revision);
      const spec = repoManifestFor(source.repo, source.revision, this.#manifests);
      const sizes = spec?.files.map((f) => f.size) ?? [null];
      total = total === null || sizes.some((size) => size === null) ? null : total + sizes.reduce<number>((a, b) => a + (b ?? 0), 0);
    }
    if (received === 0) return null;
    return { jobId: null, state: 'paused', receivedBytes: received, totalBytes: total };
  }
}

/** 状态是否允许提交任务。 */
export function bundleUsable(status: ModelBundleStatus): boolean {
  return status.state !== 'not-installed' && status.state !== 'error' && status.state !== 'downloading';
}

/** 设备随 Worker 握手的后端：candle（`cuda` / `cpu`）与 GGML（`cuda` / `vulkan` / `cpu`）。 */
function followsWorkerDevice(backend: ModelBackend): boolean {
  return backend === 'candle' || backend === 'ggml';
}

function componentsOf(def: BundleDefinition): Array<[BundleComponent, BundleComponentSource]> {
  return Object.entries(def.components) as Array<[BundleComponent, BundleComponentSource]>;
}

/** 组件在仓库子目录里（`BundleComponentSource.subdir`）：目录是子目录，只带其下的文件，路径相对它。 */
function scopedFiles(
  family: ModelFiles['family'],
  revision: string,
  repoDir: string,
  files: ModelFiles['files'],
  subdir: string,
): ModelFiles {
  const prefix = `${subdir}/`;
  const scoped = files.filter((f) => f.path.startsWith(prefix)).map((f) => ({ ...f, path: f.path.slice(prefix.length) }));
  if (scoped.length === 0) throw new Error(M.noFilesInSubdir({ subdir }).text);
  return { family, revision, dir: path.join(repoDir, ...subdir.split('/')), files: scoped };
}

function safeRelative(file: string): boolean {
  if (file === '' || path.isAbsolute(file) || file.includes('\\')) return false;
  return file.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function describeProblems(result: VerifyResult): string {
  return result.problems
    .slice(0, 3)
    .map((p) => `${p.repo}/${p.path}: ${p.problem}`)
    .join('; ');
}

export async function sha256File(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
