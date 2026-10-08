import path from 'node:path';
import { BrowserWindow, Menu, app, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { onLocaleChange, setLocale } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { appMenuTemplate } from './app-menu.ts';
import { installAppUpdates } from './app-update-ipc.ts';
import type { AppUpdateService } from './app-update-service.ts';
import { M } from './main-copy.ts';
import { messageFileProperties, messageFiles } from './message-files.ts';
import { localeFromRenderer, startupLocale } from './main-locale.ts';
import { packagedResources } from './packaged-resources.ts';
import { RuntimeSupervisor } from './runtime-supervisor.ts';
import { installWebTabs } from './web-tabs.ts';
import { openLocalFile } from './open-local-file.ts';

/**
 * 桌面端主进程：找到或启动 Runtime、开窗口、提供少量原生能力（选目录、在文件夹中显示）。
 * 业务逻辑都在 Runtime 里；界面经 WebSocket 直连 Runtime，主进程不转发业务请求（架构设计 §11.1）。
 *
 * 只做定义、没有副作用：入口（`index.ts`）先判断这次是不是离屏宿主，不是才调 `startDesktopApp`。
 */
export function startDesktopApp(): void {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  const isDev = !app.isPackaged;
  // 开发态 Electron 用它自己的默认图标；打包后 macOS / Windows 从包里的 .icns / .ico 读，不走这里。
  // 开发时 app.getAppPath() 是 apps/desktop，图标由 `npm run icons` 生成（tools/app-icon）。
  const devIcon = isDev ? path.join(app.getAppPath(), 'build', 'icon.png') : undefined;

  // 开发时用仓库里的 .dev/baocut-home，不碰 ~/.baocut。BAOCUT_HOME 可以覆盖。
  const home = resolveRuntimeHome({
    ...process.env,
    BAOCUT_HOME: process.env.BAOCUT_HOME || (isDev ? path.resolve(app.getAppPath(), '../../.dev/baocut-home') : ''),
  });

  const supervisor = new RuntimeSupervisor({
    home,
    script: path.join(__dirname, 'runtime.js'),
    allowedOrigins: devServerUrl ? [new URL(devServerUrl).origin] : [],
    echoLogs: isDev,
    // 正式版本的密钥与节点令牌存在系统的安全存储里（没有实现的平台如实报告不可用，不回退到文件）；开发时用明文文件，
    // 不碰钥匙串（架构设计 §6.8）。
    credentialStore: app.isPackaged ? 'keychain' : 'file',
    // Worker、凭据助手、内置模板与 skill、模型数据、Web 客户端：打包脚本（tools/package-desktop.mjs）把它们放进 resources；
    // 开发时 Runtime 从仓库里找。
    resources: app.isPackaged ? packagedResources(process.resourcesPath) : null,
    // 从链接导入的默认下载目录：系统的下载文件夹（Windows 的已知文件夹、Linux 的 XDG 目录），取不到时 Runtime 用 ~/Downloads。
    downloadsDir: systemDownloadsDir(),
    systemLanguages: () => app.getPreferredSystemLanguages(),
  });

  /** 应用更新的服务；就绪之前退出时还没有。 */
  let updates: AppUpdateService | null = null;

  function createWindow(): BrowserWindow {
    const win = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 960,
      minHeight: 600,
      show: false,
      title: 'BaoCut',
      icon: devIcon,
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      trafficLightPosition: { x: 18, y: 14 },
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1d1d1d' : '#f8f8f8',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    win.once('ready-to-show', () => win.show());

    // 开发时把渲染进程的警告和错误也打到终端。
    if (isDev) {
      win.webContents.on('console-message', ({ level, message, sourceId, lineNumber }) => {
        if (level === 'warning' || level === 'error') console.error(`[renderer:${level}] ${message} (${sourceId}:${lineNumber})`);
      });
      // i18n-ignore: 开发时打到终端的诊断日志
      win.webContents.on('render-process-gone', (_event, details) => console.error('[renderer] 进程退出', details));
    }

    // 窗口里只跑自己的页面；外部链接交给系统浏览器。
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, url) => {
      if (devServerUrl && url.startsWith(devServerUrl)) return;
      event.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    });

    if (devServerUrl) void win.loadURL(devServerUrl);
    else void win.loadFile(path.join(__dirname, '../renderer/index.html'));
    return win;
  }

  ipcMain.handle('baocut:connection', () => supervisor.connection());

  // 选目录：默认是打开项目目录；界面给了标题（例如选保存位置）时用它，按钮写「选择」。标题来自渲染进程，只收短字符串。
  ipcMain.handle('baocut:pick-directory', async (event, request?: { title?: unknown }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const title = typeof request?.title === 'string' && request.title.trim() ? request.title.trim().slice(0, 200) : null;
    const options: Electron.OpenDialogOptions = {
      title: title ?? M.openProjectTitle,
      buttonLabel: title ? M.choose : M.open,
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle('baocut:pick-media', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: M.importAssetsTitle,
      buttonLabel: M.importButton,
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: M.mediaFilter,
          extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'png', 'jpg', 'jpeg', 'gif', 'webp'],
        },
        { name: M.allFilesFilter, extensions: ['*'] },
      ],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('baocut:pick-files', async (event, raw: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = (raw ?? {}) as { title?: unknown; buttonLabel?: unknown; filters?: unknown; multiple?: unknown };
    const options: Electron.OpenDialogOptions = {
      title: dialogText(opts.title) ?? M.openFileTitle,
      buttonLabel: dialogText(opts.buttonLabel) ?? M.open,
      properties: opts.multiple === true ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: dialogFilters(opts.filters),
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('baocut:pick-message-files', async (event, raw: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return [];
    const opts = (raw ?? {}) as { title?: unknown; filesLabel?: unknown; foldersLabel?: unknown; cancelLabel?: unknown; images?: unknown };
    const title = dialogText(opts.title) ?? M.openFileTitle;
    let folders = false;
    if (process.platform !== 'darwin') {
      const { response } = await dialog.showMessageBox(win, {
        title,
        message: title,
        buttons: [
          dialogText(opts.filesLabel) ?? M.openFileTitle,
          dialogText(opts.foldersLabel) ?? M.openProjectTitle,
          dialogText(opts.cancelLabel) ?? M.close,
        ],
        defaultId: 0,
        cancelId: 2,
      });
      if (response === 2) return [];
      folders = response === 1;
    }
    const result = await dialog.showOpenDialog(win, {
      title,
      buttonLabel: M.choose,
      properties: messageFileProperties(process.platform, folders),
    });
    return result.canceled ? [] : messageFiles(result.filePaths, opts.images === true);
  });

  ipcMain.handle('baocut:pick-save-path', async (event, raw: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = (raw ?? {}) as { title?: unknown; buttonLabel?: unknown; defaultName?: unknown; filters?: unknown };
    // 只取文件名，目录交给系统对话框（默认是上次的位置）。
    const name = typeof opts.defaultName === 'string' ? path.basename(opts.defaultName).slice(0, 200) : '';
    const options: Electron.SaveDialogOptions = {
      title: dialogText(opts.title) ?? M.save,
      buttonLabel: dialogText(opts.buttonLabel) ?? M.save,
      filters: dialogFilters(opts.filters),
      properties: ['createDirectory', 'showOverwriteConfirmation'],
      ...(name ? { defaultPath: name } : {}),
    };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    return result.canceled || !result.filePath ? null : result.filePath;
  });

  ipcMain.handle('baocut:reveal', (_event, target: unknown) => {
    // 界面拼出来的路径可能混着 `/` 与 `\`（目录接相对路径），Windows 上先规范成本机的分隔符。
    if (typeof target === 'string' && path.isAbsolute(target)) shell.showItemInFolder(path.normalize(target));
  });

  ipcMain.handle('baocut:open-file', (event, target: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame) return null;
    return openLocalFile(target, (file) => shell.openPath(file));
  });

  // 界面语言：界面换语言（启动时也一次）时告诉主进程，只认出货语言；只收应用窗口发来的（网页标签没有预加载脚本，发不了）。
  ipcMain.on('baocut:set-locale', (event, value: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return;
    const locale = localeFromRenderer(value);
    if (locale) setLocale(locale);
  });

  /** 按当前语言设应用菜单；已经显示的菜单换掉。对话框在打开时取文案，不用重建。 */
  function installAppMenu(): void {
    Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate(process.platform, app.name)));
  }

  onLocaleChange(() => {
    if (app.isReady()) installAppMenu();
  });

  // 网页标签：独立分区的原生网页视图（架构设计 §12.10）。
  installWebTabs({ appOrigins: devServerUrl ? [new URL(devServerUrl).origin] : [] });

  app.whenReady().then(() => {
    // 界面还没告诉主进程语言之前，菜单与对话框按系统的首选语言（BAOCUT_LOCALE 设了时以它为准）。
    setLocale(startupLocale(app.getPreferredSystemLanguages()));
    installAppMenu();
    // 先把 Runtime 拉起来，窗口加载期间并行进行。
    // i18n-ignore: 诊断日志，只打到主进程的终端
    void supervisor.connection().catch((error) => console.error('[baocut] Runtime 启动失败', error));
    // 应用自动更新（架构设计 §2.6）：检查、下载、校验都在 Main 里，Runtime 不参与。
    updates = installAppUpdates();
    // macOS 的 Dock 图标不认 BrowserWindow 的 icon，开发态单独设。
    if (devIcon && process.platform === 'darwin') app.dock?.setIcon(devIcon);
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    void supervisor.stop().finally(async () => {
      // 退出即安装（架构设计 §2.6）：Runtime 停下之后把已下载、已就位的更新交给换包程序，换完不重新打开。有时限、不抛；
      // 「重启并更新」引起的退出已在安装中，这里什么都不做。之后停掉还在跑的下载与校验。
      await updates?.installOnQuit();
      updates?.dispose();
      app.quit();
    });
  });
}

function systemDownloadsDir(): string | null {
  try {
    return app.getPath('downloads');
  } catch {
    return null;
  }
}

/** 渲染进程给的对话框参数：只收认得的字段，类型不对的丢掉。 */
function dialogFilters(value: unknown): Electron.FileFilter[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const filters = value.flatMap((f: unknown) => {
    const { name, extensions } = (f ?? {}) as { name?: unknown; extensions?: unknown };
    if (typeof name !== 'string' || !Array.isArray(extensions)) return [];
    const exts = extensions.filter((e): e is string => typeof e === 'string' && /^(\*|[A-Za-z0-9]{1,16})$/.test(e));
    return exts.length ? [{ name: name.slice(0, 100), extensions: exts }] : [];
  });
  return filters.length ? filters : undefined;
}

function dialogText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.slice(0, 100) : undefined;
}
