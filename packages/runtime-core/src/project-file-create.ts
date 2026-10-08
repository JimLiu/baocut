import fsp from 'node:fs/promises';
import path from 'node:path';
import { RpcError, type FileTarget, type Id, type ProjectFileEntry } from '@baocut/protocol';
import { RcExport, RcRuntime, RcSpace, RcWeb } from '@baocut/protocol/messages/runtime-core';
import { classifyFile, isIgnoredName } from './space-catalog.ts';

/**
 * `projects.files.create`（架构设计 §11.2；产品设计 §3.3 新标签页起始页的「新建网页」）：在项目目录（或无项目会话的
 * 工作目录）里独占新建一个文件。与 `projects.files.list` 同一个根目录、同一套越界与忽略规则：
 *
 * - `dir` 相对根目录、默认根目录；解析符号链接后仍须在根目录内，不能落在隐藏目录、依赖目录或视频目录（含 `video.db`）里。
 * - `name` 只取最后一段；拒绝空名、`.`、`..`、以 `.` 开头的名字与依赖目录名，控制字符也不收。
 * - 用 `wx` 独占创建，不覆盖已有文件：重名时依次试 `名字 2.扩展名`、`名字 3.扩展名`……。
 */

/** 新文件挂在谁名下：属于项目时按项目定位（与项目文件页签、Space 打开的是同一个标签），否则按会话。 */
export type ProjectFileScope = { projectId: Id } | { conversationId: Id };

export interface ProjectFileCreateParams {
  name: string;
  content: string;
  dir?: string;
}

/** 重名递增最多试到几。 */
const MAX_ATTEMPTS = 1000;

function isInside(rootReal: string, target: string): boolean {
  if (target === rootReal) return true;
  const prefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  return target.startsWith(prefix);
}

/** 含 `video.db`（改名之前是 `movie.db`）的目录是一个视频：里面的文件归视频管。 */
async function isVideoDir(dir: string): Promise<boolean> {
  for (const name of ['video.db', 'movie.db']) {
    const stat = await fsp.stat(path.join(dir, name)).catch(() => null);
    if (stat?.isFile()) return true;
  }
  return false;
}

/** 解析 `dir`：返回逻辑上的相对路径（`/` 分隔）与真实路径。错误码与 `projects.files.list` 一致。 */
async function resolveDir(root: string, rootReal: string, dir: string | undefined): Promise<{ rel: string; real: string }> {
  const raw = dir ?? '';
  if (raw.includes('\0')) throw new RpcError('invalid-request', RcRuntime.folderPathInvalid());
  if (path.isAbsolute(raw)) throw new RpcError('invalid-request', RcRuntime.folderPathMustBeRelative());
  const relNative = path.relative(root, path.resolve(root, raw));
  if (relNative === '..' || relNative.startsWith(`..${path.sep}`) || path.isAbsolute(relNative)) {
    throw new RpcError('invalid-request', RcRuntime.folderOutsideProject());
  }
  const parts = relNative.split(path.sep).filter(Boolean);
  if (parts.some(isIgnoredName)) throw new RpcError('invalid-request', RcSpace.hiddenDirFile());
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
  // 目标目录本身与它的每一层上级（根目录以下）都不能是视频目录。
  for (let i = parts.length; i > 0; i--) {
    if (await isVideoDir(path.join(root, ...parts.slice(0, i)))) throw new RpcError('invalid-request', RcSpace.videoDirFile());
  }
  if (path.relative(rootReal, real) && (await isVideoDir(real))) throw new RpcError('invalid-request', RcSpace.videoDirFile());
  return { rel: parts.join('/'), real };
}

/** 文件名只取最后一段；不合格的拒绝。 */
function fileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new RpcError('invalid-request', RcWeb.fileNameInvalid());
  const base = path.basename(name.replaceAll('\\', '/').trim());
  if (!base) throw new RpcError('invalid-request', RcWeb.fileNameLength({ max: 255 }));
  // `.`、`..` 与其他以点开头的名字都算隐藏。
  if (isIgnoredName(base)) throw new RpcError('invalid-request', RcSpace.hiddenDirFile());
  return base;
}

/** 第 n 个候选名：1 是原名，之后是 `名字 n.扩展名`（扩展名取最后一个点之后，开头的点不算）。 */
export function numberedName(name: string, n: number): string {
  if (n <= 1) return name;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} ${n}${name.slice(dot)}` : `${name} ${n}`;
}

/** `projects.files.create` 的实现。`root` 是登记的根目录（项目目录或会话工作目录），`scope` 决定返回的定位怎么写。 */
export async function createProjectFile(
  root: string,
  scope: ProjectFileScope,
  params: ProjectFileCreateParams,
): Promise<{ target: FileTarget; entry: ProjectFileEntry }> {
  let rootReal: string;
  try {
    rootReal = await fsp.realpath(root);
  } catch {
    throw new RpcError('not-found', RcRuntime.projectFolderNotFound());
  }
  const base = fileName(params.name);
  const dir = await resolveDir(root, rootReal, params.dir);
  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
    const name = numberedName(base, n);
    const full = path.join(dir.real, name);
    try {
      await fsp.writeFile(full, params.content, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      // 没有权限、只读卷等照实交给网关（`internal`，日志里有原因）。
      throw error;
    }
    const stat = await fsp.stat(full);
    const rel = dir.rel ? `${dir.rel}/${name}` : name;
    return {
      target: 'projectId' in scope ? { projectId: scope.projectId, path: rel } : { conversationId: scope.conversationId, path: rel },
      entry: { path: rel, name, isDir: false, size: stat.size, modifiedAt: new Date(stat.mtimeMs).toISOString(), kind: classifyFile(name) },
    };
  }
  throw new RpcError('conflict', RcExport.destinationFileExists({ fileName: base }));
}
