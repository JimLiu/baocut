import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ProjectGitConfigEntry } from '@baocut/protocol';
import { readJsonOrQuarantine, writeJsonAtomic, type StoreLog } from '@baocut/runtime-storage';
import { gitErrorDetail, nulFields, type GitRunner } from './git-command.ts';
import type { GitRepo } from './git-repo.ts';

/**
 * 本地过滤器的闸门（版本记录设计 §5.4）：仓库本地配置里有 `filter.<name>.clean|smudge|process`、`include.path` 或
 * `includeIf.<条件>.path` 时，BaoCut 的 git 写操作暂停，直到用户在这台电脑上启用。
 *
 * - 读配置用 `git config --list`，不读工作区文件内容，暂停期间也能运行。只看 `local` 与 `worktree` 范围（被包含的文件里的条目
 *   也算 `local`）；全局与系统配置里的过滤器照常生效。
 * - `git lfs install --local` 写入的几个值逐字相同时不算（执行的是用户 PATH 里的 git-lfs），只认这几个逐字的值。
 * - 启用记在 Runtime Home 的 `store/git-local-config.json`（不写进项目），按共用 git 目录的真实路径区分仓库；记的是条目的值与
 *   被包含的文件内容的摘要。每次判断都重新算（设计里写的按修改时间缓存没有做：文件很小），摘要变了重新暂停。
 */

/** `git lfs install --local` 写入的值（`--skip-smudge` 时的两个也算）。 */
const LFS_VALUES: Readonly<Record<string, readonly string[]>> = {
  'filter.lfs.clean': ['git-lfs clean -- %f'],
  'filter.lfs.smudge': ['git-lfs smudge -- %f', 'git-lfs smudge --skip -- %f'],
  'filter.lfs.process': ['git-lfs filter-process', 'git-lfs filter-process --skip'],
};

const STORE_VERSION = 1;

export interface LocalConfigCheck {
  /** 要用户启用的条目；没有时为空。 */
  entries: ProjectGitConfigEntry[];
  /** 条目与被包含的文件内容的摘要（`sha256:<hex>`）；没有条目时 null。 */
  digest: string | null;
  /** 条目都已在这台电脑上启用过（摘要相同），或没有条目。 */
  allowed: boolean;
  /** 之前启用过这个仓库，之后变了。 */
  changed: boolean;
}

interface StoreFile {
  version: number;
  repos: Record<string, { digest: string; allowedAt: string }>;
}

interface ConfigRecord {
  scope: string;
  /** 配置文件的绝对路径；不是文件（命令行、标准输入）时 null。 */
  file: string | null;
  key: string;
  value: string;
}

/** 要暂停的键：过滤器的三个命令与两种包含。git 输出的节名与键名是小写的，子节名保留原样。 */
export function isGatedKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (lower === 'include.path') return true;
  if (lower.startsWith('includeif.') && lower.endsWith('.path')) return true;
  return /^filter\..+\.(clean|smudge|process)$/.test(lower);
}

/** 本地配置里 git-lfs 自己写入的值：不暂停。 */
export function isStandardLfs(key: string, value: string): boolean {
  return LFS_VALUES[key.toLowerCase()]?.includes(value) ?? false;
}

/** 解析 `git config --list --show-scope --show-origin -z`：每条是 `范围\0来源\0键\n值\0`（没有值的布尔键只有键）。 */
export function parseConfigList(output: Buffer, base: string): ConfigRecord[] {
  const fields = nulFields(output);
  const records: ConfigRecord[] = [];
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const scope = fields[index]!;
    const origin = fields[index + 1]!;
    const entry = fields[index + 2]!;
    const newline = entry.indexOf('\n');
    const key = newline < 0 ? entry : entry.slice(0, newline);
    const value = newline < 0 ? '' : entry.slice(newline + 1);
    const file = origin.startsWith('file:') ? path.resolve(base, origin.slice('file:'.length)) : null;
    records.push({ scope, file, key, value });
  }
  return records;
}

export class LocalConfigGate {
  readonly #storeFile: string;
  readonly #log: StoreLog | undefined;
  /** 写存储排队，免得两次启用互相覆盖。 */
  #writing: Promise<void> = Promise.resolve();
  /** 更新版本的 BaoCut 写下的存储：只读，启用只留在内存里。 */
  #readOnly = false;
  #store: StoreFile | null = null;

  constructor(storeFile: string, log?: StoreLog) {
    this.#storeFile = storeFile;
    this.#log = log;
  }

  /** 读本地配置，算出条目、摘要与启用状态。git 读不了配置时抛出。 */
  async check(runner: GitRunner, repo: GitRepo): Promise<LocalConfigCheck> {
    const result = await runner.run(repo.root, ['config', '--list', '--show-scope', '--show-origin', '-z'], { query: true });
    if (result.exitCode !== 0) throw new Error(`git config --list failed: ${gitErrorDetail(result)}`);
    // 来源里的相对路径相对仓库根目录（git 先换到工作区顶层再读配置）。
    const records = parseConfigList(result.stdout, repo.root).filter((record) => record.scope === 'local' || record.scope === 'worktree');
    const gated = records.filter((record) => isGatedKey(record.key) && !isStandardLfs(record.key, record.value));
    if (gated.length === 0) return { entries: [], digest: null, allowed: true, changed: false };
    const digest = await digestOf(gated, records, await mainConfigs(repo));
    const stored = (await this.#load()).repos[await repoKey(repo)];
    return {
      entries: gated.map((record) => ({ key: record.key, value: record.value, ...(record.file ? { file: record.file } : {}) })),
      digest,
      allowed: stored?.digest === digest,
      changed: stored !== undefined && stored.digest !== digest,
    };
  }

  /** 启用：记下用户看过的那个摘要。 */
  async allow(repo: GitRepo, digest: string): Promise<void> {
    const key = await repoKey(repo);
    const write = this.#writing.then(async () => {
      const store = await this.#load();
      store.repos[key] = { digest, allowedAt: new Date().toISOString() };
      if (!this.#readOnly) await writeJsonAtomic(this.#storeFile, store);
    });
    this.#writing = write.catch(() => {});
    await write;
  }

  async #load(): Promise<StoreFile> {
    if (this.#store) return this.#store;
    // 认不出时改名保留、从空开始（即全部重新暂停）；更新版本写下的不改名、不覆盖（`store-file.ts`）。
    const read = await readJsonOrQuarantine<StoreFile>(this.#storeFile, {
      log: this.#log,
      version: { key: 'version', known: STORE_VERSION },
      recognize: (raw) =>
        raw.version === STORE_VERSION && raw.repos && typeof raw.repos === 'object' && !Array.isArray(raw.repos) ? (raw as unknown as StoreFile) : null,
    }).catch(() => null);
    if (read?.status === 'newer-version') this.#readOnly = true;
    this.#store = read?.status === 'ok' ? read.value : { version: STORE_VERSION, repos: {} };
    return this.#store;
  }
}

/** 共用 git 目录的真实路径（worktree 共用同一份启用）；Windows 与 macOS 不分大小写。 */
async function repoKey(repo: GitRepo): Promise<string> {
  const real = await fs.realpath(repo.commonDir).catch(() => repo.commonDir);
  return process.platform === 'win32' || process.platform === 'darwin' ? real.toLowerCase() : real;
}

/**
 * 摘要：要暂停的条目（范围、键、值）按出现的顺序，加上被包含的文件的内容——条目的来源里除主配置之外的文件，以及每个
 * `include.path`、`includeIf.*.path` 指向的文件（条件不成立时 git 不读它，这里照样算进去，免得切换分支时条件变了却没发现）。
 * 主配置里别的键（`user.name`）不在里面。
 */
async function digestOf(gated: readonly ConfigRecord[], all: readonly ConfigRecord[], main: ReadonlySet<string>): Promise<string> {
  const hash = createHash('sha256');
  for (const record of gated) hash.update(`entry\0${record.scope}\0${record.key}\0${record.value}\0`);
  const files = new Set<string>();
  for (const record of all) if (record.file && !main.has(await realOrSelf(record.file))) files.add(record.file);
  for (const record of gated) {
    if (!record.file || !/^include(if\..+)?\.path$/i.test(record.key) || !record.value) continue;
    files.add(includeTarget(record.value, record.file));
  }
  for (const file of [...files].sort()) {
    const content = await fs.readFile(file).catch(() => null);
    hash.update(`file\0${file}\0`);
    hash.update(content === null ? 'missing' : createHash('sha256').update(content).digest('hex'));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

/** 主配置（按真实路径）：共用 git 目录的 `config` 与这个工作区的 `config.worktree`。 */
async function mainConfigs(repo: GitRepo): Promise<Set<string>> {
  return new Set(await Promise.all([path.join(repo.commonDir, 'config'), path.join(repo.gitDir, 'config.worktree')].map(realOrSelf)));
}

async function realOrSelf(file: string): Promise<string> {
  return await fs.realpath(file).catch(() => file);
}

/** `include.path` 的值 → 文件：`~/` 按主目录展开，相对路径相对写它的那个配置文件所在的目录。 */
export function includeTarget(value: string, from: string): string {
  if (value === '~' || value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(1));
  return path.resolve(path.dirname(from), value);
}
