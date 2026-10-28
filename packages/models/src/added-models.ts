import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseHfFileAddress, type AudioCppAddableFamily, type MessageRef, type ModelAddParams } from '@baocut/protocol';
import { ModelsAudioCppCatalog as M } from '@baocut/protocol/messages/models/audio-cpp-catalog.ts';
import {
  AUDIO_CPP_CATALOG_ENGINE,
  BUILTIN_PACKAGES,
  addableFamilies,
  catalogBundle,
  catalogFamily,
  customBundleId,
  customFamilies,
  idleReason,
  localFileBundle,
  localVariant,
  packageFamily,
  repoFileBundle,
  type AddedBundle,
} from './audio-cpp-catalog.ts';
import { DEFAULT_MODELS_ENDPOINT, isModelScopeEndpoint } from './download-source.ts';
import { readGgufHeader } from './gguf-header.ts';
import type { ModelCatalog } from './model-catalog.ts';

/**
 * 用户添加的 audio.cpp 模型（架构设计 §6.3）：记在 Runtime Home 的 `store/added-models.json`：
 * `{ "format_version": 1, "entries": [...] }`，每条是目录里的一个包（`catalog`）、Hugging Face 上的一个 GGUF（`repo-file`，记下添加时
 * 读出的提交、大小与 sha256）或这台电脑上的一个 GGUF（`local-file`，原地引用，记下路径与大小）。Runtime 启动时逐条登记进模型目录；
 * 目录数据里已经没有的包、认不出的记录跳过（不删，留给以后的版本）。文件坏了按空记录处理。
 */

export const ADDED_MODELS_FORMAT = 1;

type Entry =
  | { kind: 'catalog'; packageId: string; addedAt: string }
  | { kind: 'repo-file'; bundleId: string; family: string; repo: string; revision: string; path: string; size: number; sha256: string; label: string; addedAt: string }
  | { kind: 'local-file'; bundleId: string; family: string; path: string; size: number; label: string; addedAt: string; variant?: string };

/** 添加失败：`refused` 是参数本身不行（不认识、内置、用不上、不是 GGUF）；`unreachable` 是下载来源读不到；`conflict` 是此刻不能移出。 */
export class ModelAddError extends Error {
  readonly kind: 'refused' | 'unreachable' | 'conflict';
  readonly code: string;
  readonly ref: MessageRef;
  constructor(kind: 'refused' | 'unreachable' | 'conflict', code: string, message: MessageRef & { text: string }) {
    super(message.text);
    this.kind = kind;
    this.code = code;
    this.ref = { key: message.key, ...(message.params ? { params: message.params } : {}) };
  }
}

export interface AddedModelsOptions {
  /** 记录文件（Runtime 传 `<home>/store/added-models.json`）。null 时只在内存里。 */
  file: string | null;
  catalog: ModelCatalog;
  /** 下载来源的基址（与下载同一个）：读 Hugging Face 上文件的提交、大小与 sha256。 */
  endpoint: () => string;
  fetch?: typeof fetch;
  now?: () => Date;
}

/** 文件头：GGUF 文件以 `GGUF` 四个字节开头。 */
const GGUF_MAGIC = Buffer.from('GGUF');
const FETCH_TIMEOUT_MS = 20_000;

export class AddedModels {
  readonly #options: AddedModelsOptions;
  readonly #catalog: ModelCatalog;
  #entries: Entry[] = [];
  #writing: Promise<void> = Promise.resolve();

  /** 读记录并登记进模型目录。读文件是同步的：模型列表第一次给出时就要有添加的模型包。 */
  constructor(options: AddedModelsOptions) {
    this.#options = options;
    this.#catalog = options.catalog;
    if (options.file) {
      try {
        const raw = JSON.parse(readFileSync(options.file, 'utf8')) as { format_version?: unknown; entries?: unknown };
        if (raw.format_version === ADDED_MODELS_FORMAT && Array.isArray(raw.entries)) this.#entries = raw.entries.filter(isEntry);
      } catch {
        // 没有或坏了：空记录。
      }
    }
    for (const entry of this.#entries) {
      const bundle = bundleOf(entry);
      if (bundle && !this.#catalog.definition(bundle.definition.bundleId)) this.#catalog.register(bundle);
    }
  }

  /** 添加对话框的目录：每一族与它的包（标出内置与已添加），以及自己指定文件时能选的族。 */
  addable(): { engine: string; families: AudioCppAddableFamily[]; custom: string[] } {
    const present = new Set(this.#catalog.definitions().map((d) => d.bundleId));
    return { engine: AUDIO_CPP_CATALOG_ENGINE, families: addableFamilies(present), custom: customFamilies().map((f) => f.family) };
  }

  /** 加一个模型包（不下载）。已经加过的返回原来的。 */
  async add(params: ModelAddParams): Promise<string> {
    if (params.source === 'catalog') return this.#addCatalog(params.packageId);
    const family = catalogFamily(params.family);
    if (!family || !customFamilies().includes(family)) {
      if (family && idleReason(family) !== null) throw refused(M.idleFamily({ family: family.name }));
      throw refused(M.noCustomFamily({ family: family?.name ?? params.family }));
    }
    return params.source === 'repo-file' ? this.#addRepoFile(family.family, params.address, params.label) : this.#addLocalFile(family.family, params.path, params.label);
  }

  /**
   * 移出列表：只收添加的模型包。下载的要先删掉（还装着时 `conflict`）；原地引用的直接移出，不碰文件。调用方先确认没有任务在用它、
   * 暂存区已清掉。
   */
  async unlist(bundleId: string): Promise<void> {
    const info = this.#catalog.addedInfo(bundleId);
    if (!info) throw refused(M.notAdded({ bundleId }));
    const progress = this.#catalog.installState(bundleId);
    if (progress && progress.jobId !== null) throw new ModelAddError('conflict', 'MODEL_IN_USE', M.installing());
    if (info.kind !== 'local-file') {
      const status = await this.#catalog.status(bundleId);
      const installed = status?.components?.some((c) => c.state === 'installed' && c.origin !== 'local-file' && c.sharedWith.length === 0) ?? false;
      if (installed) throw new ModelAddError('conflict', 'MODEL_INSTALLED', M.stillInstalled());
    }
    this.#entries = this.#entries.filter((e) => bundleIdOf(e) !== bundleId);
    await this.#save();
    this.#catalog.unregister(bundleId);
  }

  async #addCatalog(packageId: string): Promise<string> {
    if (BUILTIN_PACKAGES[packageId]) throw refused(M.builtinPackage({ id: BUILTIN_PACKAGES[packageId]! }));
    const bundle = catalogBundle(packageId);
    if (!bundle) {
      const family = packageFamily(packageId);
      if (family && idleReason(family) !== null) throw refused(M.idleFamily({ family: family.name }));
      throw refused(M.unknownPackage({ id: packageId }));
    }
    return this.#commit({ kind: 'catalog', packageId, addedAt: this.#now() }, bundle);
  }

  async #addRepoFile(family: string, address: string, label: string | undefined): Promise<string> {
    const parsed = parseHfFileAddress(address);
    if (!parsed.ok) throw refused(parsed.code === 'not-gguf' ? M.notGguf() : M.notHfAddress());
    const endpoint = this.#apiEndpoint();
    const repoPath = parsed.repo.split('/').map(encodeURIComponent).join('/');
    const info = await this.#json<{ sha?: unknown }>(parsed.repo, `${endpoint}/api/models/${repoPath}/revision/${encodeURIComponent(parsed.revision)}`);
    const commit = typeof info.sha === 'string' && /^[0-9a-f]{40}$/.test(info.sha) ? info.sha : null;
    if (!commit) throw new ModelAddError('unreachable', 'MODEL_ADD_UNREACHABLE', M.unreachable({ repo: parsed.repo, detail: 'revision' }));
    const files = await this.#json<Array<{ path?: unknown; size?: unknown; lfs?: { oid?: unknown; size?: unknown } }>>(
      parsed.repo,
      `${endpoint}/api/models/${repoPath}/paths-info/${commit}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths: [parsed.path], expand: false }) },
    );
    const file = Array.isArray(files) ? files.find((f) => f.path === parsed.path) : undefined;
    if (!file) throw refused(M.fileNotFound({ file: parsed.path, repo: parsed.repo }));
    const sha256 = typeof file.lfs?.oid === 'string' && /^[0-9a-f]{64}$/.test(file.lfs.oid) ? file.lfs.oid : null;
    const size = typeof file.lfs?.size === 'number' ? file.lfs.size : typeof file.size === 'number' ? file.size : null;
    if (!sha256 || size === null) throw refused(M.notLfs({ file: path.posix.basename(parsed.path) }));
    const bundleId = customBundleId(`repo-file:${family}:${parsed.repo}:${commit}:${parsed.path}`);
    const entry: Entry = {
      kind: 'repo-file',
      bundleId,
      family,
      repo: parsed.repo,
      revision: commit,
      path: parsed.path,
      size,
      sha256,
      label: label?.trim() || baseName(parsed.path),
      addedAt: this.#now(),
    };
    return this.#commit(entry, bundleOf(entry)!);
  }

  async #addLocalFile(family: string, file: string, label: string | undefined): Promise<string> {
    const abs = path.resolve(file);
    if (!/\.gguf$/i.test(abs)) throw refused(M.notGguf());
    let size: number;
    let variant: string | null = null;
    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile()) throw new Error('not a file');
      size = stat.size;
      const handle = await fs.open(abs, 'r');
      try {
        const head = Buffer.alloc(4);
        await handle.read(head, 0, 4, 0);
        if (!head.equals(GGUF_MAGIC)) throw refused(M.notGguf());
        // 认出是哪一只内置模型的别的精度（读不懂文件头时按族配通用的特性，不拒绝）。
        const header = await readGgufHeader(handle).catch(() => null);
        if (header) {
          const config = await header.embedded('config.json').catch(() => null);
          variant = localVariant(family, { name: header.name, config: config?.toString('utf8') ?? null });
        }
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof ModelAddError) throw error;
      throw refused(M.localUnreadable());
    }
    const bundleId = customBundleId(`local-file:${family}:${abs}`);
    const entry: Entry = {
      kind: 'local-file',
      bundleId,
      family,
      path: abs,
      size,
      label: label?.trim() || baseName(abs),
      addedAt: this.#now(),
      ...(variant ? { variant } : {}),
    };
    return this.#commit(entry, bundleOf(entry)!);
  }

  /** 记下并登记；已经登记过的（同一个包或文件）返回原来的，原地引用的文件大小变了时按新的大小重新登记。 */
  async #commit(entry: Entry, bundle: AddedBundle): Promise<string> {
    const bundleId = bundle.definition.bundleId;
    const existing = this.#entries.findIndex((e) => bundleIdOf(e) === bundleId);
    if (existing >= 0 && !(entry.kind === 'local-file' && this.#entries[existing]!.kind === 'local-file')) return bundleId;
    if (existing >= 0) {
      this.#entries[existing] = entry;
      this.#catalog.unregister(bundleId);
    } else {
      this.#entries.push(entry);
    }
    await this.#save();
    this.#catalog.register(bundle);
    return bundleId;
  }

  #apiEndpoint(): string {
    const endpoint = this.#options.endpoint().replace(/\/+$/, '');
    // ModelScope 的接口与 Hugging Face 不同：文件的提交与 sha256 从公共模型仓库读（下载仍按设置的来源，逐个核对 sha256）。
    return isModelScopeEndpoint(endpoint) ? DEFAULT_MODELS_ENDPOINT : endpoint;
  }

  async #json<T>(repo: string, url: string, init?: RequestInit): Promise<T> {
    const fetchImpl = this.#options.fetch ?? fetch;
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (error) {
      throw new ModelAddError('unreachable', 'MODEL_ADD_UNREACHABLE', M.unreachable({ repo, detail: (error as Error).name === 'TimeoutError' ? 'timeout' : 'network' }));
    }
    if (!res.ok) throw new ModelAddError('unreachable', 'MODEL_ADD_UNREACHABLE', M.unreachable({ repo, detail: `HTTP ${res.status}` }));
    try {
      return (await res.json()) as T;
    } catch {
      throw new ModelAddError('unreachable', 'MODEL_ADD_UNREACHABLE', M.unreachable({ repo, detail: 'json' }));
    }
  }

  #now(): string {
    return (this.#options.now?.() ?? new Date()).toISOString();
  }

  #save(): Promise<void> {
    const file = this.#options.file;
    if (!file) return Promise.resolve();
    const body = `${JSON.stringify({ format_version: ADDED_MODELS_FORMAT, entries: this.#entries }, null, 2)}\n`;
    this.#writing = this.#writing
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        await fs.writeFile(tmp, body);
        await fs.rename(tmp, file);
      });
    return this.#writing;
  }
}

function refused(message: MessageRef & { text: string }): ModelAddError {
  return new ModelAddError('refused', 'MODEL_ADD_REFUSED', message);
}

function bundleIdOf(entry: Entry): string {
  return entry.kind === 'catalog' ? (catalogBundle(entry.packageId)?.definition.bundleId ?? entry.packageId) : entry.bundleId;
}

function bundleOf(entry: Entry): AddedBundle | null {
  if (entry.kind === 'catalog') return catalogBundle(entry.packageId);
  if (entry.kind === 'repo-file') {
    return repoFileBundle({ family: entry.family, repo: entry.repo, revision: entry.revision, path: entry.path, size: entry.size, sha256: entry.sha256, label: entry.label }, entry.bundleId);
  }
  return localFileBundle(
    { family: entry.family, path: entry.path, size: entry.size, label: entry.label, ...(entry.variant ? { variant: entry.variant } : {}) },
    entry.bundleId,
  );
}

function baseName(file: string): string {
  return file.split(/[\\/]/).pop()!.replace(/\.gguf$/i, '');
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  const str = (k: string) => typeof e[k] === 'string' && (e[k] as string).length > 0;
  if (e.kind === 'catalog') return str('packageId');
  if (e.kind === 'repo-file') return ['bundleId', 'family', 'repo', 'revision', 'path', 'sha256', 'label'].every(str) && typeof e.size === 'number';
  if (e.kind === 'local-file') {
    return (
      ['bundleId', 'family', 'path', 'label'].every(str) &&
      typeof e.size === 'number' &&
      path.isAbsolute(e.path as string) &&
      (e.variant === undefined || str('variant'))
    );
  }
  return false;
}
