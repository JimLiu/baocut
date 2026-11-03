/**
 * macOS 的完全磁盘访问权限（架构设计 §12.11）：宿主只做两件事——打开系统设置里的那一页，和为让授权生效重新启动。
 * 地址写死在这里，渲染进程不能借它打开别的系统设置页；别的系统一律拒绝。
 */

/** 系统设置里「隐私与安全性 › 完全磁盘访问权限」的地址。 */
export const FULL_DISK_ACCESS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';

/** 打开系统设置里的完全磁盘访问权限页；不是 macOS 时抛错（界面在这些系统上本来没有入口）。 */
export async function openFullDiskAccess(open: (url: string) => Promise<void>, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (platform !== 'darwin') throw new Error('Full Disk Access only exists on macOS');
  await open(FULL_DISK_ACCESS_URL);
}

export interface RelaunchHost {
  platform: NodeJS.Platform;
  /** 手上有活时问用户；不继续就返回 false（取消）。没有活时直接返回 true。 */
  confirm(): Promise<boolean>;
  /** 标记这次退出不再问、并停掉自己起的 Runtime（后台留着的旧 Runtime 拿不到新授权）。 */
  prepare(): void;
  relaunch(): void;
  quit(): void;
}

/** 为让授权生效重新启动：先确认（有活时），再重新打开应用。返回有没有真的重启。 */
export async function relaunchForAccess(host: RelaunchHost): Promise<boolean> {
  if (host.platform !== 'darwin') throw new Error('Full Disk Access only exists on macOS');
  if (!(await host.confirm())) return false;
  host.prepare();
  host.relaunch();
  host.quit();
  return true;
}
