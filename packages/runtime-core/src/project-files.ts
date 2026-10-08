import type { Dirent, Stats } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  MAX_PROJECT_FILES_LIMIT,
  RpcError,
  type ProjectFileEntry,
  type ProjectFilesList,
  type SpaceEntryKind,
} from '@baocut/protocol';
import { classifyFile, isIgnoredName } from './space-catalog.ts';
import { RcRuntime } from '@baocut/protocol/messages/runtime-core';

/**
 * 项目文件浏览（架构设计 §11.2）：只读，限定在会话所属项目的目录（或无项目会话的工作目录）里。
 *
 * - `dir` 与每一项都要在根目录之内：`dir` 解析符号链接之后越界就拒绝（`invalid-request`），
 *   指出根目录的符号链接与悬空链接不列。
 * - 跳过隐藏文件与依赖目录（与 Space 同一张忽略表：`.git`、`.baocut`、`node_modules` 等）。
 * - 查找时不进入符号链接目录（避免绕圈），也不进入视频目录（含 `video.db`，整个目录算一项）。
 * - 返回的 `path` 按目录的逻辑路径拼出（不从真实路径反推），可以原样交给 `{ conversationId, path }`。
 */

export interface ProjectFilesLimits {
  /** 不给 `limit` 时，列一层最多返回多少项。 */
  listLimit: number;
  /** 不给 `limit` 时，查找最多返回多少项。 */
  searchLimit: number;
  /** 查找时进入子目录的最大深度，`dir` 本身是 0。 */
  maxDepth: number;
  /** 查找时最多看多少个目录项，防止很大的目录查个没完。 */
  maxVisited: number;
  /** 查找时最多留多少个候选（排序之前）。 */
  maxCandidates: number;
}

export const DEFAULT_PROJECT_FILES_LIMITS: ProjectFilesLimits = {
  listLimit: 500,
  searchLimit: 200,
  maxDepth: 12,
  maxVisited: 50_000,
  maxCandidates: 2000,
};

export interface ProjectFilesParams {
  dir?: string;
  query?: string;
  limit?: number;
}

/** 一个候选：先定下名字、类型与排序信息，最后只给要返回的那几项取大小与时间。 */
interface Candidate {
  path: string;
  name: string;
  /** 用来取大小与时间的真实路径（符号链接已解析）。 */
  full: string;
  isDir: boolean;
  kind: SpaceEntryKind | null;
  /** 已经取过的状态（符号链接、视频目录的 `video.db`）。 */
  stat: Stats | null;
  depth: number;
  rank: number;
}

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

function compareNames(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

function isInside(rootReal: string, target: string): boolean {
  if (target === rootReal) return true;
  const prefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  return target.startsWith(prefix);
}

function joinRel(rel: string, name: string): string {
  return rel ? `${rel}/${name}` : name;
}

/** 含 `video.db`（改名之前是 `movie.db`）的目录是一个视频；返回数据库文件的状态。 */
async function videoDb(dir: string): Promise<Stats | null> {
  for (const name of ['video.db', 'movie.db']) {
    const stat = await fsp.stat(path.join(dir, name)).catch(() => null);
    if (stat?.isFile()) return stat;
  }
  return null;
}

/**
 * 看一个目录项：符号链接解析到真实路径，越界或悬空返回 null；不是普通文件或目录的也返回 null。
 * 普通目录项不做 realpath：它的父目录已经确认在根目录之内。
 */
async function inspect(
  rootReal: string,
  dirReal: string,
  dirent: Dirent,
): Promise<{ full: string; isDir: boolean; isLink: boolean; stat: Stats | null } | null> {
  const full = path.join(dirReal, dirent.name);
  if (dirent.isSymbolicLink()) {
    const real = await fsp.realpath(full).catch(() => null);
    if (!real || !isInside(rootReal, real)) return null;
    const stat = await fsp.stat(real).catch(() => null);
    if (!stat || !(stat.isFile() || stat.isDirectory())) return null;
    return { full: real, isDir: stat.isDirectory(), isLink: true, stat };
  }
  if (dirent.isDirectory()) return { full, isDir: true, isLink: false, stat: null };
  if (dirent.isFile()) return { full, isDir: false, isLink: false, stat: null };
  return null;
}

/** 名字匹配的名次：完全相同 0，开头相同 1，包含 2；不匹配 -1。 */
function matchRank(name: string, query: string): number {
  const lower = name.toLowerCase();
  if (lower === query) return 0;
  if (lower.startsWith(query)) return 1;
  return lower.includes(query) ? 2 : -1;
}

/** 解析 `dir`：返回逻辑上的相对路径（`/` 分隔）与真实路径。 */
async function resolveDir(root: string, rootReal: string, dir: string | undefined): Promise<{ rel: string; real: string }> {
  const raw = dir ?? '';
  if (raw.includes('\0')) throw new RpcError('invalid-request', RcRuntime.folderPathInvalid());
  if (path.isAbsolute(raw)) throw new RpcError('invalid-request', RcRuntime.folderPathMustBeRelative());
  const relNative = path.relative(root, path.resolve(root, raw));
  if (relNative === '..' || relNative.startsWith(`..${path.sep}`) || path.isAbsolute(relNative)) {
    throw new RpcError('invalid-request', RcRuntime.folderOutsideProject());
  }
  const rel = relNative.split(path.sep).filter(Boolean).join('/');
  if (rel && rel.split('/').some(isIgnoredName)) throw new RpcError('invalid-request', RcRuntime.folderNotBrowsable());
  let real: string;
  try {
    real = await fsp.realpath(path.join(root, relNative));
  } catch {
    throw new RpcError('not-found', RcRuntime.folderNotFound());
  }
  if (!isInside(rootReal, real)) throw new RpcError('invalid-request', RcRuntime.folderOutsideProject());
  const stat = await fsp.stat(real).catch(() => null);
  if (!stat) throw new RpcError('not-found', RcRuntime.folderNotFound());
  if (!stat.isDirectory()) throw new RpcError('invalid-request', RcRuntime.notAFolder());
  return { rel, real };
}

async function readDir(dir: string): Promise<Dirent[] | null> {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

/** 给要返回的候选取大小与时间。取不到（期间被删掉）的丢掉。 */
async function toEntries(candidates: Candidate[]): Promise<ProjectFileEntry[]> {
  const entries = await Promise.all(
    candidates.map(async (c): Promise<ProjectFileEntry | null> => {
      const stat = c.stat ?? (await fsp.stat(c.full).catch(() => null));
      if (!stat) return null;
      return {
        path: c.path,
        name: c.name,
        isDir: c.isDir,
        size: c.isDir ? null : stat.size,
        modifiedAt: new Date(stat.mtimeMs).toISOString(),
        kind: c.kind,
      };
    }),
  );
  return entries.filter((e): e is ProjectFileEntry => e !== null);
}

async function candidateOf(
  rootReal: string,
  dirReal: string,
  rel: string,
  dirent: Dirent,
  depth: number,
  rank: number,
): Promise<(Candidate & { isLink: boolean }) | null> {
  const found = await inspect(rootReal, dirReal, dirent);
  if (!found) return null;
  let kind: SpaceEntryKind | null = null;
  let stat = found.stat;
  if (found.isDir) {
    const db = await videoDb(found.full);
    if (db) {
      kind = 'video';
      stat = db;
    }
  } else kind = classifyFile(dirent.name);
  return {
    path: joinRel(rel, dirent.name),
    name: dirent.name,
    full: found.full,
    isDir: found.isDir,
    isLink: found.isLink,
    kind,
    stat,
    depth,
    rank,
  };
}

async function listOne(rootReal: string, dir: { rel: string; real: string }, limit: number): Promise<{ entries: ProjectFileEntry[]; truncated: boolean }> {
  const dirents = await readDir(dir.real);
  if (!dirents) throw new RpcError('forbidden', RcRuntime.folderUnreadable());
  const candidates: Candidate[] = [];
  for (const dirent of dirents) {
    if (isIgnoredName(dirent.name)) continue;
    const candidate = await candidateOf(rootReal, dir.real, dir.rel, dirent, 0, 0);
    if (candidate) candidates.push(candidate);
  }
  candidates.sort((a, b) => Number(b.isDir) - Number(a.isDir) || compareNames(a.name, b.name));
  return { entries: await toEntries(candidates.slice(0, limit)), truncated: candidates.length > limit };
}

async function search(
  rootReal: string,
  start: { rel: string; real: string },
  query: string,
  limit: number,
  limits: ProjectFilesLimits,
): Promise<{ entries: ProjectFileEntry[]; truncated: boolean }> {
  const candidates: Candidate[] = [];
  const queue: { rel: string; real: string; depth: number }[] = [{ ...start, depth: 0 }];
  let visited = 0;
  let truncated = false;
  walk: while (queue.length > 0) {
    const { rel, real, depth } = queue.shift()!;
    const dirents = await readDir(real);
    if (!dirents) {
      if (depth === 0) throw new RpcError('forbidden', RcRuntime.folderUnreadable());
      continue;
    }
    dirents.sort((a, b) => compareNames(a.name, b.name));
    for (const dirent of dirents) {
      if (++visited > limits.maxVisited) {
        truncated = true;
        break walk;
      }
      if (isIgnoredName(dirent.name)) continue;
      const rank = matchRank(dirent.name, query);
      // 不匹配的文件不用再看；目录还要往里走。
      if (rank < 0 && !dirent.isDirectory()) continue;
      const candidate = await candidateOf(rootReal, real, rel, dirent, depth, rank);
      if (!candidate) continue;
      if (rank >= 0) {
        if (candidates.length >= limits.maxCandidates) {
          truncated = true;
          break walk;
        }
        candidates.push(candidate);
      }
      if (candidate.isDir && !candidate.isLink && candidate.kind !== 'video' && depth < limits.maxDepth) {
        queue.push({ rel: candidate.path, real: candidate.full, depth: depth + 1 });
      }
    }
  }
  candidates.sort((a, b) => a.rank - b.rank || a.depth - b.depth || compareNames(a.path, b.path));
  return {
    entries: await toEntries(candidates.slice(0, limit)),
    truncated: truncated || candidates.length > limit,
  };
}

/**
 * `projects.files.list` 的实现。`root` 是登记的根目录（项目目录或会话工作目录），返回里原样带回。
 */
export async function listProjectFiles(
  root: string,
  params: ProjectFilesParams,
  limits: ProjectFilesLimits = DEFAULT_PROJECT_FILES_LIMITS,
): Promise<ProjectFilesList> {
  let rootReal: string;
  try {
    rootReal = await fsp.realpath(root);
  } catch {
    throw new RpcError('not-found', RcRuntime.projectFolderNotFound());
  }
  const dir = await resolveDir(root, rootReal, params.dir);
  const query = (params.query ?? '').trim().toLowerCase();
  const cap = (fallback: number) => Math.max(1, Math.min(params.limit ?? fallback, MAX_PROJECT_FILES_LIMIT));
  const result = query
    ? await search(rootReal, dir, query, cap(limits.searchLimit), limits)
    : await listOne(rootReal, dir, cap(limits.listLimit));
  return { root, ...result };
}
