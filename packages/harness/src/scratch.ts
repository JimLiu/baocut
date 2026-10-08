import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 不属于项目的会话的工作目录（`RuntimeHome.scratchDir/<会话>/`）与项目目录之间搬东西（架构设计 §3.10）。
 * 只做文件系统的事：判断里面有没有视频、取视频的名字、把条目搬进项目目录。会话与项目的记录由 Harness 管。
 */

/** 视频目录的标志（视频格式规范 §1）；改名之前的目录只有 `movie.db`。 */
const VIDEO_DB_FILES = ['video.db', 'movie.db'];
/** 找视频时往下走的最大深度（与 Space 的扫描相同）。 */
const MAX_DEPTH = 6;

/** 目录本身是不是一个视频。 */
export async function isVideoDirectory(dir: string): Promise<boolean> {
  for (const name of VIDEO_DB_FILES) {
    const stat = await fs.stat(path.join(dir, name)).catch(() => null);
    if (stat?.isFile()) return true;
  }
  return false;
}

/** 目录里（含子目录，跳过隐藏目录与符号链接）有没有视频。目录不在时为 false。 */
export async function containsVideo(dir: string, depth = 0): Promise<boolean> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (await isVideoDirectory(full)) return true;
    if (depth < MAX_DEPTH && (await containsVideo(full, depth + 1))) return true;
  }
  return false;
}

/**
 * 目录里（规则同 `containsVideo`）最早建的视频的名字（视频目录名），给按视频命名的项目用。没有视频时为 null。
 * 先后按视频库文件的创建时间（取不到时修改时间），同时的按名字。
 */
export async function firstVideoName(dir: string): Promise<string | null> {
  const found: { name: string; at: number }[] = [];
  const walk = async (current: string, depth: number): Promise<void> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      const at = await videoCreatedAt(full);
      if (at !== null) found.push({ name: entry.name, at });
      else if (depth < MAX_DEPTH) await walk(full, depth + 1);
    }
  };
  await walk(dir, 0);
  found.sort((a, b) => a.at - b.at || a.name.localeCompare(b.name));
  return found[0]?.name ?? null;
}

async function videoCreatedAt(dir: string): Promise<number | null> {
  for (const name of VIDEO_DB_FILES) {
    const stat = await fs.stat(path.join(dir, name)).catch(() => null);
    if (stat?.isFile()) return stat.birthtimeMs || stat.mtimeMs;
  }
  return null;
}

/** `child` 是否在 `parent` 里面（不含 `parent` 本身）。 */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * 把一个文件或目录搬到 `destDir` 下，名字已被占用时加序号（`名字 2`、`名字 3`…，扩展名保留）。同一卷上是改名；
 * 跨卷（`EXDEV`）时复制过去再删掉原来的。返回目标里的名字。
 */
export async function moveInto(source: string, destDir: string, name = path.basename(source)): Promise<string> {
  const ext = path.extname(name);
  const stem = ext && ext !== name ? name.slice(0, -ext.length) : name;
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? name : `${stem} ${n}${ext}`;
    const target = path.join(destDir, candidate);
    // `rename` 会替换一个空目录或已有文件：先确认目标不在。
    if (await fs.lstat(target).then(() => true, () => false)) continue;
    try {
      await fs.rename(source, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
      await fs.rm(source, { recursive: true, force: true });
    }
    return candidate;
  }
  throw new Error(`Too many entries named ${name}`);
}

/**
 * 把 `from` 里的条目（不含 `skip` 里的名字、`skipHidden` 时的隐藏条目，与 `busy` 里的目录及包含它们的目录）原样搬进 `to`，相对路径不变（重名的加序号）。
 * `from` 不在时什么也不做。返回搬走的条目：原名 → 目标里的名字。
 */
export async function moveEntries(
  from: string,
  to: string,
  options: { skip?: ReadonlySet<string>; skipHidden?: boolean; busy?: readonly string[] } = {},
): Promise<Map<string, string>> {
  const moved = new Map<string, string>();
  let names: string[];
  try {
    names = await fs.readdir(from);
  } catch {
    return moved;
  }
  const busy = (options.busy ?? []).map((p) => path.resolve(p));
  for (const name of names) {
    if (options.skip?.has(name) || (options.skipHidden && name.startsWith('.'))) continue;
    const full = path.join(from, name);
    if (busy.some((b) => b === full || isInside(full, b))) continue;
    moved.set(name, await moveInto(full, to, name));
  }
  return moved;
}

/** 删除一个空目录；不空或不在时什么也不做。 */
export async function removeIfEmpty(dir: string): Promise<boolean> {
  try {
    await fs.rmdir(dir);
    return true;
  } catch {
    return false;
  }
}

/** 绑定时记下的项目目录还能不能接着用：在、是目录，并且是空的或已经是项目（有 `.bcut`，上次搬到一半）。 */
export async function reusableProjectDir(dir: string): Promise<boolean> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return false;
  }
  return names.length === 0 || names.includes('.bcut');
}
