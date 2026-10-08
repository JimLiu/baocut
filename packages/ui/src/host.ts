import type { Locale } from '@baocut/protocol';

/** 宿主（Electron 预加载脚本）提供的原生能力。界面包不直接依赖 Electron。 */
export interface HostBridge {
  platform: string;
  /** Web 服务未开放附件上传时为 false；桌面网关默认支持。 */
  supportsImageAttachments?: boolean;
  /** Same-origin, authenticated upload support for ordinary documents/media. */
  supportsFileAttachments?: boolean;
  getConnection(): Promise<{ endpoint: string; token: string }>;
  /**
   * 选一个本机目录；取消时 null。`title` 是对话框标题（例如选保存位置时），不给时是「打开项目目录」。
   * 浏览器里不能选，提示之后返回 null。
   */
  pickDirectory(options?: { title?: string }): Promise<string | null>;
  /** 选要导入的素材文件（视频、音频、图片）。取消时返回空数组。 */
  pickMediaFiles(): Promise<string[]>;
  /** 拖进窗口的文件在磁盘上的路径；不是本地文件时返回空字符串。 */
  pathForFile(file: File): string;
  revealPath(target: string): Promise<void>;
  /** 系统默认应用打开本地文档或媒体；null 不支持，空串成功，其余为系统错误。Web 没有此能力。 */
  openFile?(target: string): Promise<string | null>;
  /** 内嵌网页（桌面端才有）。浏览器预览里没有：网页标签显示「这个环境不能内嵌网页」。 */
  web?: WebHost;
  /** 用系统浏览器打开 http/https 网址（桌面端才有）。 */
  openExternal?(url: string): Promise<void>;
  /** 按类型选要打开的文件（系统的打开对话框）。取消时返回空数组。没有它的宿主里，界面把要用它的入口置灰。 */
  pickFiles?(options: PickFilesOptions): Promise<string[]>;
  /** 会话附件的统一选择器：本机文件和目录；支持的图片可附带原始字节。Web 没有本机路径能力。 */
  pickMessageFiles?(options: PickMessageFilesOptions): Promise<MessageFile[]>;
  /** 选一个保存位置（系统的存储对话框）。取消时返回 null。没有它的宿主里，界面把导出入口置灰。 */
  pickSavePath?(options: PickSavePathOptions): Promise<string | null>;
  /** 应用自动更新（架构设计 §2.6，桌面端才有）。没有它的宿主里，更新相关的界面一概不出现。 */
  updates?: UpdatesHost;
  /** 界面语言变了（启动时也调一次）：宿主据此换原生菜单与对话框的语言。没有它的宿主不管。 */
  setLocale?(locale: Locale): void;
}

/** 打开 / 存储对话框里的一组文件类型：扩展名不带点，`*` 表示所有文件。 */
export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface PickFilesOptions {
  title?: string;
  buttonLabel?: string;
  filters?: FileFilter[];
  /** 允许多选；默认单选。 */
  multiple?: boolean;
}

export interface MessageFile {
  path: string;
  kind: 'file' | 'directory';
  /** 仅用户刚选中的、符合附图大小与格式上限的图片。 */
  image?: { mimeType: string; bytes: Uint8Array };
}

export interface PickMessageFilesOptions {
  title: string;
  filesLabel: string;
  foldersLabel: string;
  cancelLabel: string;
  /** Agent 能收图片时才读取图片字节；否则只传本机引用。 */
  images: boolean;
}

export interface PickSavePathOptions {
  title?: string;
  buttonLabel?: string;
  /** 建议的文件名（只取文件名部分，目录由系统对话框决定）。 */
  defaultName?: string;
  filters?: FileFilter[];
}

/**
 * 网页标签（架构设计 §12.10）：宿主给每个标签一个独立的原生网页视图（`persist:web` 分区、沙箱、没有预加载脚本）。
 * 视图盖在界面之上，位置由界面经 `setBounds` 报给宿主（窗口内的 CSS 像素）。
 */
export interface WebHost {
  /** 新建一个网页视图，先隐藏；返回标签 id。 */
  create(): Promise<string>;
  /** 打开一个网址。被规则拒绝时不打开，同时推一条带 `blocked` 的状态。 */
  navigate(id: string, url: string): Promise<WebNavigateResult>;
  back(id: string): void;
  forward(id: string): void;
  reload(id: string, ignoreCache?: boolean): void;
  find(id: string, query: string, options?: { forward?: boolean; next?: boolean }): void;
  stopFind(id: string): void;
  setViewport(id: string, size: { width: number; height: number } | null): void;
  onShortcut(listener: (event: { id: string; action: 'focus-address' | 'find' | 'reload' | 'force-reload' }) => void): () => void;
  stop(id: string): void;
  /** 缩放百分比，宿主收进 50–200。 */
  setZoom(id: string, percent: number): void;
  setBounds(id: string, bounds: { x: number; y: number; width: number; height: number }): void;
  setVisible(id: string, visible: boolean): void;
  destroy(id: string): void;
  /** 所有标签的状态变化；返回取消订阅。 */
  onState(listener: (state: WebTabState) => void): () => void;
  /** 清掉网页分区里的 Cookie、存储与缓存（给设置页的按钮用）。 */
  clearData(): Promise<void>;
}

/** 被宿主拒绝的原因：不是网址、不是 http/https、本机回环地址、应用自己的页面。 */
export type WebBlockReason = 'invalid' | 'scheme' | 'loopback' | 'app-origin';

export type WebNavigateResult = { ok: true; url: string } | { ok: false; reason: WebBlockReason };

export type WebTabError =
  | { kind: 'blocked'; reason: WebBlockReason; url: string }
  | { kind: 'failed'; code: number; description: string; url: string }
  | { kind: 'crashed' };

export interface WebTabState {
  id: string;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  error: WebTabError | null;
  find?: { query: string; active: number; matches: number };
  notice?: { serial: number; kind: 'popup' | 'download' | 'permission' } | null;
}

/**
 * 应用自动更新（架构设计 §2.6、设计稿 §17.7）：检查更新源、后台下载、校验大小与摘要、换包都在宿主的主进程里，
 * Runtime 不参与。状态机也在主进程（`apps/desktop/src/main/app-update-rules.ts`）；界面只镜像它推来的状态、
 * 发起动作，并在安装前过停止屏障（有活动任务时先问用户）。下载完成从不自动重启；已下载时正常退出应用，主进程在退出途中
 * 装好、不重新打开。
 */
export interface UpdatesHost {
  /** 现在的状态。 */
  get(): Promise<AppUpdateSnapshot>;
  /** 状态变了就推一份完整的；返回取消订阅。 */
  onState(listener: (snapshot: AppUpdateSnapshot) => void): () => void;
  /** 自动检查之后要提醒的事（toast）；返回取消订阅。 */
  onNotice(listener: (notice: AppUpdateNotice) => void): () => void;
  /** 更新偏好（Runtime 持有的 `updates.autoCheck` / `updates.autoDownload`，§5.10）。收到之前主进程不做自动检查。 */
  configure(prefs: AppUpdatePrefs): void;
  /** 手动检查（关于页的「检查更新」与出错后的「重试」）。 */
  check(): Promise<void>;
  /** 下载并校验（「下载并安装」与下载出错后的「重试」）：下载到 100% 后先校验、就位，再进「已下载」。 */
  download(): Promise<void>;
  /** 取消在下的下载（含 100% 之后的校验段），回到「有新版本」。 */
  cancel(): Promise<void>;
  /** 「重启并更新」：起换包程序，然后应用正常退出，换完重新打开。停止屏障由界面在调用前过完。 */
  install(): Promise<void>;
  /** 用系统浏览器打开下载页。 */
  openDownloadPage(): Promise<void>;
}

export interface AppUpdatePrefs {
  autoCheck: boolean;
  autoDownload: boolean;
}

/** 安装包的形态：macOS 的公证 ZIP（主路径）与 DMG（兼容），Windows 的安装器。 */
export type AppUpdateFormat = 'zip' | 'dmg' | 'exe';

/** schema-1 更新清单里这一版的信息（主进程校验过）。说明的语言由界面挑。 */
export interface AppUpdateInfo {
  version: string;
  build: number;
  date: string;
  /** 新版本要求的最低系统版本（只在 macOS 上比较）。 */
  minimumSystemVersion: string | null;
  notes: string;
  /** 各语言的说明，键是语言码（`zh-Hans`、`en`…）。 */
  notesLocalized: Record<string, string>;
  format: AppUpdateFormat;
  url: string;
  size: number;
  /** 64 位十六进制，小写。 */
  sha256: string;
}

/**
 * 出错的类别，界面按它出文案：检查失败、下载没完成、校验不过（文件已删）、签名与当前应用不一致、
 * 安装没完成、这台机器不能自己换包（已显示安装包并打开下载页）。
 */
export type AppUpdateFailure = 'check' | 'download' | 'verify' | 'signature' | 'install' | 'manual';

/**
 * 更新的状态（设计稿 model-app-update.js 的状态机）。`available.bg` / `ready.bg` 是在途的静默检查（自动检查发起时
 * 已有新版本或已下载，显示态不变）；`systemUnmet` 是新版本要求、本机达不到的 macOS 版本。`downloading` 的 `pct` 到 100
 * 之后是校验段（核对、解开、验签），完了才进 `ready`。
 */
export type AppUpdateState =
  | { k: 'unsupported'; why: 'dev' | 'appStore' }
  | { k: 'idle' }
  | { k: 'checking' }
  | { k: 'upToDate' }
  | { k: 'available'; info: AppUpdateInfo; systemUnmet?: string; bg?: boolean }
  | { k: 'downloading'; info: AppUpdateInfo; pct: number }
  | { k: 'ready'; info: AppUpdateInfo; path: string; bg?: boolean }
  | { k: 'installing'; info: AppUpdateInfo }
  | { k: 'error'; failure: AppUpdateFailure; info: AppUpdateInfo | null };

export interface AppUpdateSnapshot {
  state: AppUpdateState;
  /** 上次检查的时刻（unix 秒）；这次启动还没检查过时 null。 */
  lastCheckAt: number | null;
  /** 正在运行的版本。 */
  current: { version: string; build: number };
}

/** 自动检查之后的提醒：自动下载关着时「可以更新了」，后台下载好了「已下载」（每个 build 一次）。 */
export type AppUpdateNotice = { kind: 'available'; info: AppUpdateInfo } | { kind: 'ready'; info: AppUpdateInfo };
