import fs from 'node:fs/promises';
import path from 'node:path';
import type { ModelInstallPlan, ModelSelfTestResult } from '@baocut/protocol';
import { ModelsModelInstaller as M } from '@baocut/protocol/messages/models/model-installer.ts';
import { requiredSources, type BundleComponentSource, type BundleDefinition } from './bundle-registry.ts';
import { readInstallRecord, updateInstallRecord } from './install-record.ts';
import { readManifest, sha256File, type BcutManifest, type ModelCatalog } from './model-catalog.ts';
import { DownloadError, ModelDownloader, diskFreeBytes, type DownloadFile } from './model-downloader.ts';
import { modelFileUrl } from './download-source.ts';
import { discardStaging, removeEmptyParents, stagingDirOf } from './model-staging.ts';
import { REPO_MANIFESTS, repoManifestFor, type RepoManifestSpec } from './repo-manifests.ts';

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
}

/** 计划里的一个组件（内部形态，安装时照着做）。 */
export interface PlannedComponent {
  component: string;
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
}

export interface InstallPlanDetail {
  plan: ModelInstallPlan;
  components: PlannedComponent[];
  endpoint: string;
  repair: boolean;
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
  readonly #manifests: readonly RepoManifestSpec[];
  readonly #freeBytes: (dir: string) => Promise<number | null>;
  readonly #fetch: typeof fetch;

  constructor(options: ModelInstallerOptions) {
    this.#catalog = options.catalog;
    this.#options = options;
    this.#manifests = options.manifests ?? REPO_MANIFESTS;
    this.#freeBytes = options.freeBytes ?? diskFreeBytes;
    this.#fetch = options.fetch ?? fetch;
  }

  get root(): string {
    return this.#catalog.root;
  }

  async plan(bundleId: string, options: { repair?: boolean } = {}): Promise<InstallPlanDetail> {
    const def = this.#definition(bundleId);
    const repair = options.repair ?? false;
    const endpoint = this.#options.endpoint();
    const components: PlannedComponent[] = [];
    for (const [component, source] of componentsOf(def)) {
      components.push(await this.#planComponent(component, source, repair, endpoint));
    }
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
        action: c.action,
        files: c.fetch.map((f) => f.path),
        bytes: c.action === 'keep' ? 0 : c.bytes,
      })),
      downloadBytes,
      estimatedBytes,
      confirmBytes: downloadBytes ?? estimatedBytes,
      resumedBytes,
      availableBytes: await this.#freeBytes(this.root),
      source: endpoint,
      upToDate: downloading.length === 0,
    };
    return { plan, components, endpoint, repair, totalBytes: downloadBytes === null ? null : downloadBytes + resumedBytes };
  }

  /** 照计划下载、核对、发布。信号中止时停下（暂存区保留，下次续传），抛出中止的原因。 */
  async install(
    detail: InstallPlanDetail,
    options: { signal: AbortSignal; onProgress?: (progress: InstallProgress) => void },
  ): Promise<InstallOutcome> {
    const { signal } = options;
    const onProgress = options.onProgress ?? (() => {});
    const downloading = detail.components.filter((c) => c.action === 'download');
    const required = downloading.reduce((sum, c) => sum + (c.bytes ?? c.estimatedBytes), 0);
    const available = await this.#freeBytes(this.root);
    if (available !== null && available < required) {
      throw new DownloadError('MODEL_DOWNLOAD_NO_SPACE', M.noSpace(), {
        requiredBytes: required,
        availableBytes: available,
      });
    }
    const downloader = new ModelDownloader({
      root: this.root,
      endpoint: detail.endpoint,
      fetch: this.#fetch,
      ...(this.#options.retries !== undefined ? { retries: this.#options.retries } : {}),
      ...(this.#options.backoffMs ? { backoffMs: this.#options.backoffMs } : {}),
      ...(this.#options.stallMs !== undefined ? { stallMs: this.#options.stallMs } : {}),
    });
    let received = detail.plan.resumedBytes;
    let downloaded = 0;
    const report = (phase: InstallProgress['phase']) =>
      onProgress({ phase, receivedBytes: Math.max(0, received), totalBytes: detail.totalBytes });
    report('downloading');
    const published: BcutManifest[] = [];
    for (const component of downloading) {
      const { repo, revision } = component.source;
      if (component.reuse.length > 0) await downloader.reuse(repo, revision, this.#catalog.repoDir(repo), component.reuse);
      const sourceRepo = repoManifestFor(repo, revision, this.#manifests)?.sourceRepo ?? repo;
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
      published.push(await downloader.publish(repo, revision, component.files));
      this.#catalog.changed(detail.plan.bundleId);
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
      const holders = await this.#holders(bundleId, source, record.bundles);
      if (holders.length > 0) {
        kept.push({ repo: source.repo, usedBy: holders });
        continue;
      }
      await discardStaging(this.root, source.repo, source.revision);
      const dir = this.#catalog.repoDir(source.repo);
      const manifest = await readManifest(dir);
      if (manifest && manifest.revision !== source.revision) {
        kept.push({ repo: source.repo, usedBy: [] });
        continue;
      }
      if (!(await fs.stat(dir).catch(() => null))) continue;
      await fs.rm(dir, { recursive: true, force: true });
      await removeEmptyParents(path.dirname(dir), path.dirname(dir));
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
      if (!busy(source)) await discardStaging(this.root, source.repo, source.revision);
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

  async #planComponent(component: string, source: BundleComponentSource, repair: boolean, endpoint: string): Promise<PlannedComponent> {
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
    if (!repair && (await this.#catalog.componentInstalled(source))) return keep();
    const spec = repoManifestFor(source.repo, source.revision, this.#manifests);
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
    const dir = this.#catalog.repoDir(source.repo);
    const onDisk = await readManifest(dir);
    const listed = new Map(onDisk && onDisk.revision === source.revision ? onDisk.files.map((f) => [f.path, f]) : []);
    const reuse: string[] = [];
    const fetchFiles: DownloadFile[] = [];
    for (const file of spec.files) {
      const full = path.join(dir, file.path);
      const stat = await fs.stat(full).catch(() => null);
      let good = false;
      if (stat?.isFile() && (file.size === null || stat.size === file.size)) {
        if (repair) good = (await sha256File(full)) === file.sha256;
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
    const stage = stagingDirOf(this.root, source.repo, source.revision);
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
      const sizes = await this.#probeSizes(endpoint, spec.sourceRepo ?? source.repo, source.revision, unknown);
      unknown.forEach((file, i) => probed.set(file.path, sizes[i] ?? null));
    }
    const remaining = pending.map(({ file, part }) => {
      const size = file.size ?? probed.get(file.path) ?? null;
      return size === null ? null : Math.max(0, size - part);
    });
    const bytes = remaining.some((r) => r === null) ? null : remaining.reduce<number>((sum, r) => sum + (r ?? 0), 0);
    const estimatedBytes = bytes ?? Math.max(0, spec.estimatedBytes - staged);
    return { component, source, action: 'download', fetch: fetchFiles, reuse, files, staged, bytes, estimatedBytes };
  }

  /** 向下载来源问文件大小（HEAD，跟随重定向；LFS 文件优先 `x-linked-size`）。取不到时 null。 */
  async #probeSizes(endpoint: string, repo: string, revision: string, files: DownloadFile[]): Promise<Array<number | null>> {
    if (this.#options.probeSizes === false) return files.map(() => null);
    const timeout = this.#options.headTimeoutMs ?? 5_000;
    return Promise.all(
      files.map(async (file) => {
        try {
          const response = await this.#fetch(modelFileUrl(endpoint, repo, revision, file.path), {
            method: 'HEAD',
            redirect: 'follow',
            signal: AbortSignal.timeout(timeout),
          });
          if (!response.ok) return null;
          const value = Number(response.headers.get('x-linked-size') ?? response.headers.get('content-length') ?? NaN);
          return Number.isSafeInteger(value) && value >= 0 ? value : null;
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

function componentsOf(def: BundleDefinition): Array<[string, BundleComponentSource]> {
  return Object.entries(def.components) as Array<[string, BundleComponentSource]>;
}
