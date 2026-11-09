import { RpcError, idleExceptSeeker, type RuntimeDiscovery } from '@baocut/protocol';
import { M } from '../cli-copy.ts';
import { CliError, EXIT, type ExitCode, type Output } from '../envelope.ts';
import { ProtocolMismatchError, ensureRuntime, exited, findRuntime, isProcessAlive, openClient, signalStop } from './connection.ts';

/**
 * `baocut runtime ensure|status|stop`（Agent 面设计 §5.6；架构设计 §2.2）。
 *
 * - `ensure`：找到正在跑的（`reused`）或拉起一个（`started`）。
 * - `status`：进程、端口、版本、谁拉起的、各种连接数（不含这条命令自己）、任务与对外服务、空闲退出；没在跑时 `running: false`。
 * - `stop`：只停 CLI 拉起的那一个；桌面端、别的 CLI 或没结束的任务还在用时，Runtime 以 `RUNTIME_IN_USE` 拒绝（退出码 1）。
 *   协议版本不同、握不上手时（CLI 独立使用与发布 §4.3）按握手拒绝里报的忙闲判断，空闲就发信号请它停下（`signalled: true`）。
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

  const discovery = await findRuntime(home);
  if (!discovery) {
    return action === 'stop'
      ? output.success({ stopped: false, running: false, home })
      : output.success({ running: false, home }, 'baocut runtime ensure');
  }
  // 状态查询只返回结构化字段，不额外读语言偏好，避免 settings.get 清零空闲计时。
  let opened: Awaited<ReturnType<typeof openClient>>;
  try {
    opened = await openClient(discovery, { readLanguage: action !== 'status' });
  } catch (error) {
    if (action === 'stop' && error instanceof ProtocolMismatchError) return stopMismatched(output, discovery, error);
    throw error;
  }
  const { client, info } = opened;
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

/**
 * 协议版本不同的 Runtime 发不了 `runtime.stop`（§4.3）：同它的拒绝条件，只停 CLI 拉起的；握手拒绝里报的忙闲显示还有任务或别的
 * 连接时照版本门报（错误里带着忙闲）。更早的 Runtime 不报连接数（只报任务数，或什么都不报），这时按用户要停的意思停下。
 * SIGTERM 让它照停止顺序收尾。
 */
async function stopMismatched(output: Output, discovery: RuntimeDiscovery, error: ProtocolMismatchError): Promise<ExitCode> {
  const launchedBy = error.launchedBy !== undefined ? error.launchedBy : discovery.launchedBy;
  const { activeJobs, activity } = error.facts;
  const busy = activity ? !idleExceptSeeker('cli', activity, false) : (activeJobs ?? 0) > 0;
  if (launchedBy !== 'cli' || busy) throw error;
  const stopped = signalStop(discovery) && (await exited(discovery, 20_000));
  return output.success({ stopped, pid: discovery.pid, signalled: true });
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isProcessAlive(pid);
}
