import fs from 'node:fs/promises';
import path from 'node:path';
import type { ModelInstallPlan, ModelSelfTestResult } from '@baocut/protocol';
import { ModelsModelDownloader as MD } from '@baocut/protocol/messages/models/model-downloader.ts';
import { ModelsEmbedding as ME } from '@baocut/protocol/messages/models/embedding.ts';
import { ModelsModelInstaller as M } from '@baocut/protocol/messages/models/model-installer.ts';
import { requiredSources, type BundleComponentSource, type BundleDefinition, type ComponentReleaseAsset } from './bundle-registry.ts';
import { readInstallRecord, updateInstallRecord } from './install-record.ts';
import { MANIFEST_FILE, readManifest, sha256File, type BcutManifest, type ModelCatalog } from './model-catalog.ts';
import { DownloadError, ModelDownloader, diskFreeBytes, type DownloadFile } from './model-downloader.ts';
import { isModelScopeEndpoint, modelFileUrl, repoEndpoint } from './download-source.ts';
import { discardStaging, removeEmptyParents, stagedBytes, stagingDirOf } from './model-staging.ts';
import { dirAccess } from './models-dir.ts';
import {
  UNPACK_DIR,
  discardReleaseStaging,
  releaseSource,
  releaseStagedBytes,
  releaseStagingDir,
  releaseUrl,
} from './release-component.ts';
import { repoManifestFor, type RepoManifestSpec } from './repo-manifests.ts';
import { extractToolArchive } from './tool-archive.ts';

/**
 * 模型包的安装、修复与删除（架构设计 §6.3）。
 *
 * - 计划（`plan`）：逐个组件看磁盘上齐不齐。齐的组件不动（共享组件只装一份）；缺的组件只下载缺的文件——仓库目录里
 *   清单与哈希都对得上的文件复用，暂存区里核对过的文件不再下载，没下完的续传。修复（`repair`）把每个文件的 sha256
 *   读一遍，只重下坏的与缺的。内置清单缺可信哈希时拒绝（`MODEL_MANIFEST_INCOMPLETE`）。大小未知的文件向下载来源发
 *   HEAD 取大小（每个至多几秒，并行）；取不到时总字节数报告为未知，确认用估计值。
 * - 安装（`install`）：先查可用空间，再逐个组件下载、核对、发布；每个组件发布之后才是「已装好」，中途失败时已发布的组件
 *   保留，模型包报告为 `incomplete`，下次只补缺的。完成后把模型包记进安装记录。
 * - 删除（`remove`）：只删没有别的模型包持有的组件。持有者是用到同一仓库与版本、并且在安装记录里或文件齐全的模型包。
 *   仓库目录里是别的版本时不删（不属于这个模型包）。
 * - 存放位置（`dir`）：这次新下载的模型仓库放进给定的文件夹（`<dir>/<owner>/<repo>/`，暂存区在 `<dir>/.bcut-staging/`，发布照样是
 *   同一个卷上的改名），不给时放模型目录。开始下载一个仓库时就记下它的位置（`ModelCatalog.setLocation`），暂停的下载据此续传；
 *   暂停在某处的下载总在原处续传，这时整个计划都放那里（`plan.dir.fixed`）。修复在仓库所在的地方修。安装记录照旧在模型目录里。
 * - 发布页组件（`release`，LiteRT-LM 的 C 库）：按主机平台的压缩包下载（地址见 `release-component.ts`，不发 HEAD，大小取登记的），
 *   核对大小与 sha256，在进程内解开到暂存区（只取包根目录的普通文件，略过 `archive.skip`），没有登记的文件或解不开时删掉暂存、
 *   `MODEL_DOWNLOAD_INTEGRITY`；写好清单后原子地改名到 `<toolsDir>/<名字>/<版本>/`。修复时按清单核对 sha256，没有清单的重新下载
 *   压缩包。最后一个持有者删除时回收组件目录。
 */

export interface ModelInstallerOptions {
  catalog: ModelCatalog;
  /** 下载来源的基址；每次做计划时取一次。 */
  endpoint: () => string;
  fetch?: typeof fetch;
  /** 模型目录所在磁盘的可用空间（测试注入）。默认 `statfs`。 */
  freeBytes?: (dir: string) => Promise<number | null>;
  /** 换掉内置的仓库清单（测试用）。 */
  manifests?: readonly RepoManifestSpec[];
  /** 计划时用 HEAD 取未知的文件大小（默认是）。 */
  probeSizes?: boolean;
  /** 每个 HEAD 的期限（毫秒），默认 5 秒。 */
  headTimeoutMs?: number;
  retries?: number;
  backoffMs?: (attempt: number) => number;
  stallMs?: number;
  /**
   * 发布页组件的下载镜像（设置 `tools.downloadEndpoint` 或 `BAOCUT_TOOLS_ENDPOINT`）：给了时地址是 `<基址>/<名字>/<版本>/<文件名>`，
   * 否则是登记的官方地址。函数形式每次做计划时取一次。
   */
  toolsEndpoint?: string | null | (() => string | null);
}

/** 计划里的一个组件（内部形态，安装时照着做）。 */
export interface PlannedComponent {
  component: string;
  /** 已冻结的本次来源（发布页 null 为官方）。 */
  endpoint?: string | null;
  source: BundleComponentSource;
  action: 'keep' | 'download';
  /** 要下载的文件。 */
  fetch: DownloadFile[];
  /** 从仓库目录复用的好文件（修复与补齐时）。 */
  reuse: string[];
  /** 发布时清单要列出的全部文件。 */
  files: Array<{ path: string; sha256: string }>;
  /** 暂存区里已经收到的字节。 */
  staged: number;
  /** 还要下载的字节；有大小未知的文件时 null。 */
  bytes: number | null;
  estimatedBytes: number;
  /** 发布页组件：这台主机的压缩包与下载地址（`fetch` 里只有这个压缩包）。 */
  release?: { asset: ComponentReleaseAsset; url: string };
  /** 模型仓库的组件下载、暂存与发布到的根（其下是 `<owner>/<repo>/`）；发布页组件没有（在 `toolsDir`）。 */
  root?: string;
}

export interface InstallPlanDetail {
  plan: ModelInstallPlan;
  components: PlannedComponent[];
  endpoint: string;
  endpoints: Record<string, string | null>;
  /** 发布页组件的下载镜像；没有时 null（官方地址）。 */
  toolsEndpoint: string | null;
  repair: boolean;
  /** 请求的存放位置（`plan` 的 `dir`）；没给或就是模型目录时 null。开跑前重算计划时照用。 */
  dir: string | null;
  /** 进度的总字节数（含暂存区里已经收到的）；未知时 null。 */
  totalBytes: number | null;
}

export interface InstallProgress {
  phase: 'downloading' | 'publishing';
  receivedBytes: number;
  totalBytes: number | null;
}

export interface InstallOutcome {
  /** 这次发布的仓库清单。 */
  published: BcutManifest[];
  /** 这次实际收到的字节（不含续传前已有的）。 */
  downloadedBytes: number;
}

export class ModelInstaller {
  readonly #catalog: ModelCatalog;
  readonly #options: ModelInstallerOptions;
  /** 换掉的仓库清单（测试用）；没给时用模型目录的（内置的加上添加的模型包的，`ModelCatalog.manifests`）。 */
  readonly #manifestOverride: readonly RepoManifestSpec[] | null;
  readonly #freeBytes: (dir: string) => Promise<number | null>;
  readonly #fetch: typeof fetch;

  constructor(options: ModelInstallerOptions) {
    this.#catalog = options.catalog;
    this.#options = options;
    this.#manifestOverride = options.manifests ?? null;
    this.#freeBytes = options.freeBytes ?? diskFreeBytes;
    this.#fetch = options.fetch ?? fetch;
  }

  get root(): string {
    return this.#catalog.root;
  }

  #manifests(): readonly RepoManifestSpec[] {
    return this.#manifestOverride ?? this.#catalog.manifests;
  }

  async plan(
    bundleId: string,
    options: { repair?: boolean; endpoints?: Record<string, string | null>; dir?: string | null } = {},
  ): Promise<InstallPlanDetail> {
    const def = this.#definition(bundleId);
    const repair = options.repair ?? false;
    const endpoint = this.#options.endpoint();
    const toolsOption = this.#options.toolsEndpoint;
    const toolsEndpoint = (typeof toolsOption === 'function' ? toolsOption() : toolsOption) || null;
    const dir = options.dir && path.resolve(options.dir) !== path.resolve(this.root) ? path.resolve(options.dir) : null;
    // 暂停在某处的下载在原处续传：第一个这样的仓库决定整个计划放哪里。
    let fixed: string | null = null;
    for (const [, source] of componentsOf(def)) {
      if (source.release || source.local || fixed) continue;
      const at = this.#catalog.repoRoot(source.repo);
      if (!repair && (await stagedBytes(at, source.repo, source.revision)) > 0 && !(await this.#catalog.componentInstalled(source))) fixed = at;
    }
    const target = fixed ?? dir ?? this.root;
    const components: PlannedComponent[] = [];
    const endpoints: Record<string, string | null> = {};
    for (const [component, source] of componentsOf(def)) {
      const key = `${source.repo}@${source.revision}`;
      const selected = options.endpoints && Object.hasOwn(options.endpoints, key)
        ? options.endpoints[key]! : source.release ? toolsEndpoint : endpoint;
      endpoints[key] = selected;
      components.push({
        ...(source.local
          ? await this.#planLocal(component, source)
          : source.release
          ? await this.#planRelease(component, source, repair, selected)
          : await this.#planComponent(component, source, repair, selected ?? endpoint, await this.#rootFor(source, repair, target))),
        endpoint: selected,
      });
    }
    const access = await dirAccess(target);
    const downloading = components.filter((c) => c.action === 'download');
    const downloadBytes = downloading.some((c) => c.bytes === null) ? null : downloading.reduce((sum, c) => sum + (c.bytes ?? 0), 0);
    const estimatedBytes = downloading.reduce((sum, c) => sum + (c.bytes ?? c.estimatedBytes), 0);
    const resumedBytes = downloading.reduce((sum, c) => sum + c.staged, 0);
    const plan: ModelInstallPlan = {
      bundleId,
      components: components.map((c) => ({
        component: c.component,
        repo: c.source.repo,
        revision: c.source.revision,
        ...(c.source.release ? { origin: 'github-release' as const } : {}),
        action: c.action,
        files: c.fetch.map((f) => f.path),
        bytes: c.action === 'keep' ? 0 : c.bytes,
        source: this.#componentSource(c, endpoint, toolsEndpoint),
      })),
      downloadBytes,
      estimatedBytes,
      confirmBytes: downloadBytes ?? estimatedBytes,
      resumedBytes,
      availableBytes: await this.#freeBytes(target),
      source: this.#sourceOf(endpoint, toolsEndpoint, downloading),
      dir: {
        path: target,
        modelsDir: this.root,
        // 模型目录是否由环境变量锁定由 Runtime 填（安装器不读环境）。
        locked: false,
        fixed: fixed !== null,
        problem: !access.exists ? 'missing' : !access.writable ? 'not-writable' : null,
      },
      upToDate: downloading.length === 0,
    };
    return {
      plan,
      components,
      endpoint,
      endpoints,
      toolsEndpoint,
      repair,
      dir,
      totalBytes: downloadBytes === null ? null : downloadBytes + resumedBytes,
    };
  }

  /** 一个模型仓库这次放在哪个根：修复、已经装好、暂停在原处的在原处，其余放这次的位置。 */
  async #rootFor(source: BundleComponentSource, repair: boolean, target: string): Promise<string> {
    const at = this.#catalog.repoRoot(source.repo);
    if (repair || (await this.#catalog.componentInstalled(source))) return at;
    return (await stagedBytes(at, source.repo, source.revision)) > 0 ? at : target;
  }

  /** 照计划下载、核对、发布。信号中止时停下（暂存区保留，下次续传），抛出中止的原因。 */
  async install(
    detail: InstallPlanDetail,
    options: { signal: AbortSignal; onProgress?: (progress: InstallProgress) => void },
  ): Promise<InstallOutcome> {
    const { signal } = options;
    const onProgress = options.onProgress ?? (() => {});
    const downloading = detail.components.filter((c) => c.action === 'download');
    // 按落到的磁盘分别查可用空间（发布页组件照旧算在模型目录那边）。
    const needs = new Map<string, number>();
    for (const c of downloading) needs.set(c.root ?? this.root, (needs.get(c.root ?? this.root) ?? 0) + (c.bytes ?? c.estimatedBytes));
    for (const [root, required] of needs) {
      const available = await this.#freeBytes(root);
      if (available !== null && available < required) {
        throw new DownloadError('MODEL_DOWNLOAD_NO_SPACE', M.noSpace(), {
          requiredBytes: required,
          availableBytes: available,
        });
      }
    }
    let received = detail.plan.resumedBytes;
    let downloaded = 0;
    const report = (phase: InstallProgress['phase']) =>
      onProgress({ phase, receivedBytes: Math.max(0, received), totalBytes: detail.totalBytes });
    report('downloading');
    const published: BcutManifest[] = [];
    for (const component of downloading) {
      const root = component.root ?? this.root;
      const downloader = new ModelDownloader({
        root,
        endpoint: component.endpoint ?? detail.endpoint,
        fetch: this.#fetch,
        ...(this.#options.retries !== undefined ? { retries: this.#options.retries } : {}),
        ...(this.#options.backoffMs ? { backoffMs: this.#options.backoffMs } : {}),
        ...(this.#options.stallMs !== undefined ? { stallMs: this.#options.stallMs } : {}),
      });
      try {
        if (component.release) {
          const onBytes = (delta: number) => {
            received += delta;
            if (delta > 0) downloaded += delta;
            report('downloading');
          };
          published.push(await this.#installRelease(downloader, component, signal, onBytes, () => report('publishing')));
          this.#catalog.changed(detail.plan.bundleId);
          continue;
        }
        const { repo, revision } = component.source;
        // 先记下位置：中途停下时，暂停的下载按它找到暂存区、在原处续传。
        if (root !== this.root) {
          await this.#catalog.setLocation(repo, root);
          this.#catalog.changed(detail.plan.bundleId);
        }
        if (component.reuse.length > 0) await downloader.reuse(repo, revision, path.join(root, ...repo.split('/')), component.reuse);
        const sourceRepo = this.#sourceRepo(component.source);
        await downloader.download(
          repo,
          revision,
          component.fetch,
          signal,
          (delta) => {
            received += delta;
            if (delta > 0) downloaded += delta;
            report('downloading');
          },
          sourceRepo,
        );
        signal.throwIfAborted();
        report('publishing');
        published.push(await downloader.publish(repo, revision, component.files, sourceRepo));
        await this.#catalog.setLocation(repo, root);
        this.#catalog.changed(detail.plan.bundleId);
      } catch (error) {
        // 哪一部分没下成：前面下好的已经发布、留着，补齐时只下缺的（界面按它说「X 没下成」）。
        if (error instanceof DownloadError) Object.assign(error.details, { ...this.#failedPart(component, detail), ...error.details });
        throw error;
      }
    }
    await updateInstallRecord(this.root, (record) => {
      record.bundles[detail.plan.bundleId] = { installedAt: new Date().toISOString() };
    });
    return { published, downloadedBytes: downloaded };
  }

  /** 删除一个模型包独有的组件，保留别的模型包在用的。调用方先确认没有任务在用它。 */
  async remove(bundleId: string): Promise<{ removed: string[]; kept: Array<{ repo: string; usedBy: string[] }> }> {
    const def = this.#definition(bundleId);
    const record = await readInstallRecord(this.root);
    const removed: string[] = [];
    const kept: Array<{ repo: string; usedBy: string[] }> = [];
    for (const [, source] of componentsOf(def)) {
      // 原地引用的本机文件不是 BaoCut 下载的，删除模型包从不动它（只从列表移除，见 `models.unlist`）。
      if (source.local) continue;
      const holders = await this.#holders(bundleId, source, record.bundles);
      if (holders.length > 0) {
        kept.push({ repo: source.repo, usedBy: holders });
        continue;
      }
      await this.#discardStaging(source);
      const dir = this.#catalog.componentDir(source);
      const manifest = await readManifest(dir);
      if (manifest && manifest.revision !== source.revision) {
        kept.push({ repo: source.repo, usedBy: [] });
        continue;
      }
      if (!(await fs.stat(dir).catch(() => null))) continue;
      await fs.rm(dir, { recursive: true, force: true });
      await removeEmptyParents(path.dirname(dir), path.dirname(dir));
      if (!source.release) await this.#catalog.setLocation(source.repo, null);
      removed.push(source.repo);
    }
    await updateInstallRecord(this.root, (r) => {
      delete r.bundles[bundleId];
    });
    for (const other of [bundleId, ...this.#sharers(def)]) this.#catalog.changed(other);
    return { removed, kept };
  }

  /** 删掉一个模型包缺的组件在暂存区里留下的部分（`models.cancelInstall` 的 `discard`）。别的模型包正在共用的不删。 */
  async discard(bundleId: string, busy: (source: BundleComponentSource) => boolean = () => false): Promise<void> {
    const def = this.#definition(bundleId);
    for (const [, source] of componentsOf(def)) {
      if (busy(source) || source.local) continue;
      await this.#discardStaging(source);
      // 还没发布就丢掉了：位置记录跟着清掉，下次下载重新选。
      if (!source.release && !(await this.#catalog.componentInstalled(source))) await this.#catalog.setLocation(source.repo, null);
    }
    this.#catalog.changed(bundleId);
  }

  /** 记下自检结果（模型包状态的 `selfTest`）。 */
  async recordSelfTest(bundleId: string, result: ModelSelfTestResult): Promise<void> {
    await updateInstallRecord(this.root, (record) => {
      record.bundles[bundleId] = { ...(record.bundles[bundleId] ?? { installedAt: result.at }), selfTest: result };
    });
    this.#catalog.changed(bundleId);
  }

  /**
   * 原地引用的本机文件：没有可下载的来源，装好了就不动（修复也不动），文件不在或变了时拒绝，要重新添加（架构设计 §6.3）。
   */
  async #planLocal(component: string, source: BundleComponentSource): Promise<PlannedComponent> {
    if (!(await this.#catalog.componentInstalled(source))) {
      throw new DownloadError('MODEL_MANIFEST_INCOMPLETE', M.localFileGone({ file: path.basename(source.local!.path) }), { repo: source.repo });
    }
    return { component, source, action: 'keep', fetch: [], reuse: [], files: [], staged: 0, bytes: 0, estimatedBytes: 0 };
  }

  async #discardStaging(source: BundleComponentSource): Promise<void> {
    if (source.local) return;
    if (source.release) await discardReleaseStaging(this.#catalog.toolsDir, source.release);
    else await discardStaging(this.#catalog.repoRoot(source.repo), source.repo, source.revision);
  }

  /**
   * 发布页组件的计划：装好的不动；修复时有清单就按清单核对 sha256，好的不动，没有清单的重新下载。
   * 要下载的只有这台主机的压缩包，大小取登记的（不发 HEAD）；暂存区里已有的部分续传。这个平台没有压缩包时拒绝。
   */
  async #planRelease(component: string, source: BundleComponentSource, repair: boolean, toolsEndpoint: string | null): Promise<PlannedComponent> {
    const release = source.release!;
    const keep = (): PlannedComponent => ({
      component,
      source,
      action: 'keep',
      fetch: [],
      reuse: [],
      files: [],
      staged: 0,
      bytes: 0,
      estimatedBytes: 0,
    });
    const asset = this.#catalog.releaseAsset(source);
    if (!asset) {
      const platform = this.#catalog.platformKey;
      throw new DownloadError('MODEL_DOWNLOAD_SOURCE', ME.runtimeNoBuild({ platform }), { repo: source.repo, platform });
    }
    if (!repair && (await this.#catalog.componentInstalled(source))) return keep();
    if (repair) {
      const dir = this.#catalog.componentDir(source);
      const manifest = await readManifest(dir);
      if (manifest && manifest.revision === source.revision && (await intact(dir, manifest))) return keep();
    }
    const staged = await releaseStagedBytes(this.#catalog.toolsDir, release, asset);
    const bytes = Math.max(0, asset.size - staged);
    return {
      component,
      source,
      action: 'download',
      fetch: [{ path: asset.fileName, size: asset.size, sha256: asset.sha256 }],
      reuse: [],
      files: [],
      staged,
      bytes,
      estimatedBytes: bytes,
      release: { asset, url: releaseUrl(release, asset, toolsEndpoint) },
    };
  }

  /**
   * 下载、核对、解开、发布一个发布页组件，返回写进组件目录的清单。解不开、没有可执行文件或探测失败时不留半个目录，
   * 以 `MODEL_DOWNLOAD_INTEGRITY` 失败；中止时压缩包留在暂存区，下次续传。
   */
  async #installRelease(
    downloader: ModelDownloader,
    component: PlannedComponent,
    signal: AbortSignal,
    onBytes: (delta: number) => void,
    publishing: () => void,
  ): Promise<BcutManifest> {
    const { source } = component;
    const release = source.release!;
    const { asset, url } = component.release!;
    const toolsDir = this.#catalog.toolsDir;
    const stage = releaseStagingDir(toolsDir, release);
    await downloader.downloadUrl(stage, url, component.fetch[0]!, signal, onBytes);
    signal.throwIfAborted();
    publishing();
    const unpacked = path.join(stage, UNPACK_DIR);
    await fs.rm(unpacked, { recursive: true, force: true });
    await fs.mkdir(unpacked, { recursive: true });
    let names: string[];
    try {
      names = await extractToolArchive(path.join(stage, asset.fileName), asset.archive, unpacked, signal);
      if (!names.includes(asset.executable)) {
        throw new DownloadError('MODEL_DOWNLOAD_INTEGRITY', MD.executableMissing({ file: asset.fileName, executable: asset.executable }), {
          file: asset.fileName,
          executable: asset.executable,
        });
      }
    } catch (error) {
      if (signal.aborted) {
        await fs.rm(unpacked, { recursive: true, force: true });
        throw signal.reason ?? error;
      }
      await discardReleaseStaging(toolsDir, release);
      if (error instanceof DownloadError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOSPC') {
        throw new DownloadError('MODEL_DOWNLOAD_NO_SPACE', MD.diskFull(), { file: asset.fileName });
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new DownloadError('MODEL_DOWNLOAD_INTEGRITY', MD.archiveUnpackable({ file: asset.fileName, reason }), {
        file: asset.fileName,
        reason,
      });
    }
    const files: BcutManifest['files'] = [];
    for (const name of [...names].sort()) {
      const full = path.join(unpacked, name);
      files.push({ path: name, size: (await fs.stat(full)).size, sha256: await sha256File(full) });
    }
    const manifest: BcutManifest = { format_version: 1, repo: source.repo, revision: source.revision, source: url, files };
    await fs.writeFile(path.join(unpacked, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
    // 原子地换上：旧的组件目录（旧版装下的那一份，或修复前的）先挪开，换好再删。
    const target = this.#catalog.componentDir(source);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const aside = `${target}.old-${process.pid}-${Date.now()}`;
    const hadOld = (await fs.stat(target).catch(() => null)) !== null;
    if (hadOld) await fs.rename(target, aside);
    try {
      await fs.rename(unpacked, target);
    } catch (error) {
      if (hadOld) await fs.rename(aside, target).catch(() => {});
      throw error;
    }
    if (hadOld) await fs.rm(aside, { recursive: true, force: true });
    await discardReleaseStaging(toolsDir, release);
    return manifest;
  }

  async #planComponent(
    component: string,
    source: BundleComponentSource,
    repair: boolean,
    endpoint: string,
    root: string,
  ): Promise<PlannedComponent> {
    const keep = (): PlannedComponent => ({
      component,
      source,
      action: 'keep',
      fetch: [],
      reuse: [],
      files: [],
      staged: 0,
      bytes: 0,
      estimatedBytes: 0,
      root,
    });
    if (!repair && (await this.#catalog.componentInstalled(source))) return keep();
    const spec = repoManifestFor(source.repo, source.revision, this.#manifests());
    if (!spec) {
      throw new DownloadError('MODEL_MANIFEST_INCOMPLETE', M.noManifest({ repo: source.repo, revision: source.revision.slice(0, 7) }), {
        repo: source.repo,
      });
    }
    const unhashed = spec.files.filter((f) => !f.sha256 || !/^[0-9a-f]{64}$/.test(f.sha256)).map((f) => f.path);
    if (unhashed.length > 0) {
      throw new DownloadError('MODEL_MANIFEST_INCOMPLETE', M.untrustedManifest({ repo: source.repo }), {
        repo: source.repo,
        files: unhashed,
      });
    }
    const dir = path.join(root, ...source.repo.split('/'));
    const onDisk = await readManifest(dir);
    const listed = new Map(onDisk && onDisk.revision === source.revision ? onDisk.files.map((f) => [f.path, f]) : []);
    const reuse: string[] = [];
    const fetchFiles: DownloadFile[] = [];
    for (const file of spec.files) {
      const full = path.join(dir, file.path);
      const stat = await fs.stat(full).catch(() => null);
      let good = false;
      if (stat?.isFile() && (file.size === null || stat.size === file.size)) {
        // Old caches can pin a branch (master) while v3 pins a commit: verify bytes, never trust a renamed revision.
        if (repair || (onDisk !== null && onDisk.revision !== source.revision)) good = (await sha256File(full)) === file.sha256;
        else {
          const entry = listed.get(file.path);
          good = entry !== undefined && entry.sha256 === file.sha256 && entry.size === stat.size;
        }
      }
      if (good) reuse.push(file.path);
      else fetchFiles.push({ path: file.path, size: file.size, sha256: file.sha256! });
    }
    const files = spec.files.map((f) => ({ path: f.path, sha256: f.sha256! }));
    const manifestOk =
      onDisk !== null &&
      onDisk.revision === source.revision &&
      onDisk.files.length === spec.files.length &&
      spec.files.every((f) => listed.get(f.path)?.sha256 === f.sha256);
    if (repair && fetchFiles.length === 0 && manifestOk) return keep();

    // 暂存区里已经收到的部分：核对过的整份不再下载，`.part` 续传。
    const stage = stagingDirOf(root, source.repo, source.revision);
    let staged = 0;
    const pending: Array<{ file: DownloadFile; part: number }> = [];
    for (const file of fetchFiles) {
      const done = await fs.stat(path.join(stage, file.path)).catch(() => null);
      if (done?.isFile()) {
        staged += done.size;
        continue;
      }
      const part = (await fs.stat(path.join(stage, `${file.path}.part`)).catch(() => null))?.size ?? 0;
      staged += part;
      pending.push({ file, part });
    }
    const unknown = pending.filter((p) => p.file.size === null).map((p) => p.file);
    const probed = new Map<string, number | null>();
    if (unknown.length > 0) {
      const sizes = await this.#probeSizes(endpoint, this.#sourceRepo(source), source.revision, unknown);
      unknown.forEach((file, i) => probed.set(file.path, sizes[i] ?? null));
    }
    const remaining = pending.map(({ file, part }) => {
      const size = file.size ?? probed.get(file.path) ?? null;
      return size === null ? null : Math.max(0, size - part);
    });
    const bytes = remaining.some((r) => r === null) ? null : remaining.reduce<number>((sum, r) => sum + (r ?? 0), 0);
    const estimatedBytes = bytes ?? Math.max(0, spec.estimatedBytes - staged);
    return { component, source, action: 'download', fetch: fetchFiles, reuse, files, staged, bytes, estimatedBytes, root };
  }

  /** 下载来源的仓库：清单的 `sourceRepo`，没写时就是登记的 `repo`。 */
  #sourceRepo(source: BundleComponentSource): string {
    return repoManifestFor(source.repo, source.revision, this.#manifests())?.sourceRepo ?? source.repo;
  }

  /** 下载失败时记进 `details` 的那一部分：组件名、仓库、来源种类与实际连的基址（不覆盖下载器已经写的键）。 */
  #failedPart(c: PlannedComponent, detail: InstallPlanDetail): Record<string, unknown> {
    return {
      component: c.component,
      repo: c.source.repo,
      ...(c.source.release ? { origin: 'github-release' } : {}),
      source: this.#componentSource(c, detail.endpoint, detail.toolsEndpoint),
    };
  }

  /** 一个组件实际从哪个基址下载：模型仓库的组件按模型下载来源（ModelScope 上没有的回到公共模型仓库），发布页组件按工具下载镜像。 */
  #componentSource(c: PlannedComponent, endpoint: string, toolsEndpoint: string | null): string {
    return c.source.release
      ? releaseSource(c.source.release, c.endpoint === undefined ? toolsEndpoint : c.endpoint)
      : repoEndpoint(c.endpoint ?? endpoint, this.#sourceRepo(c.source));
  }

  /**
   * 计划里的来源：这次要下载的组件实际用到的基址，有几个时设置的基址在前、用「 + 」连起来；没有要下载的时是设置的基址。
   * 发布页组件的基址是工具下载镜像，没有镜像时是上游的发布页。
   */
  #sourceOf(endpoint: string, toolsEndpoint: string | null, downloading: readonly PlannedComponent[]): string {
    const bases = new Set(downloading.map((c) => this.#componentSource(c, endpoint, toolsEndpoint)));
    if (bases.size === 0) return endpoint;
    return [...bases].sort((a, b) => Number(b === endpoint) - Number(a === endpoint)).join(' + ');
  }

  /**
   * 向下载来源问文件大小：先 HEAD（跟随重定向；LFS 文件优先 `x-linked-size`）；HEAD 不给大小时改发只要第一个字节的 GET，
   * 从 `Content-Range` 读总长（来源不理 Range、回 200 整份时读 `Content-Length`）。ModelScope 的 HEAD 从不给大小，直接发 GET。
   * 取不到时 null。
   */
  async #probeSizes(endpoint: string, repo: string, revision: string, files: DownloadFile[]): Promise<Array<number | null>> {
    if (this.#options.probeSizes === false) return files.map(() => null);
    const timeout = this.#options.headTimeoutMs ?? 5_000;
    const headless = isModelScopeEndpoint(repoEndpoint(endpoint, repo));
    return Promise.all(
      files.map(async (file) => {
        const url = modelFileUrl(endpoint, repo, revision, file.path);
        try {
          if (!headless) {
            const head = await this.#fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(timeout) });
            if (!head.ok) return null;
            const size = sizeOf(head.headers.get('x-linked-size') ?? head.headers.get('content-length'));
            if (size !== null) return size;
          }
          const ranged = await this.#fetch(url, {
            headers: { Range: 'bytes=0-0' },
            redirect: 'follow',
            signal: AbortSignal.timeout(timeout),
          });
          await ranged.body?.cancel().catch(() => {});
          if (!ranged.ok) return null;
          // ModelScope 的小文件回 200 却带 `Content-Range`（`Content-Length` 是 1）：有它就以它为准。
          const range = /^bytes \d+-\d+\/(\d+)$/.exec(ranged.headers.get('content-range') ?? '');
          if (range) return sizeOf(range[1]);
          return ranged.status === 200 ? sizeOf(ranged.headers.get('content-length')) : null;
        } catch {
          return null;
        }
      }),
    );
  }

  /** 这个组件除了 `bundleId` 之外的持有者：用到同一仓库与版本、在安装记录里或文件齐全的模型包。 */
  async #holders(bundleId: string, source: BundleComponentSource, record: Record<string, unknown>): Promise<string[]> {
    const holders: string[] = [];
    for (const other of this.#catalog.definitions()) {
      if (other.bundleId === bundleId) continue;
      if (!componentsOf(other).some(([, s]) => s.repo === source.repo && s.revision === source.revision)) continue;
      if (Object.hasOwn(record, other.bundleId)) {
        holders.push(other.bundleId);
        continue;
      }
      let complete = true;
      for (const s of requiredSources(other)) {
        if (!(await this.#catalog.componentInstalled(s))) {
          complete = false;
          break;
        }
      }
      if (complete) holders.push(other.bundleId);
    }
    return holders;
  }

  #sharers(def: BundleDefinition): string[] {
    const repos = new Set(componentsOf(def).map(([, s]) => `${s.repo}@${s.revision}`));
    return this.#catalog
      .definitions()
      .filter((b) => b.bundleId !== def.bundleId && componentsOf(b).some(([, s]) => repos.has(`${s.repo}@${s.revision}`)))
      .map((b) => b.bundleId);
  }

  #definition(bundleId: string): BundleDefinition {
    const def = this.#catalog.definition(bundleId);
    if (!def) throw new Error(M.noBundle({ bundleId }).text);
    return def;
  }
}

/** 清单列出的文件都在、大小相符、sha256 对得上（修复发布页组件时）。 */
async function intact(dir: string, manifest: BcutManifest): Promise<boolean> {
  for (const file of manifest.files) {
    const full = path.join(dir, file.path);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat?.isFile() || stat.size !== file.size || (await sha256File(full)) !== file.sha256) return false;
  }
  return true;
}

function sizeOf(value: string | null | undefined): number | null {
  const size = Number(value ?? NaN);
  return Number.isSafeInteger(size) && size >= 0 ? size : null;
}

function componentsOf(def: BundleDefinition): Array<[string, BundleComponentSource]> {
  return Object.entries(def.components) as Array<[string, BundleComponentSource]>;
}
