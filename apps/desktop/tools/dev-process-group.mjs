// 开发态（`npm run dev`）的进程监管：`electron-vite dev` 连同它拉起的 Electron、Electron 再拉起的 Runtime 放在一起，收到停止
// 信号时一起请停，超时还在的强杀，都退出了才退出。
//
// 为什么要它：electron-vite 收到 SIGTERM 只关掉 Vite 就退出，不转给 Electron。只按 pid 发信号的上层（编辑器的任务、终端面板的
// 「停止」、进程管理器）因此会留下 Electron 与 Runtime，接着往已经关掉的终端里写。Electron 退出时卡住（比如主进程弹出模态的
// 错误框）也会一直占着终端。
//
// 取舍：POSIX 上子进程用 `detached`（setsid）自成一个进程组，`kill(-pgid)` 一次就够到孙进程（Electron）与曾孙（Runtime），
// electron-vite 重新构建主进程时换上的新 Electron 也在组里。代价是终端关掉时内核的 SIGHUP 不再直接送到组里，全靠这里转发；
// 这个进程自己被 SIGKILL 时组会留下（用 `kill -- -<pgid>` 收拾）。Runtime 起的导出 Worker、ACP 智能体与 OpenCode 服务各自
// 成组，不在这里，由 Runtime 的停止顺序收尾（ACP 智能体在 Runtime 退出时还会被整组强杀）。Windows 没有进程组：Ctrl+C 与关掉
// 控制台本来就送到控制台上的每个进程，这里只在超时后用 `taskkill /T /F` 强杀子进程树。

import { spawn, spawnSync } from 'node:child_process';

/** 收到这些信号就请整组停下：关掉终端（SIGHUP）、Ctrl+C（SIGINT）、上层按 pid 停止（SIGTERM）。 */
export const SHUTDOWN_SIGNALS = ['SIGHUP', 'SIGINT', 'SIGTERM'];

/**
 * 请整组停下用的信号，不论收到的是哪个：与在终端里按 Ctrl+C 时整组收到的一样，组里每个进程都把它当正常退出（Electron 走
 * `before-quit`，Runtime 按停止顺序收尾，electron-vite 直接结束）。SIGTERM 会直接结束 Electron 的 GPU、网络与渲染子进程，
 * 主进程还没开始退出它们就没了。
 */
export const STOP_SIGNAL = 'SIGINT';

/**
 * 请停之后等多久强杀。比桌面端自己正常退出的上限长，不在一次正常进行的退出中途下手：`before-quit` 里经 IPC 请 Runtime 停下、
 * 最多等 8 秒，超时强杀后再等 2 秒（`src/main/runtime-supervisor.ts`、`src/main/stop-child.ts`）。正常退出不到一秒。
 */
export const FORCE_KILL_MS = 12_000;

/** 强杀之后最多再等它们退出多久（SIGKILL 不能被忽略，正常几毫秒就结束；这只是不让异常情况挂住）。 */
const KILL_WAIT_MS = 2_000;
const POLL_MS = 50;

/**
 * 输出照旧直接进终端（Vite 按 TTY 着色、清屏）。stdin 也照旧：Vite 在 stdin 结束时会关掉服务退出，不能换成空的。
 * POSIX 上自成一组；Windows 上 `detached` 会给它另开一个控制台窗口，Ctrl+C 也到不了它。
 */
export function devSpawnOptions(platform) {
  return { stdio: 'inherit', detached: platform !== 'win32' };
}

/** 在监管下运行 `command`，退出时带它的退出码；因停止信号而停时是 0。 */
export function superviseDevProcess(command, args, { cwd, platform = process.platform, forceKillMs = FORCE_KILL_MS } = {}) {
  // 终端关掉后写 stdio 会失败（EIO、EPIPE）。不处理的话成为未捕获的异常，这个进程在收尾之前就结束了。
  for (const stream of [process.stdout, process.stderr]) stream.on('error', () => {});

  const groups = platform !== 'win32';
  const child = spawn(command, args, { cwd, env: process.env, ...devSpawnOptions(platform) });
  const childRunning = () => child.exitCode === null && child.signalCode === null;

  const running = () => {
    if (!groups) return childRunning();
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const signalGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // ESRCH：组里已经没有进程
    }
  };

  let stopping = false;
  let exitCode = 0;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    // Windows 上不另发：Ctrl+C、关掉控制台已经送到了每个进程，而 `kill` 在那里等于直接结束。
    if (groups) signalGroup(STOP_SIGNAL);
    const force = setTimeout(() => {
      process.stderr.write(`[dev] Still running ${forceKillMs / 1000} s after the stop request; force-killing\n`);
      if (groups) signalGroup('SIGKILL');
      else if (childRunning()) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      setTimeout(() => process.exit(exitCode), KILL_WAIT_MS);
    }, forceKillMs);
    const poll = setInterval(() => {
      if (running()) return;
      clearInterval(poll);
      clearTimeout(force);
      process.exit(exitCode);
    }, POLL_MS);
  };

  child.on('error', (error) => {
    process.stderr.write(`[dev] Could not start ${command}: ${error.message}\n`);
    process.exit(1);
  });
  // 自己退出了（关掉了应用、构建出错）：带它的退出码退出，组里剩下的照样请停。
  child.on('exit', (code) => {
    if (stopping) return;
    exitCode = code ?? 1;
    stop();
  });
  for (const signal of SHUTDOWN_SIGNALS) process.on(signal, stop);
  return child;
}
