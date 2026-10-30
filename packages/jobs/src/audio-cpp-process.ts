import type { spawn as spawnFn, ChildProcess } from 'node:child_process';
import { ProviderFailure } from '@baocut/models';
import { killProcessTree } from '@baocut/process-host';
import { JobsLocalProvider as L } from '@baocut/protocol/messages/jobs/local-provider.ts';
import type { JobsLogger } from './jobs-logger.ts';

/** stderr 与 stdout 留给失败说明的尾巴长度。 */
const OUTPUT_TAIL = 2000;

export interface AudioCppExit {
  /** 信号中止、进程已经结束。 */
  cancelled: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
  /** 输出的尾巴（stdout 与 stderr 合在一起），给失败说明用。 */
  tail: string;
}

/**
 * 跑一次内置 audio.cpp 引擎（`audiocpp_cli`）并等它退出（本地音乐生成与 audio.cpp 分离共用，架构设计 §6.3）。进程放进 `active`
 * （Provider 关闭时结束它们），退出后移出。信号中止时先 SIGTERM 整个进程组（Windows 上 taskkill 整棵树），`cancelGraceMs` 后
 * SIGKILL，进程退出后以 `cancelled` 兑现。起不来时 `unavailable`；非零退出只记日志，由调用方决定怎么报。
 */
export function runAudioCppEngine(options: {
  spawn: typeof spawnFn;
  engine: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  cancelGraceMs: number;
  active: Set<ChildProcess>;
  log: JobsLogger;
  jobId: string;
}): Promise<AudioCppExit> {
  const { signal } = options;
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = options.spawn(options.engine, options.args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
    } catch (error) {
      reject(new ProviderFailure('unavailable', L.audioCppSpawnFailed({ reason: String(error) })));
      return;
    }
    options.active.add(child);
    let tail = '';
    const collect = (chunk: Buffer) => {
      tail = (tail + chunk.toString('utf8')).slice(-OUTPUT_TAIL);
    };
    child.stderr?.on('data', collect);
    child.stdout?.on('data', collect);
    let cancelled = false;
    let killTimer: NodeJS.Timeout | null = null;
    const onAbort = () => {
      cancelled = true;
      killProcessTree(child, 'SIGTERM');
      killTimer = setTimeout(() => killProcessTree(child, 'SIGKILL'), options.cancelGraceMs);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    const done = () => {
      signal.removeEventListener('abort', onAbort);
      if (killTimer) clearTimeout(killTimer);
      options.active.delete(child);
    };
    child.once('error', (error) => {
      done();
      reject(new ProviderFailure('unavailable', L.audioCppSpawnFailed({ reason: error.message })));
    });
    child.once('exit', (code, sig) => {
      done();
      if (!cancelled && code !== 0) {
        options.log.warn('audio.cpp engine failed', { jobId: options.jobId, code, signal: sig, args: options.args, tail });
      }
      resolve({ cancelled, code, signal: sig, tail: tail.trim() });
    });
  });
}

/** 非零退出 → `crashed`，带退出码（或信号）与输出的尾巴。 */
export function audioCppExitFailure(exit: AudioCppExit): ProviderFailure {
  return new ProviderFailure(
    'crashed',
    L.audioCppExited({ code: exit.code === null ? String(exit.signal) : String(exit.code), tail: exit.tail }),
    { exitCode: exit.code, signal: exit.signal },
  );
}
