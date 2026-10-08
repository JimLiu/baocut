// i18n-ignore-file: 只有给模型的工具错误（ToolError）
import { randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ToolError } from './tool-catalog.ts';

/**
 * `artifacts_save` 的落盘（架构设计 §3.5）：把一个产物复制成会话工作目录里的一个文件。只写这一个文件：
 *
 * - 目标解析到工作目录以内（按真实路径判断，穿过符号链接的目录也算在外面）；
 * - 目标本身是符号链接时拒绝，不顺着它写；已有文件只有 `overwrite` 才替换（先写临时文件再改名，不跟随链接）；
 * - 不写进视频目录（有 `video.db` 的目录）与 `.bcut`：那里只由引擎与 Runtime 写。
 */
export async function saveArtifactCopy(params: SaveParams): Promise<{ relPath: string; overwritten: boolean }> {
  return (await prepareArtifactSave(params)).commit();
}

interface SaveParams {
  source: string;
  root: string;
  target: string;
  overwrite: boolean;
}

/** 检查过的落盘计划：目标（相对工作目录）、它是否已经存在（覆盖），确认之后 `commit` 才写。 */
export interface ArtifactSavePlan {
  relPath: string;
  exists: boolean;
  commit(): Promise<{ relPath: string; overwritten: boolean }>;
}

/**
 * 先检查、后写（§3.12）：路径不合法的在这里就拒绝，不生成审批；覆盖与否在确认之前就知道（覆盖是 `high`）。
 * 这一步不创建目录、不写文件；`commit` 时重新按真实路径检查一遍，检查之后才出现的符号链接与文件同样拒绝。
 */
export async function prepareArtifactSave(params: SaveParams): Promise<ArtifactSavePlan> {
  const rootReal = await fs.realpath(params.root);
  const extension = path.extname(params.source).slice(1).toLowerCase();
  const target = withExtension(params.target, extension);
  const resolved = path.resolve(rootReal, target);
  const name = path.basename(resolved);
  if (!name || resolved === rootReal) throw new ToolError('INVALID_PATH', 'path 要是一个文件路径');

  // 已经存在的最深一层上级目录按真实路径判断；其余还不存在的层由这里新建。
  const tail: string[] = [];
  let existing = path.dirname(resolved);
  for (;;) {
    const stat = await fs.lstat(existing).catch(() => null);
    if (stat) {
      if (!stat.isDirectory() && !stat.isSymbolicLink()) throw new ToolError('INVALID_PATH', `${path.basename(existing)} 不是目录`);
      break;
    }
    tail.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const existingReal = await fs.realpath(existing).catch(() => null);
  if (!existingReal || !inside(existingReal, rootReal)) throw outside();
  await refuseVideoDirectory(rootReal, existingReal, [...tail, name]);

  // 上级目录都在时看目标本身；有还不存在的层时目标也不存在。
  const planned = path.join(existingReal, ...tail, name);
  const found = tail.length === 0 ? await checkTarget(planned, rootReal, params.overwrite) : null;
  return {
    relPath: path.relative(rootReal, planned),
    exists: found !== null,
    // 确认的是「新建」时不覆盖之后才出现的同名文件：覆盖要按 `high` 另行确认。
    commit: () => write({ ...params, overwrite: params.overwrite && found !== null }, rootReal, existingReal, tail, name),
  };
}

/** 目标已经存在时：符号链接、不是文件、没有 `overwrite` 都拒绝。返回它的状态；不存在时为 null。 */
async function checkTarget(file: string, rootReal: string, overwrite: boolean): Promise<Stats | null> {
  const current = await fs.lstat(file).catch(() => null);
  if (current?.isSymbolicLink()) throw new ToolError('PATH_IS_SYMLINK', '目标是一个符号链接：换一个文件名');
  if (current && !current.isFile()) throw new ToolError('INVALID_PATH', '目标已经存在，而且不是文件');
  if (current && !overwrite) {
    throw new ToolError('PATH_EXISTS', '目标文件已经存在：换一个文件名；确实要替换时带上 overwrite: true', {
      path: path.relative(rootReal, file),
    });
  }
  return current;
}

async function write(
  params: SaveParams,
  rootReal: string,
  existingReal: string,
  tail: string[],
  name: string,
): Promise<{ relPath: string; overwritten: boolean }> {
  const dir = path.join(existingReal, ...tail);
  await fs.mkdir(dir, { recursive: true });
  const dirReal = await fs.realpath(dir);
  if (!inside(dirReal, rootReal)) throw outside();
  const file = path.join(dirReal, name);
  const current = await checkTarget(file, rootReal, params.overwrite);

  const bytes = await fs.readFile(params.source);
  if (!current) {
    // 'wx'：已经存在（含同时出现的符号链接）时失败，不覆盖、不跟随。
    try {
      await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o644 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new ToolError('PATH_EXISTS', '目标文件已经存在：换一个文件名；确实要替换时带上 overwrite: true');
      }
      throw error;
    }
  } else {
    const tmp = path.join(dirReal, `.${name}.${randomUUID()}.tmp`);
    await fs.writeFile(tmp, bytes, { flag: 'wx', mode: 0o644 });
    await fs.rename(tmp, file).catch(async (error: unknown) => {
      await fs.rm(tmp, { force: true });
      throw error;
    });
  }
  return { relPath: path.relative(rootReal, file), overwritten: Boolean(current) };
}

/** 没写扩展名时补上产物的；写了别的扩展名时拒绝（jpg 与 jpeg 算同一种）。 */
function withExtension(target: string, extension: string): string {
  const given = path.extname(target).slice(1).toLowerCase();
  if (!given) return `${target}.${extension}`;
  const same = given === extension || (given === 'jpeg' && extension === 'jpg');
  if (!same) throw new ToolError('EXTENSION_MISMATCH', `这个产物是 .${extension} 文件，path 的扩展名要一致（或省略扩展名）`, { extension });
  return target;
}

/** 目标在视频目录或 `.bcut` 里时拒绝：工作目录到目标之间的每一层都不能是。 */
export async function refuseVideoDirectory(rootReal: string, existingReal: string, rest: string[]): Promise<void> {
  const relative = path.relative(rootReal, existingReal);
  const segments = [...(relative ? relative.split(path.sep) : []), ...rest];
  if (segments.includes('.bcut') || ['video.db', 'video.lock'].includes(rest[rest.length - 1]!)) throw insideVideo();
  let dir = existingReal;
  for (;;) {
    if (
      await fs.stat(path.join(dir, 'video.db')).then(
        () => true,
        () => false,
      )
    )
      throw insideVideo();
    if (dir === rootReal) return;
    dir = path.dirname(dir);
  }
}

export function inside(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

export function outside(): ToolError {
  return new ToolError('PATH_OUTSIDE_WORKSPACE', '只能写到这个会话的工作目录里（相对路径，不含 ..，不经过指向别处的符号链接）');
}

function insideVideo(): ToolError {
  return new ToolError(
    'PATH_INSIDE_VIDEO',
    '不能写进视频目录（含 video.db 的目录）或 .bcut：换一个工作目录里的位置；要放进视频用 edits_apply 的 importAsset',
  );
}
