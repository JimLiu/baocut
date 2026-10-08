import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import type { RuntimeDiscovery } from '@baocut/protocol';
import { isProcessAlive, readDiscovery, type RuntimeHome } from '@baocut/runtime-storage';
import { M } from './main-copy.ts';
import { packagedResourceEnv, type PackagedResources } from './packaged-resources.ts';
import { stopChild } from './stop-child.ts';

export interface ConnectionTarget {
  endpoint: string;
  token: string;
}

export interface RuntimeSupervisorOptions {
  home: RuntimeHome;
  /** 默认桌面 Home（含开发态）启动历史迁移；显式沙盒默认关闭。 */
  legacyAutoDetect?: boolean;
  /** 构建出来的 Runtime 入口（out/main/runtime.js）。 */
  script: string;
  allowedOrigins: string[];
  /** 把 Runtime 的日志也打到主进程的 stderr（开发时用）。 */
  echoLogs: boolean;
  /**
   * 凭据后端（架构设计 §6.8）：正式版本用系统的安全存储（经 `<resources>/bin` 里的 `credential-helper`），开发时用明文文件。
   * 由构建类型决定，不是用户设置。
   */
  credentialStore: 'file' | 'keychain';
  /**
   * 打包后的应用随带的东西（`packaged-resources.ts`）：原生程序（Worker、凭据助手）、内置模板（模板包规范 §6）、内置 Agent skill
   * （架构设计 §3.8）、按路径读的模型数据（Model Worker 要读，所以在 asar 外面）与 Web 客户端，都在 `<resources>` 下，由主进程经
   * 环境变量告诉 Runtime。开发时为 null，Runtime 自己从仓库里找。
   */
  resources: PackagedResources | null;
  /**
   * 系统的下载文件夹（Electron 的 `app.getPath('downloads')`）：从链接导入没有设置下载目录时用它。它认得 Windows 移动过的
   * 已知文件夹与 Linux 的 XDG 目录（例如 `~/下载`），Runtime 自己只能猜 `~/Downloads`。取不到时为 null。
   */
  downloadsDir: string | null;
  /** 操作系统的首选语言（BCP 47，按优先顺序）：界面语言跟随系统时 Runtime 按它选语言。拉起时才取。 */
  systemLanguages: () => readonly string[];
}

const READY_TIMEOUT_MS = 20_000;

/**
 * 找到或启动 Runtime（架构设计 §2.2）。
 *
 * 先读发现文件；进程活着就直接用。否则用 Electron 自带的 Node 起一个，等它报告就绪后再读发现文件。
 * 令牌只经发现文件与 IPC 传给渲染进程，不进 URL、不进命令行参数。
 */
export class RuntimeSupervisor {
  readonly #options: RuntimeSupervisorOptions;
  #child: ChildProcess | null = null;
  #ensuring: Promise<ConnectionTarget> | null = null;

  constructor(options: RuntimeSupervisorOptions) {
    this.#options = options;
  }

  /** 渲染进程每次（重新）连接前调用；Runtime 不在了就再起一个。 */
  connection(): Promise<ConnectionTarget> {
    this.#ensuring ??= this.#ensure().finally(() => {
      this.#ensuring = null;
    });
    return this.#ensuring;
  }

  async #ensure(): Promise<ConnectionTarget> {
    const existing = await this.#discover();
    if (existing) return existing;
    await this.#spawn();
    const started = await this.#discover();
    if (!started) throw new Error(M.runtimeNoDiscovery);
    return started;
  }

  async #discover(): Promise<ConnectionTarget | null> {
    const discovery: RuntimeDiscovery | null = await readDiscovery(this.#options.home).catch(() => null);
    if (!discovery || !isProcessAlive(discovery.pid)) return null;
    return { endpoint: discovery.endpoint, token: discovery.token };
  }

  #spawn(): Promise<void> {
    const { home, script, allowedOrigins, echoLogs, credentialStore, resources, downloadsDir, systemLanguages } = this.#options;
    const args = [script, ...(echoLogs ? [] : ['--quiet']), '--credential-store', credentialStore];
    const child = spawn(process.execPath, args, {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        BAOCUT_HOME: home.root,
        ...(this.#options.legacyAutoDetect ? { BAOCUT_LEGACY_AUTO_DETECT: '1' } : {}),
        BAOCUT_ALLOWED_ORIGINS: allowedOrigins.join(','),
        // 以 Node 方式运行的 Runtime 不一定能拿到 resourcesPath：Worker、凭据助手、内置模板等的位置由主进程告诉它。
        ...(resources ? packagedResourceEnv(resources) : {}),
        // 系统的下载文件夹；环境里已经给了（测试指到临时目录）时不覆盖。
        ...(downloadsDir && !process.env.BAOCUT_DOWNLOADS_DIR ? { BAOCUT_DOWNLOADS_DIR: downloadsDir } : {}),
        // 从桌面启动的进程多半没有 LANG：系统语言由主进程告诉它。
        BAOCUT_SYSTEM_LANGUAGES: systemLanguages().join(','),
      },
      // IPC 通道只用来请 Runtime 停下（见 stop）。主进程退出或崩溃时通道断开，Runtime 不跟着停，下次启动经发现文件找回它。
      stdio: ['ignore', 'pipe', echoLogs ? 'inherit' : 'ignore', 'ipc'],
    });
    this.#child = child;
    child.once('exit', () => {
      if (this.#child === child) this.#child = null;
    });

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(M.runtimeTimeout)), READY_TIMEOUT_MS);
      const lines = readline.createInterface({ input: child.stdout! });
      const finish = (error?: Error) => {
        clearTimeout(timer);
        lines.removeAllListeners('line');
        child.removeListener('exit', onExit);
        if (error) reject(error);
        else resolve();
      };
      const onExit = (code: number | null) => {
        // 退出码 3：同一个 Home 已经有 Runtime 在跑（另一个窗口或 CLI 起的），读它的发现文件即可。
        finish(code === 3 ? undefined : new Error(M.runtimeExited(code)));
      };
      child.once('exit', onExit);
      lines.on('line', (line) => {
        try {
          const message = JSON.parse(line) as { type?: string };
          if (message.type === 'ready' || message.type === 'already-running') finish();
        } catch {
          // 不是就绪消息，忽略。
        }
      });
    });
  }

  /**
   * 只停自己起的 Runtime；连上的别人的 Runtime 不动。经 IPC 通道请它按停止顺序收尾（各平台一样，Windows 上没有能被处理的
   * SIGTERM），超过 `timeoutMs` 强杀。Runtime 自己另有 15 秒的兜底退出。
   */
  async stop(timeoutMs = 8_000): Promise<void> {
    const child = this.#child;
    if (!child) return;
    await stopChild(child, timeoutMs);
  }
}
