/*
 * 部分机制移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * packages/server/src/server/agent/providers/acp-agent.ts 与 codex/app-server-transport.ts 在进程关掉 stdio（`close`）之后
 * 才取 stderr 的做法。改成「exit 之后最多再等一会儿 stderr 读完」。
 */
import type { Readable } from 'node:stream';

/**
 * 等一个子进程的输出流读完，最多 `ms` 毫秒。Node 先报 `exit`、后读完 stdio：在 `exit` 当下取 stderr，可能缺了它退出前写下的那句原因。
 * 它派生的进程还拿着这个管道时流不会结束，所以有上限。
 */
export function streamEnded(stream: Readable | null | undefined, ms = 500): Promise<void> {
  if (!stream || stream.readableEnded || stream.destroyed) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      stream.off('end', done);
      stream.off('close', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    timer.unref?.();
    stream.once('end', done);
    stream.once('close', done);
  });
}
