import { execFile, execFileSync, spawn } from 'node:child_process';
import { constants as fsConstants, closeSync, openSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow, app, ipcMain, shell } from 'electron';
import {
  createPendingLaunch,
  installMac,
  installWindows,
  macCanAutoInstall,
  nsisInstalledCopy,
  prepareMac,
  type Exec,
} from './app-update-install.ts';
import {
  APPCAST_ENV,
  DOWNLOAD_PAGE,
  appBundleFromExecutable,
  availability,
  cacheDirectory,
  exeInAppBundle,
  feedTarget,
  feedUrl,
  isFileUrl,
} from './app-update-rules.ts';
import {
  createAppUpdateService,
  discardStaleDownloads,
  installationBucket,
  type AppUpdateService,
  type ByteSource,
} from './app-update-service.ts';

/*
 * 应用自动更新的 Electron 接线（架构设计 §2.6）：探测这次运行的环境、把真实的网络 / 命令 / 访达 / 退出交给服务，
 * 再经 IPC 暴露给预加载脚本（`window.baocut.updates`）。状态与提醒推给所有窗口。
 *
 * 开发构建（没打包）一律「开发构建不检查更新」，除非设了 `BAOCUT_UPDATE_APPCAST`；即使设了，开发构建也从不自动换包
 * （运行中的是 node_modules 里的 Electron.app），安装时只在访达里显示安装包并打开下载页。
 */

/** 检查（拉清单）的超时。 */
const CHECK_TIMEOUT_MS = 20_000;
/** 下载时多久没收到字节就算断了（不设总时长：安装包上百 MB，慢网也该下完）。 */
const STALL_TIMEOUT_MS = 60_000;
/** 清单最大多少字节。 */
const MANIFEST_MAX_BYTES = 4 * 1024 * 1024;
/** 用户数据目录里的安装标识，决定本机在分批推送里的位置。 */
const INSTALLATION_ID_FILE = 'update-installation-id';
/** Windows 的安装器以 `--updated` 重新打开应用后，过多久清掉缓存目录里的安装器（那时安装器早已退出）。 */
const INSTALLER_CLEANUP_DELAY_MS = 60_000;

const exec: Exec = (file, args, signal) =>
  new Promise((resolve) => {
    execFile(file, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, ...(signal ? { signal } : {}) }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });

/**
 * 打包时写进应用 package.json 的 build 号与变体（`tools/package-desktop.mjs`）：`baocutBuild` 没有时 0（不是发布版，
 * 不检查更新，见 `availability`）；`baocutVariant` 没有时 null（按标准版）。
 */
function readPackagedInfo(): { build: number; variant: string | null } {
  try {
    const pkg = JSON.parse(readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')) as {
      baocutBuild?: unknown;
      baocutVariant?: unknown;
    };
    const build = typeof pkg.baocutBuild === 'number' && Number.isInteger(pkg.baocutBuild) && pkg.baocutBuild > 0 ? pkg.baocutBuild : 0;
    const variant = typeof pkg.baocutVariant === 'string' && /^[a-z0-9]+$/.test(pkg.baocutVariant) ? pkg.baocutVariant : null;
    return { build, variant };
  } catch {
    return { build: 0, variant: null };
  }
}

let packagedInfoCache: { build: number; variant: string | null } | null = null;

function packagedInfo(): { build: number; variant: string | null } {
  packagedInfoCache ??= readPackagedInfo();
  return packagedInfoCache;
}

function currentBuild(): number {
  return packagedInfo().build;
}

/** 运行中的包的 `CFBundleIdentifier`（只在打包过的 macOS 应用上读，启动时一次）。 */
function bundleIdentifier(bundle: string | null): string | null {
  if (!bundle) return null;
  try {
    const plist = path.join(bundle, 'Contents', 'Info.plist');
    return execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plist], { encoding: 'utf8', timeout: 5000 }).trim() || null;
  } catch {
    return null;
  }
}

function userAgent(): string {
  return `BaoCut/${app.getVersion()} (build ${currentBuild()})`;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': userAgent() },
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > MANIFEST_MAX_BYTES) throw new Error('manifest is too large');
  return text;
}

/** 网络响应体 → 字节流；每收到一块就重置断流计时。 */
async function* readBody(body: ReadableStream<Uint8Array>, onChunk: () => void): ByteSource {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      onChunk();
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

async function openRemote(url: string, signal: AbortSignal): Promise<ByteSource> {
  const stall = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => stall.abort(new Error('download stalled')), STALL_TIMEOUT_MS);
  };
  arm();
  const response = await fetch(url, { headers: { 'User-Agent': userAgent() }, signal: AbortSignal.any([signal, stall.signal]) });
  if (!response.ok || !response.body) {
    clearTimeout(timer);
    throw new Error(`HTTP ${response.status}`);
  }
  const body = response.body;
  return (async function* () {
    try {
      yield* readBody(body, arm);
    } finally {
      clearTimeout(timer);
    }
  })();
}

async function writable(dir: string): Promise<boolean> {
  try {
    await fs.access(dir, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** 脱离应用进程起换包脚本（应用退出后它还在跑），输出写进日志。 */
function launchScript(script: string, log: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const fd = openSync(log, 'w');
    const child = spawn('/usr/bin/nohup', ['/bin/bash', script], { detached: true, stdio: ['ignore', fd, fd] });
    child.once('error', (error) => {
      closeSync(fd);
      reject(error);
    });
    child.once('spawn', () => {
      closeSync(fd);
      child.unref();
      resolve();
    });
  });
}

/** 脱离应用进程起安装器（应用退出后它还在跑）。进程在 `spawn` 里同步创建；起不来的错误只能记日志，应用已在退出。 */
function spawnDetached(file: string, args: readonly string[]): void {
  const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
  // i18n-ignore: 诊断日志，只打到主进程的终端，不进界面
  child.once('error', (error) => console.error(`[baocut] 应用更新：起安装器失败：${error.message}`));
  child.unref();
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

/** Windows 的安装版：NSIS 装的（exe 旁边有它的卸载程序）。zip 版没有。 */
function windowsInstalledCopy(): Promise<boolean> {
  return nsisInstalledCopy(process.execPath, isFile);
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

export function installAppUpdates(): AppUpdateService {
  const override = process.env[APPCAST_ENV]?.trim() || null;
  const platform = process.platform;
  const macos = platform === 'darwin';
  const target = feedTarget(platform, process.arch);
  const packaged = app.isPackaged;
  // 开发构建里运行的是 node_modules 的 Electron.app，不当它是要换的包。
  const runningBundle = macos && packaged ? appBundleFromExecutable(process.execPath) : null;
  const unsupported = availability({
    appStore: Boolean((process as { mas?: boolean }).mas),
    build: currentBuild(),
    feedOverride: override !== null,
    hasFeedTarget: target !== null,
    packaged,
    windows: platform === 'win32',
    bundleId: macos && packaged && !override && target ? bundleIdentifier(runningBundle) : null,
    exeInAppBundle: exeInAppBundle(process.execPath),
  });
  const cacheDir = cacheDirectory(platform, os.homedir(), process.env);
  const { variant } = packagedInfo();
  const mac = { exec, runningBundle, writable, cacheDir, pid: process.pid, launchScript };
  // i18n-ignore: 诊断日志，只打到主进程的终端，不进界面
  const log = (message: string) => console.log(`[baocut] 应用更新：${message}`);
  // Windows 的安装器等应用走完正常退出（`before-quit` 里停 Runtime，「重启并更新」或退出即安装记下它）才起：`will-quit` 在那之后。
  const installerOnQuit = createPendingLaunch(spawnDetached, log);
  app.on('will-quit', () => {
    // i18n-ignore: 诊断日志，只打到主进程的终端，不进界面
    if (installerOnQuit.fire()) log('安装器已起');
  });
  // 安装器装完以 `--updated` 重新打开应用：过一会儿清掉留在缓存目录里的安装器（只清这次启动之前的文件）。
  if (platform === 'win32' && packaged && cacheDir && process.argv.includes('--updated')) {
    const started = Date.now();
    setTimeout(() => void discardStaleDownloads(cacheDir, started), INSTALLER_CLEANUP_DELAY_MS).unref();
  }

  const service = createAppUpdateService({
    unsupported,
    target,
    variant,
    feed: override
      ? { url: override, allowFileUrl: isFileUrl(override) }
      : target
        ? { url: feedUrl(target, variant), allowFileUrl: false }
        : null,
    current: { version: app.getVersion(), build: currentBuild() },
    systemVersion: macos ? process.getSystemVersion() : null,
    macos,
    cacheDir,
    fetchText,
    openRemote,
    canAutoInstall: async () => {
      if (!packaged) return false;
      if (macos) return macCanAutoInstall(mac);
      return platform === 'win32' && (await windowsInstalledCopy());
    },
    // macOS 下载完就解开、验签（Windows 的安装器只核对摘要，在下载时已经做过）；开发构建从不自动换包，也不就位。
    prepare: async (info, archive, signal) => (packaged && macos ? prepareMac(info, archive, mac, signal) : { type: 'none' }),
    installPackage: async (info, archive, { staged, relaunch }) => {
      if (!packaged) return { type: 'fallback' };
      if (macos) return installMac(info, archive, mac, { staged, relaunch });
      if (platform === 'win32') {
        return installWindows(archive, { installedCopy: await windowsInstalledCopy(), launchOnQuit: installerOnQuit.arm }, relaunch);
      }
      return { type: 'fallback' };
    },
    reveal: (file) => shell.showItemInFolder(file),
    openDownloadPage: () => void shell.openExternal(DOWNLOAD_PAGE),
    quit: () => app.quit(),
    rolloutBucket: () => installationBucket(path.join(app.getPath('userData'), INSTALLATION_ID_FILE)),
    now: () => Date.now(),
    schedule: (run, ms) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
    log,
  });

  service.onState((snapshot) => broadcast('baocut:updates-state', snapshot));
  service.onNotice((notice) => broadcast('baocut:updates-notice', notice));
  ipcMain.handle('baocut:updates-get', () => service.snapshot());
  ipcMain.handle('baocut:updates-check', () => service.check('manual'));
  ipcMain.handle('baocut:updates-download', () => service.download());
  ipcMain.handle('baocut:updates-cancel', () => service.cancel());
  ipcMain.handle('baocut:updates-install', () => service.install());
  ipcMain.handle('baocut:updates-open-download-page', () => service.openDownloadPage());
  ipcMain.on('baocut:updates-configure', (_event, raw: unknown) => {
    const prefs = (raw ?? {}) as { autoCheck?: unknown; autoDownload?: unknown };
    if (typeof prefs.autoCheck !== 'boolean' || typeof prefs.autoDownload !== 'boolean') return;
    service.configure({ autoCheck: prefs.autoCheck, autoDownload: prefs.autoDownload });
  });
  service.start();
  return service;
}
