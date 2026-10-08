import type { ProcessHostWorkerMessages } from './process-host-worker.ts';

export const zhHans: ProcessHostWorkerMessages = {
  requestFailed: (p) => `${p.method} 失败：${p.code}：${p.message}`,
  exited: (p) => `${p.method} 未完成：子进程已退出（code ${p.code}，signal ${p.signal}）`,
  notRunning: (p) => `${p.method} 未发出：子进程没有运行`,
  timedOut: (p) => `${p.method} 超时（${p.ms} ms）`,
  spawnFailed: (p) => `无法启动 ${p.command}：${p.error}`,
  malformedError: '子进程返回的错误不合形状',
};
