import { RpcError } from '@baocut/protocol';
import { M } from '../cli-copy.ts';
import { CliError, EXIT, type ExitCode, type Output } from '../envelope.ts';
import { ensureRuntime, findRuntime, isProcessAlive, openClient } from './connection.ts';

/**
 * `baocut runtime ensure|status|stop`（Agent 面设计 §5.6；架构设计 §2.2）。
 *
 * - `ensure`：找到正在跑的（`reused`）或拉起一个（`started`）。
 * - `status`：进程、端口、版本、谁拉起的、各种连接数（不含这条命令自己）、任务与对外服务、空闲退出；没在跑时 `running: false`。
 * - `stop`：只停 CLI 拉起的那一个；桌面端、别的 CLI 或没结束的任务还在用时，Runtime 以 `RUNTIME_IN_USE` 拒绝（退出码 1）。
 */
export async function runtimeCommand(output: Output, home: string, args: readonly string[], noStart: boolean): Promise<ExitCode> {
  const [action, ...extra] = args;
  if (extra.length > 0 || !['ensure', 'status', 'stop'].includes(action ?? '')) {
    throw new CliError('INVALID_ARGUMENTS', M.runtimeUsage);
  }
  if (action === 'ensure') {
    const { discovery, started } = await ensureRuntime(home, { start: !noStart });
    const { client, info } = await openClient(discovery);
    client.close();
    if (started) output.runtimeStarted = true;
    return output.success({
      status: started ? 'started' : 'reused',
      pid: info.pid,
      endpoint: discovery.endpoint,
      version: info.runtimeVersion,
      launchedBy: info.launchedBy,
      home: info.home,
    });
  }

  const discovery = findRuntime(home);
  if (!discovery) {
    return action === 'stop'
      ? output.success({ stopped: false, running: false, home })
      : output.success({ running: false, home }, 'baocut runtime ensure');
  }
  // 状态查询只返回结构化字段，不额外读语言偏好，避免 settings.get 清零空闲计时。
  const { client, info } = await openClient(discovery, { readLanguage: action !== 'status' });
  try {
    if (action === 'status') {
      const state = await client.request('runtime.status', {});
      const port = Number(new URL(discovery.endpoint).port);
      return output.success({
        running: true,
        pid: info.pid,
        endpoint: discovery.endpoint,
        port,
        version: info.runtimeVersion,
        home: info.home,
        startedAt: info.startedAt,
        launchedBy: info.launchedBy,
        desktopConnected: state.connections.desktop > 0,
        // 这条命令自己也是一个 CLI 连接，不算。
        connections: { ...state.connections, cli: Math.max(0, state.connections.cli - 1) },
        activeJobs: state.activeJobs,
        runningServices: state.runningServices,
        idleExit: state.idleExit,
      });
    }
    try {
      await client.request('runtime.stop', {});
    } catch (error) {
      if (error instanceof RpcError) {
        const details = (typeof error.details === 'object' && error.details !== null ? error.details : {}) as Record<string, unknown>;
        const code = typeof details.code === 'string' ? details.code : 'RUNTIME_STOP_REFUSED';
        return output.failure({ ...details, code, message: error.message }, EXIT.failed);
      }
      throw error;
    }
    client.close();
    const gone = await waitForExit(info.pid, 20_000);
    return output.success({ stopped: gone, pid: info.pid });
  } finally {
    client.close();
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isProcessAlive(pid);
}
