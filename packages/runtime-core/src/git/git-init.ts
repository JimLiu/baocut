import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ProjectGitInitRefusal } from '@baocut/protocol';

/**
 * 「初始化 git」不在哪里做（版本记录设计 §5.3）：用户主目录、系统的标准用户文件夹（桌面、文稿、下载、影片、音乐、图片，以及
 * Windows 上对应的已知文件夹）和卷或盘符的根。在那里建 `.git` 会让下面所有文件夹在别的工具看来都处在一个仓库里。
 *
 * - 按真实路径比较；Windows 与 macOS 的文件系统默认不分大小写，比较时也不分。
 * - 标准用户文件夹按主目录下的固定名字认（macOS 的 Movies、Windows 与 Linux 的 Videos 都算）。Windows 上被重定向的已知文件夹
 *   （OneDrive 里的桌面与文档）不另外解析。
 * - 卷的根：路径的根（`/`、`C:\`、`\\server\share\`），macOS 的 `/Volumes/<卷>`，Linux 的 `/media/<用户>/<卷>`、
 *   `/run/media/<用户>/<卷>` 与 `/mnt/<卷>`。
 */

const USER_FOLDERS = ['Desktop', 'Documents', 'Downloads', 'Movies', 'Videos', 'Music', 'Pictures'] as const;

export interface InitRefusalOptions {
  home?: string;
  platform?: NodeJS.Platform;
}

/** 不能初始化的原因；能初始化时 null。`dir` 按真实路径判断（不存在时按给的路径）。 */
export async function initRefusal(
  dir: string,
  options: InitRefusalOptions = {},
): Promise<{ refusal: Exclude<ProjectGitInitRefusal, 'inside-repo'>; folder?: string } | null> {
  const platform = options.platform ?? process.platform;
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const real = await realOrSelf(dir);
  const home = await realOrSelf(options.home ?? os.homedir());
  const fold = (value: string) => {
    const normalized = paths.resolve(value).replace(/[\\/]+$/, '') || paths.parse(paths.resolve(value)).root;
    return platform === 'win32' || platform === 'darwin' ? normalized.toLowerCase() : normalized;
  };
  const target = fold(real);
  if (target === fold(home)) return { refusal: 'home' };
  for (const name of USER_FOLDERS) {
    if (target === fold(paths.join(home, name))) return { refusal: 'user-folder', folder: paths.join(home, name) };
  }
  if (isVolumeRoot(paths.resolve(real), platform)) return { refusal: 'volume-root' };
  return null;
}

function isVolumeRoot(dir: string, platform: NodeJS.Platform): boolean {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const trimmed = dir.replace(/[\\/]+$/, '');
  const root = paths.parse(dir).root.replace(/[\\/]+$/, '');
  if (trimmed === root || trimmed === '') return true;
  if (platform === 'win32') return false;
  const parts = trimmed.split('/').filter(Boolean);
  if (platform === 'darwin') return parts.length === 2 && parts[0] === 'Volumes';
  if (parts[0] === 'mnt') return parts.length === 2;
  if (parts[0] === 'media') return parts.length === 3 || parts.length === 2;
  if (parts[0] === 'run' && parts[1] === 'media') return parts.length === 4;
  return false;
}

async function realOrSelf(dir: string): Promise<string> {
  return await fs.realpath(dir).catch(() => dir);
}
