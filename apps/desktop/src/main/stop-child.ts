import type { ChildProcess } from 'node:child_process';

/** 强杀之后最多再等它退出多久（SIGKILL / TerminateProcess 正常几毫秒就结束；这只是不让异常情况挂住退出）。 */
const KILL_WAIT_MS = 2_000;

/** 经 IPC 通道请子进程停下的消息（Runtime 的入口认它，`apps/runtime/src/main.ts`）。 */
export const STOP_MESSAGE = { type: 'stop' } as const;

/**
 * 请子进程自己停下，等它退出；超过 `timeoutMs` 强杀。返回它是自己退出的（`exited`）还是被强杀的（`killed`）。
 *
 * 有 IPC 通道时经通道发 `STOP_MESSAGE`：子进程照常收尾（Runtime 的停止顺序，架构设计 §2.4）。Windows 上没有能被处理的
 * SIGTERM（`kill('SIGTERM')` 等于直接结束进程），所以不能靠信号请它停。没有 IPC 通道（或发不出去）时才退回 SIGTERM，
 * 这在 Windows 上就是强杀。
 */
export function stopChild(child: ChildProcess, timeoutMs: number): Promise<'exited' | 'killed'> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve('exited');
  return new Promise((resolve) => {
    let killed = false;
    let giveUp: NodeJS.Timeout | null = null;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
      giveUp = setTimeout(() => resolve('killed'), KILL_WAIT_MS);
    }, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      if (giveUp) clearTimeout(giveUp);
      resolve(killed ? 'killed' : 'exited');
    });
    if (child.connected) {
      child.send(STOP_MESSAGE, (error) => {
        if (error) child.kill('SIGTERM');
      });
    } else child.kill('SIGTERM');
  });
}
