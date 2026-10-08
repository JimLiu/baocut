import type { ProcessHostWorkerMessages } from './process-host-worker.ts';

export const ja: ProcessHostWorkerMessages = {
  requestFailed: (p) => `${p.method} が失敗しました：${p.code}：${p.message}`,
  exited: (p) => `${p.method} が完了しませんでした：子プロセスが終了しました（code ${p.code}、signal ${p.signal}）`,
  notRunning: (p) => `${p.method} を送信しませんでした：子プロセスが実行されていません`,
  timedOut: (p) => `${p.method} がタイムアウトしました（${p.ms} ms）`,
  spawnFailed: (p) => `${p.command} を起動できませんでした：${p.error}`,
  malformedError: '子プロセスが不正な形式のエラーを返しました',
};
