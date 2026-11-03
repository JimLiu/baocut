import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * macOS 的完全磁盘访问权限（架构设计 §12.11）：Runtime 报告状态，并把「系统拒绝访问受保护位置」的失败归成一类，
 * 界面与智能体只看 `details.systemAccess` 决定要不要给授权动作，不按文案判断。
 */

export type FullDiskAccess = 'granted' | 'missing';

/** `details.systemAccess` 的取值：现在只有完全磁盘访问权限。 */
export const FULL_DISK_ACCESS = 'fullDiskAccess' as const;

/** 没有完全磁盘访问权限就读不到的系统文件；只打开、不读内容。 */
export const FULL_DISK_PROBE_PATH = '/Library/Application Support/com.apple.TCC/TCC.db';

/**
 * 这台主机有没有完全磁盘访问权限：macOS 上以只读方式打开探测文件，成功是 `granted`，`EPERM` / `EACCES` 是 `missing`；
 * 别的系统、文件不在或别的错误无法判断，返回 undefined（界面不显示授权动作）。每次调用重新探测，不缓存。
 * 被拒绝的打开通常会让系统把应用记进「完全磁盘访问权限」的列表，授权对象是 BaoCut.app 这个应用包。
 */
export async function probeFullDiskAccess(
  platform: NodeJS.Platform = process.platform,
  probePath: string = FULL_DISK_PROBE_PATH,
): Promise<FullDiskAccess | undefined> {
  if (platform !== 'darwin') return undefined;
  try {
    const handle = await fs.open(probePath, 'r');
    await handle.close();
    return 'granted';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'EPERM' || code === 'EACCES' ? 'missing' : undefined;
  }
}

/** macOS 上系统按位置保护的几处：外置与网络卷、桌面、文稿、下载，以及 `~/Library` 下的 Safari 与应用容器。 */
const PROTECTED_HOME_DIRS: readonly string[] = ['Desktop', 'Documents', 'Downloads'];
const PROTECTED_LIBRARY_DIRS: readonly string[] = ['Safari', 'Containers', 'Group Containers', 'Cookies'];

/** 这个路径在 macOS 上是不是系统按位置保护的。只拼路径、不碰文件。 */
export function isMacProtectedPath(target: string, home: string | null = os.homedir() || null): boolean {
  const resolved = path.posix.normalize(target);
  if (resolved === '/Volumes' || resolved.startsWith('/Volumes/')) return true;
  if (!home) return false;
  const under = (dir: string) => resolved === dir || resolved.startsWith(`${dir}/`);
  return (
    PROTECTED_HOME_DIRS.some((name) => under(path.posix.join(home, name))) ||
    PROTECTED_LIBRARY_DIRS.some((name) => under(path.posix.join(home, 'Library', name)))
  );
}

export interface SystemAccessDetails {
  systemAccess: typeof FULL_DISK_ACCESS;
  path: string;
}

/**
 * macOS 拒绝访问受保护位置时给错误的 `details`：只认 `EPERM`（系统的访问控制报这个）且路径在受保护的位置；
 * 普通的 `EACCES`（文件权限位）与别的系统不在此列，返回 null，照各自的错误报告。
 */
export function systemAccessDetails(
  error: unknown,
  target: string,
  platform: NodeJS.Platform = process.platform,
  home: string | null = os.homedir() || null,
): SystemAccessDetails | null {
  if (platform !== 'darwin' || (error as NodeJS.ErrnoException | null)?.code !== 'EPERM') return null;
  return isMacProtectedPath(target, home) ? { systemAccess: FULL_DISK_ACCESS, path: target } : null;
}
