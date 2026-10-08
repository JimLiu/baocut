import { parseArgs } from 'node:util';
import { RuntimeAlreadyRunningError, runtimeSelfCheck, startRuntime } from '@baocut/runtime-core';

/**
 * 构建时可以注入的凭据后端（`file` | `keychain`，架构设计 §6.8）。没有注入时是 `file`；
 * 桌面端的正式版本用隐藏参数 `--credential-store keychain` 指定。这不是用户设置。
 */
declare const __BAOCUT_CREDENTIAL_STORE__: string | undefined;
const BUILT_CREDENTIAL_STORE = typeof __BAOCUT_CREDENTIAL_STORE__ === 'string' ? __BAOCUT_CREDENTIAL_STORE__ : 'file';

function credentialStoreKind(value: string): 'file' | 'keychain' {
  if (value === 'file' || value === 'keychain') return value;
  throw new Error(`Unknown credential store: ${value}`);
}

/**
 * Runtime 进程入口。桌面端用 Electron 自带的 Node（ELECTRON_RUN_AS_NODE）启动它；
 * 开发时也可以直接 `npm run runtime`。
 *
 * 就绪后向 stdout 写一行 `{"type":"ready",...}`。令牌不经过 stdout，客户端从发现文件读。
 *
 * `--launched-by cli --idle-exit`：CLI 自动拉起时带上（架构设计 §2.2）。`--launched-by` 记进发现文件（`baocut runtime stop` 只停 CLI 拉起的）；
 * `--idle-exit` 让 Runtime 在没有连接、没有任务、没有开着的对外服务满设置 `runtime.idleExitMinutes` 后自己退出。桌面端不带它们。
 *
 * `--self-check [--probe]` 不启动 Runtime：报告随应用分发的原生程序与数据解析到哪里（`runtimeSelfCheck`），写一行 JSON，
 * 有问题时退出码 1。打包产物的检查（`apps/desktop/tools/check-packaged-app.mjs`）用它。
 */
async function main(): Promise<void> {
  // stdout 只送就绪消息：读它的一端（桌面端主进程）不在了就送不到，不让写入失败（EPIPE）成为未捕获的异常。stderr 上的
  // 回显由日志自己处理（`createFileLogger`）。
  process.stdout.on('error', () => {});
  const { values } = parseArgs({
    options: {
      host: { type: 'string', default: '127.0.0.1' },
      port: { type: 'string', default: '0' },
      'allow-origin': { type: 'string', multiple: true },
      quiet: { type: 'boolean', default: false },
      'credential-store': { type: 'string', default: BUILT_CREDENTIAL_STORE },
      'self-check': { type: 'boolean', default: false },
      probe: { type: 'boolean', default: false },
      'launched-by': { type: 'string' },
      'idle-exit': { type: 'boolean', default: false },
    },
  });
  const launchedBy = values['launched-by'];
  if (launchedBy !== undefined && launchedBy !== 'cli') throw new Error(`Unknown --launched-by: ${launchedBy}`);

  if (values['self-check']) {
    const report = await runtimeSelfCheck({ probe: values.probe });
    // 不直接 exit：写进管道的输出要先送出去。
    process.exitCode = report.problems.length > 0 ? 1 : 0;
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }

  const allowedOrigins = [
    ...(values['allow-origin'] ?? []),
    ...(process.env.BAOCUT_ALLOWED_ORIGINS?.split(',').filter(Boolean) ?? []),
  ];

  let runtime: Awaited<ReturnType<typeof startRuntime>>;
  // 空闲退出在 Runtime 起好之后才可能触发：那时 `stop` 已经定义好。
  let onIdle = () => {};
  let onStopRequest = () => {};
  try {
    runtime = await startRuntime({
      host: values.host,
      port: Number(values.port),
      allowedOrigins,
      echoLogs: !values.quiet,
      credentials: credentialStoreKind(values['credential-store']),
      launchedBy: launchedBy ?? null,
      idleExit: values['idle-exit'] ? { onIdle: () => onIdle() } : null,
      requestStop: () => onStopRequest(),
    });
  } catch (error) {
    if (error instanceof RuntimeAlreadyRunningError) {
      process.stdout.write(`${JSON.stringify({ type: 'already-running', pid: error.pid, endpoint: error.discovery?.endpoint ?? null })}\n`);
      process.exit(3);
    }
    throw error;
  }

  const { info, discovery } = runtime;
  process.stdout.write(
    `${JSON.stringify({ type: 'ready', instanceId: info.instanceId, endpoint: discovery.endpoint, home: info.home, pid: info.pid })}\n`,
  );

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    runtime.log.info('Received stop signal', { signal });
    const force = setTimeout(() => process.exit(1), 15_000);
    force.unref();
    void runtime.close().then(() => process.exit(0));
  };
  onIdle = () => stop('idle');
  onStopRequest = () => stop('runtime.stop');
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  // 由父进程以 IPC 通道启动时（桌面端），父进程经通道发 `{ type: 'stop' }` 请 Runtime 停下：Windows 上 SIGTERM 等于直接
  // 结束进程，处理不到。通道断开（父进程退出或崩溃）不停：Runtime 照旧留着，下一次启动经发现文件找回它（架构设计 §2.2）。
  process.on('message', (message) => {
    if ((message as { type?: unknown } | null)?.type === 'stop') stop('ipc');
  });
  process.on('uncaughtException', (error) => {
    runtime.log.error('Uncaught exception', { error: error.stack ?? String(error) });
  });
  process.on('unhandledRejection', (reason) => {
    runtime.log.error('Unhandled promise rejection', { error: String(reason) });
  });
}

main().catch((error) => {
  process.stderr.write(`Runtime failed to start: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
