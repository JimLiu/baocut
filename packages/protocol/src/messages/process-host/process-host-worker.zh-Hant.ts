import type { ProcessHostWorkerMessages } from './process-host-worker.ts';

export const zhHant: ProcessHostWorkerMessages = {
  requestFailed: (p) => `${p.method} 失敗：${p.code}：${p.message}`,
  exited: (p) => `${p.method} 未完成：子行程已結束（code ${p.code}，signal ${p.signal}）`,
  notRunning: (p) => `${p.method} 未送出：子行程沒有在執行`,
  timedOut: (p) => `${p.method} 逾時（${p.ms} ms）`,
  spawnFailed: (p) => `無法啟動 ${p.command}：${p.error}`,
  malformedError: '子行程傳回的錯誤格式不正確',
};
