import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import type { MessageRef, RuntimeDiscovery } from '@baocut/protocol';
import { isDiscoveryLive, readDiscovery, type RuntimeHome } from '@baocut/runtime-storage';
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
  /**
   * 系统的文稿 / 文档文件夹（`app.getPath('documents')`）：旧版项目导入询问的默认目录在它下面（架构设计 §2.7）。取不到时为
   * null，Runtime 用 `~/Documents`。
   */
  documentsDir: string | null;
  /** 操作系统的首选语言（BCP 47，按优先顺序）：界面语言跟随系统时 Runtime 按它选语言。拉起时才取。 */
  systemLanguages: () => readonly string[];
}

const READY_TIMEOUT_MS = 20_000;
/** 退出前问 Runtime 的期限：问不到（卡住、通道断了）就照常停，不让退出挂住。 */
const ASK_TIMEOUT_MS = 2_000;

/**
 * 已经交给在线或智能体 Provider 的一次调用（同 Runtime 的 `RemoteCall`）：停下 Runtime 也可能还在那边执行或计费。`kind` 是
 * 发起调用的任务种类（没有任务记录时 null），`step` 是固定流程的步骤名。
 */
export interface RemoteCall {
  kind: string | null;
  provider: string;
  step?: { label: string; labelRef?: MessageRef };
}

/**
 * 自己起的 Runtime 手上的活（架构设计 §2.2）：排队或运行中的 Job，还没结束的 Agent 任务，以及已经交给 Provider、停下也
 * 可能还在那边执行或计费的调用。
 */
export interface ActiveWork {
  jobs: number;
  tasks: number;
  remote: RemoteCall[];
}

function isRemoteCall(value: unknown): value is RemoteCall {
  const call = value as Partial<RemoteCall> | null;
  return (
    typeof call?.provider === 'string' &&
    (call.kind === null || typeof call.kind === 'string') &&
    (call.step === undefined || typeof call.step?.label === 'string')
  );
}

/**
 * 找到或启动 Runtime（架构设计 §2.2）。
 *
 * 先读发现文件；它指向的 Runtime 还在服务就直接用。PID 还在不算数：重启后旧 PID 常被别的进程复用，只认 PID 会把一个
 * 早已不在的端点一直交给界面，界面就停在「正在重连」（`isDiscoveryLive`）。否则用 Electron 自带的 Node 起一个，等它报告
 * 就绪后再读发现文件。
 * 令牌只经发现文件与 IPC 传给渲染进程，不进 URL、不进命令行参数。
 */
export class RuntimeSupervisor {
  readonly #options: RuntimeSupervisorOptions;
  #child: ChildProcess | null = null;
  #ensuring: Promise<ConnectionTarget> | null = null;
  /** 应用开始退出（调过 `stop`）之后不再拉起 Runtime。 */
  #stopped = false;
  /** Bot 后台服务常驻（技术方案 §15.2）：新拉起的 Runtime 也要知道。 */
  #resident = false;

  constructor(options: RuntimeSupervisorOptions) {
    this.#options = options;
  }

  /**
   * 渲染进程每次（重新）连接前调用；Runtime 不在了就再起一个。应用退出途中不起：自己的 Runtime 停下后窗口还开着，界面会按
   * 重连退避再来要连接，这时起的 Runtime 没人再停，主进程退出后成了孤儿。
   */
  connection(): Promise<ConnectionTarget> {
    if (this.#stopped) return Promise.reject(new Error(M.runtimeQuitting));
    this.#ensuring ??= this.#ensure().finally(() => {
      this.#ensuring = null;
    });
    return this.#ensuring;
  }

  async #ensure(): Promise<ConnectionTarget> {
    const existing = await this.#discover();
    if (existing) return existing;
    // 读发现文件期间可能开始了退出。
    if (this.#stopped) throw new Error(M.runtimeQuitting);
    await this.#spawn();
    const started = await this.#discover();
    if (!started) throw new Error(M.runtimeNoDiscovery);
    if (this.#resident) this.#sendResident();
    return started;
  }

  async #discover(): Promise<ConnectionTarget | null> {
    const discovery: RuntimeDiscovery | null = await readDiscovery(this.#options.home).catch(() => null);
    if (!discovery || !(await isDiscoveryLive(discovery))) return null;
    return { endpoint: discovery.endpoint, token: discovery.token };
  }

  #spawn(): Promise<void> {
    const { home, script, allowedOrigins, echoLogs, credentialStore, resources, downloadsDir, documentsDir, systemLanguages } =
      this.#options;
    const args = [script, ...(echoLogs ? [] : ['--quiet']), '--credential-store', credentialStore];
    const child = spawn(process.execPath, args, {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        BAOCUT_HOME: home.root,
        BAOCUT_PROJECTS_DIR: home.projectsDir,
        ...(this.#options.legacyAutoDetect ? { BAOCUT_LEGACY_AUTO_DETECT: '1' } : {}),
        BAOCUT_ALLOWED_ORIGINS: allowedOrigins.join(','),
        // 以 Node 方式运行的 Runtime 不一定能拿到 resourcesPath：Worker、凭据助手、内置模板等的位置由主进程告诉它。
        ...(resources ? packagedResourceEnv(resources) : {}),
        // 系统的下载文件夹；环境里已经给了（测试指到临时目录）时不覆盖。
        ...(downloadsDir && !process.env.BAOCUT_DOWNLOADS_DIR ? { BAOCUT_DOWNLOADS_DIR: downloadsDir } : {}),
        // 系统的文稿文件夹：同上。
        ...(documentsDir && !process.env.BAOCUT_DOCUMENTS_DIR ? { BAOCUT_DOCUMENTS_DIR: documentsDir } : {}),
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
   * 退出前问自己起的 Runtime 手上的活（经 IPC 通道发 `{ type: 'status' }`）。连上的是别人的 Runtime（退出不停它）、它已经
   * 退出或问不到时 null。
   */
  async activeWork(timeoutMs = ASK_TIMEOUT_MS): Promise<ActiveWork | null> {
    const reply = await this.#ask({ type: 'status' }, 'status', timeoutMs);
    if (typeof reply?.jobs !== 'number' || typeof reply.tasks !== 'number') return null;
    // 旧版 Runtime 不报远端调用：按没有。
    const remote = Array.isArray(reply.remote) ? reply.remote.filter(isRemoteCall) : [];
    return { jobs: reply.jobs, tasks: reply.tasks, remote };
  }

  /**
   * 退出时用户选了在后台继续：请自己起的 Runtime 开启空闲退出（`{ type: 'detach' }`，活做完自己停），然后放手：`stop` 不再
   * 停它，也不再拉起 Runtime。等它确认；问不到也照样放手，它照旧留着，下一次启动经发现文件找回它。
   */
  async detach(timeoutMs = ASK_TIMEOUT_MS): Promise<void> {
    this.#stopped = true;
    await this.#ask({ type: 'detach' }, 'detached', timeoutMs);
    this.#child = null;
  }

  /**
   * Bot 后台服务常驻与否（技术方案 §15.2）：经 IPC 通道发 `{ type: 'resident', on }`，常驻时 Runtime 不进入空闲退出。只告诉
   * 自己起的 Runtime（别人起的没有通道）；之后拉起的 Runtime 就绪时补发。发不出去时不报错。
   */
  setResident(on: boolean): void {
    this.#resident = on;
    this.#sendResident();
  }

  get resident(): boolean {
    return this.#resident;
  }

  #sendResident(): void {
    const child = this.#child;
    if (!child?.connected) return;
    try {
      child.send({ type: 'resident', on: this.#resident }, () => {});
    } catch {
      // 通道刚断开：下一次拉起时补发。
    }
  }

  /** 经 IPC 通道发一条消息，等类型为 `replyType` 的回复。没有通道、发不出去、子进程退出或超时都得到 null。 */
  #ask(message: { type: string }, replyType: string, timeoutMs: number): Promise<Record<string, unknown> | null> {
    const child = this.#child;
    if (!child?.connected) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(null), timeoutMs);
      const finish = (reply: Record<string, unknown> | null) => {
        clearTimeout(timer);
        child.removeListener('message', onMessage);
        child.removeListener('exit', onExit);
        resolve(reply);
      };
      const onMessage = (reply: unknown) => {
        if ((reply as { type?: unknown } | null)?.type === replyType) finish(reply as Record<string, unknown>);
      };
      const onExit = () => finish(null);
      child.on('message', onMessage);
      child.once('exit', onExit);
      child.send(message, (error) => {
        if (error) finish(null);
      });
    });
  }

  /**
   * 应用退出时调。只停自己起的 Runtime；连上的别人的 Runtime 不动。经 IPC 通道请它按停止顺序收尾（各平台一样，Windows 上
   * 没有能被处理的 SIGTERM），超过 `timeoutMs` 强杀。Runtime 自己另有 15 秒的兜底退出。此后 `connection` 不再拉起 Runtime。
   */
  async stop(timeoutMs = 8_000): Promise<void> {
    this.#stopped = true;
    const child = this.#child;
    if (!child) return;
    await stopChild(child, timeoutMs);
  }
}
