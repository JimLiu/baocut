import crypto from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { ModelsDirRepo } from '@baocut/protocol';
import { requiredSources, type BundleDefinition } from './bundle-registry.ts';
import { INSTALL_RECORD_FILE, readInstallRecord, updateInstallRecord } from './install-record.ts';
import { readManifest } from './model-catalog.ts';

/**
 * 模型目录的盘上操作（架构设计 §6.3）：认出一个文件夹里的模型、查它能不能用、把模型从一个目录移到另一个。
 * 「换过去」（改设置、换模型目录的根）不在这里，由 Runtime 的模型目录服务在移动成功之后做。
 *
 * 移动只碰 BaoCut 认得的东西：`<owner>/<repo>/` 里带合法 `.bcut-manifest.json`、且是登记过的模型包用到的仓库与版本，
 * 加上安装记录 `.bcut-installs.json`（合并进目标的记录）。别的文件（别的程序放的、暂存区里没下完的）留在原处。
 *
 * - 同一块盘：逐个仓库改名过去，回滚是改名回来。
 * - 跨盘：先复制到目标里的 `.bcut-moving/`，逐个文件按清单核对大小与 sha256，全部齐了再改名到位；回滚是删掉复制出来的。
 *   原目录里的文件在 Runtime 换过去之后才删（`removeSources`）。
 * - 开始前在原目录写一份日志 `.bcut-move.json`：Runtime 在移动中途崩溃时，下次启动按它回滚（`recoverMove`）。
 */

/** 跨盘复制时的暂存目录（在目标目录里）。 */
export const MOVING_DIR = '.bcut-moving';
/** 移动的日志（在原目录里）。 */
export const MOVE_JOURNAL_FILE = '.bcut-move.json';

export interface ModelsDirScan {
  repos: ModelsDirRepo[];
  /** 组件的仓库与版本全都在这个文件夹里的模型包（按清单认，不逐个文件查大小）。 */
  bundleIds: string[];
  /** 登记过的仓库的大小之和。 */
  bytes: number;
}

/** 一个文件夹里能认出的模型：`<owner>/<repo>/.bcut-manifest.json`。只读。文件夹不在时是空的。 */
export async function scanModelsDir(root: string, bundles: readonly BundleDefinition[]): Promise<ModelsDirScan> {
  const known = new Set<string>();
  for (const def of bundles) for (const source of Object.values(def.components)) if (source) known.add(`${source.repo}@${source.revision}`);
  const repos: ModelsDirRepo[] = [];
  for (const owner of await listDirs(root)) {
    for (const name of await listDirs(path.join(root, owner))) {
      const manifest = await readManifest(path.join(root, owner, name));
      if (!manifest) continue;
      const repo = `${owner}/${name}`;
      // 清单里写的仓库名与所在的目录不一致时按目录算（旧版下载器写的清单也是这样放的）。
      repos.push({
        repo,
        revision: manifest.revision,
        bytes: manifest.files.reduce((n, f) => n + f.size, 0),
        known: known.has(`${repo}@${manifest.revision}`),
      });
    }
  }
  repos.sort((a, b) => a.repo.localeCompare(b.repo));
  const have = new Set(repos.map((r) => `${r.repo}@${r.revision}`));
  const bundleIds = bundles
    .filter((def) => {
      const sources = requiredSources(def);
      return sources.length > 0 && sources.every((s) => have.has(`${s.repo}@${s.revision}`));
    })
    .map((def) => def.bundleId);
  return { repos, bundleIds, bytes: repos.filter((r) => r.known).reduce((n, r) => n + r.bytes, 0) };
}

/** 文件夹在不在（是不是文件夹）、能不能写。 */
export async function dirAccess(dir: string): Promise<{ exists: boolean; writable: boolean }> {
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) return { exists: false, writable: false };
  const writable = await fs.access(dir, constants.W_OK).then(
    () => true,
    () => false,
  );
  return { exists: true, writable };
}

/** 两个已存在的路径在不在同一块盘上（能不能用改名搬）。 */
export async function sameVolume(a: string, b: string): Promise<boolean> {
  const [sa, sb] = await Promise.all([fs.stat(a).catch(() => null), fs.stat(b).catch(() => null)]);
  return sa !== null && sb !== null && sa.dev === sb.dev;
}

/** `a` 与 `b` 是同一个目录，或一个在另一个里面。 */
export function nestedDirs(a: string, b: string): 'same' | 'nested' | null {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  if (ra === rb) return 'same';
  const inside = (outer: string, inner: string) => {
    const rel = path.relative(outer, inner);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  return inside(ra, rb) || inside(rb, ra) ? 'nested' : null;
}

export interface MoveRepo {
  repo: string;
  revision: string;
  bytes: number;
}

/**
 * 要移过去的仓库：原目录里登记过的仓库，去掉目标里已有同一版本的（不再搬，原目录里那份在换过去之后一并删）。
 * 目标里同名仓库是别的版本、或没有清单时不能放过去：留在原处（`blocked`）。
 */
export async function planMove(
  from: string,
  to: string,
  bundles: readonly BundleDefinition[],
): Promise<{ move: MoveRepo[]; present: MoveRepo[]; blocked: MoveRepo[]; bytes: number }> {
  const source = await scanModelsDir(from, bundles);
  const move: MoveRepo[] = [];
  const present: MoveRepo[] = [];
  const blocked: MoveRepo[] = [];
  for (const repo of source.repos.filter((r) => r.known)) {
    const item = { repo: repo.repo, revision: repo.revision, bytes: repo.bytes };
    const there = path.join(to, ...repo.repo.split('/'));
    if (!(await fs.stat(there).catch(() => null))) move.push(item);
    else if ((await readManifest(there))?.revision === repo.revision) present.push(item);
    else blocked.push(item);
  }
  return { move, present, blocked, bytes: move.reduce((n, r) => n + r.bytes, 0) };
}

export interface MoveProgress {
  phase: 'moving' | 'validating' | 'publishing';
  done: number;
  total: number;
}

export interface MoveOptions {
  from: string;
  to: string;
  repos: readonly MoveRepo[];
  sameVolume: boolean;
  signal: AbortSignal;
  onProgress?: (progress: MoveProgress) => void;
  /** 测试用：每个仓库放到位之前调一次（注入中途的失败）。 */
  beforePlace?: (repo: string) => Promise<void> | void;
}

interface MoveJournal {
  format_version: 1;
  to: string;
  sameVolume: boolean;
  repos: string[];
}

/**
 * 把仓库从 `from` 移到 `to`，并把安装记录合并过去。成功时仓库都在 `to` 里（跨盘时原目录里的还在，等换过去之后
 * `removeSources` 删），日志还在（换过去之后 `clearMoveJournal`）；失败或取消时回滚：`to` 里不留移过来的东西，原目录原样，
 * 抛出原来的错误。
 */
export async function moveModels(options: MoveOptions): Promise<void> {
  const { from, to, repos, signal } = options;
  const total = repos.reduce((n, r) => n + r.bytes, 0);
  const journalFile = path.join(from, MOVE_JOURNAL_FILE);
  const journal: MoveJournal = { format_version: 1, to, sameVolume: options.sameVolume, repos: repos.map((r) => r.repo) };
  await fs.writeFile(journalFile, `${JSON.stringify(journal, null, 2)}\n`);
  const placed: string[] = [];
  const staging = path.join(to, MOVING_DIR);
  try {
    if (options.sameVolume) {
      let done = 0;
      options.onProgress?.({ phase: 'moving', done, total });
      for (const repo of repos) {
        signal.throwIfAborted();
        await options.beforePlace?.(repo.repo);
        const target = repoDir(to, repo.repo);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.rename(repoDir(from, repo.repo), target);
        placed.push(repo.repo);
        done += repo.bytes;
        options.onProgress?.({ phase: 'moving', done, total });
      }
    } else {
      await fs.rm(staging, { recursive: true, force: true });
      let done = 0;
      options.onProgress?.({ phase: 'moving', done, total });
      for (const repo of repos) {
        await copyTree(repoDir(from, repo.repo), repoDir(staging, repo.repo), signal, (n) => {
          done += n;
          options.onProgress?.({ phase: 'moving', done: Math.min(done, total), total });
        });
      }
      let checked = 0;
      options.onProgress?.({ phase: 'validating', done: 0, total });
      for (const repo of repos) {
        await verifyRepo(repoDir(staging, repo.repo), repo, signal, (n) => {
          checked += n;
          options.onProgress?.({ phase: 'validating', done: Math.min(checked, total), total });
        });
      }
      options.onProgress?.({ phase: 'publishing', done: total, total });
      for (const repo of repos) {
        signal.throwIfAborted();
        await options.beforePlace?.(repo.repo);
        const target = repoDir(to, repo.repo);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.rename(repoDir(staging, repo.repo), target);
        placed.push(repo.repo);
      }
      await fs.rm(staging, { recursive: true, force: true });
    }
    await mergeInstallRecord(from, to);
  } catch (error) {
    await undoMove(from, to, placed, options.sameVolume);
    await fs.rm(journalFile, { force: true });
    throw error;
  }
  // 日志留到调用方换过去之后（`clearMoveJournal`）：在那之前崩溃，下次启动照样回滚。
}

/** 换过去之后删掉原目录里的移动日志。 */
export async function clearMoveJournal(from: string): Promise<void> {
  await fs.rm(path.join(from, MOVE_JOURNAL_FILE), { force: true }).catch(() => {});
}

/** 换过去之后删掉原目录里已经移走（或目标里本来就有）的仓库与安装记录。删不掉的返回出来，不抛错。 */
export async function removeSources(from: string, repos: readonly string[]): Promise<string[]> {
  const failed: string[] = [];
  for (const repo of repos) {
    const dir = repoDir(from, repo);
    try {
      await fs.rm(dir, { recursive: true, force: true });
      await fs.rmdir(path.dirname(dir)).catch(() => {});
    } catch {
      failed.push(repo);
    }
  }
  await fs.rm(path.join(from, INSTALL_RECORD_FILE), { force: true }).catch(() => {});
  return failed;
}

/**
 * Runtime 启动时：上次的移动没有做完（原目录里还有日志）时回滚。同一块盘时把已经改名过去的仓库改名回来；跨盘时删掉
 * 目标里的暂存目录（原目录的文件一直没动）。返回回滚了几个仓库；没有日志时 null。
 */
export async function recoverMove(from: string): Promise<{ restored: string[] } | null> {
  const journalFile = path.join(from, MOVE_JOURNAL_FILE);
  let journal: MoveJournal;
  try {
    journal = JSON.parse(await fs.readFile(journalFile, 'utf8')) as MoveJournal;
  } catch {
    return null;
  }
  const restored: string[] = [];
  if (journal && typeof journal.to === 'string' && Array.isArray(journal.repos)) {
    if (journal.sameVolume) {
      for (const repo of journal.repos) {
        if (typeof repo !== 'string') continue;
        const back = repoDir(from, repo);
        const there = repoDir(journal.to, repo);
        if ((await fs.stat(back).catch(() => null)) || !(await fs.stat(there).catch(() => null))) continue;
        await fs.mkdir(path.dirname(back), { recursive: true });
        await fs.rename(there, back).then(
          () => restored.push(repo),
          () => {},
        );
      }
    }
    await fs.rm(path.join(journal.to, MOVING_DIR), { recursive: true, force: true }).catch(() => {});
  }
  await fs.rm(journalFile, { force: true });
  return { restored };
}

/**
 * 把已经放到 `to` 里的仓库撤回：同一块盘时改名回 `from`，跨盘时删掉（原目录里那份一直在）。移动中途失败时自动做；
 * 搬完之后换不过去（写设置失败）时由调用方做。
 */
export async function undoMove(from: string, to: string, placed: readonly string[], same: boolean): Promise<void> {
  for (const repo of [...placed].reverse()) {
    const there = repoDir(to, repo);
    if (same) {
      const back = repoDir(from, repo);
      await fs.mkdir(path.dirname(back), { recursive: true }).catch(() => {});
      await fs.rename(there, back).catch(() => {});
    } else {
      await fs.rm(there, { recursive: true, force: true }).catch(() => {});
    }
    await fs.rmdir(path.dirname(there)).catch(() => {});
  }
  await fs.rm(path.join(to, MOVING_DIR), { recursive: true, force: true }).catch(() => {});
}

/** 安装记录合并进目标：两边都有的模型包用原目录的那条（移过去的是它）。 */
async function mergeInstallRecord(from: string, to: string): Promise<void> {
  const source = await readInstallRecord(from);
  if (Object.keys(source.bundles).length === 0) return;
  await updateInstallRecord(to, (record) => {
    Object.assign(record.bundles, source.bundles);
  });
}

function repoDir(root: string, repo: string): string {
  return path.join(root, ...repo.split('/'));
}

async function listDirs(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
}

/** 递归复制一个目录（普通文件与子目录；符号链接按指向的文件复制）。 */
async function copyTree(src: string, dst: string, signal: AbortSignal, onBytes: (n: number) => void): Promise<void> {
  signal.throwIfAborted();
  await fs.mkdir(dst, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    const stat = await fs.stat(from);
    if (stat.isDirectory()) await copyTree(from, to, signal, onBytes);
    else if (stat.isFile()) {
      const counter = new Transform({
        transform(chunk: Buffer, _enc, done) {
          onBytes(chunk.length);
          done(null, chunk);
        },
      });
      await pipeline(createReadStream(from), counter, createWriteStream(to), { signal });
    }
  }
}

/** 复制出来的仓库：清单在，清单里的每个文件大小与 sha256 都对。 */
async function verifyRepo(dir: string, repo: MoveRepo, signal: AbortSignal, onBytes: (n: number) => void): Promise<void> {
  const manifest = await readManifest(dir);
  if (!manifest || manifest.revision !== repo.revision) throw new Error(`Manifest of ${repo.repo} is wrong after copying`);
  for (const file of manifest.files) {
    signal.throwIfAborted();
    const full = path.join(dir, file.path);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat?.isFile() || stat.size !== file.size) throw new Error(`Size of ${file.path} in ${repo.repo} doesn't match after copying`);
    const hash = crypto.createHash('sha256');
    for await (const chunk of createReadStream(full, { signal })) {
      hash.update(chunk as Buffer);
      onBytes((chunk as Buffer).length);
    }
    if (hash.digest('hex') !== file.sha256) throw new Error(`Checksum of ${file.path} in ${repo.repo} doesn't match after copying`);
  }
}
