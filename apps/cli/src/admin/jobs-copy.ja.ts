import type { JobsMessages } from './jobs-copy.ts';

export const ja: JobsMessages = {
  help: `使い方：
  baocut jobs resources            リソーススケジューリングの状況：マシンの容量とその取得元、予約、
                                   リース、常駐の Model Worker、待機中のタスクが何を待っているか
  baocut jobs reconcile <jobId> retry|discard|apply
                                   再起動後に結果が不明、または適用しきれていないタスクを処理：retry は再実行
                                   （新しい呼び出しとして、許可と予算を再確認）、discard は照合待ちの外部呼び出しを
                                   破棄（課金済みの予算は返金されません）、apply は保持した結果を再検証して動画に適用`,
  usage: '使い方：baocut jobs resources | baocut jobs reconcile <jobId> retry|discard|apply',
  badDecision: (choices) => `照合の決定には ${choices.join('、')} のいずれかを指定してください`,
  jobStates: {
    queued: '待機中',
    running: '実行中',
    completed: '完了',
    failed: '失敗',
    cancelled: 'キャンセル済み',
    interrupted: '中断',
    'needs-reconciliation': '照合が必要',
  },
  applicationStates: {
    pending: '適用待ち',
    validating: '確定中',
    committed: '適用済み',
    'stale-input': '対象が変更済み',
    rejected: '拒否',
    cancelled: '未適用',
  },
  remoteStates: {
    'not-applicable': 'リモートなし',
    'not-submitted': '未送信',
    cancelled: 'リモートでキャンセル済み',
    'cancel-unsupported': 'リモートはキャンセル不可',
    unknown: 'リモートの状態不明',
  },
  costStates: {
    none: '料金なし',
    possible: '課金された可能性あり',
    charged: '課金済み',
  },
  cancellation: (stoppedLocally, remote, cost) => `${stoppedLocally ? 'ローカルで停止済み' : 'ローカルで未停止'}、${remote}、${cost}`,
  cancellationLine: (text) => `キャンセル：${text}`,
  requeued: (attempt, jobId) => `再度キューに追加しました（${attempt} 回目の試行）：${jobId}`,
  discarded: (jobId) => `破棄しました：${jobId}`,
  appliedTo: (videoId, recovered) =>
    `動画 ${videoId} に適用しました${recovered ? '（前回すでに確定していたため、受領記録を今回記録しました）' : ''}`,
  notApplied: (state, error) => `適用されませんでした：${state}${error ? `（${error}）` : ''}`,
  noApplicationRecord: '適用の記録なし',
  statusLine: (state, code) => `状態：${state}${code ? `  ${code}` : ''}`,
  budgetSettled: (basis, calls) => `予算の精算：${basis}、${calls} 回の呼び出し`,
  unknown: '不明',
  amounts: (memory, gpuMemory, cpuThreads, disk) =>
    `メモリ ${memory}  GPU メモリ ${gpuMemory}  CPU ${cpuThreads} スレッド  ディスク ${disk}`,
  demandMemory: (value) => `メモリ ${value}`,
  demandGpuMemory: (value) => `GPU メモリ ${value}`,
  demandCpu: (threads) => `CPU ${threads} スレッド`,
  demandDisk: (value) => `ディスク ${value}`,
  demandNone: 'ローカルのリソースは使用しません',
  listSep: '、',
  clauseSep: '、',
  sources: {
    system: 'システム',
    setting: '設定',
    'unified-estimate': 'ユニファイドメモリから推定',
    unknown: '不明',
    statfs: 'ステージング領域のボリュームの空き容量',
  },
  capacity: (amounts, unified) =>
    `容量：${amounts}${unified ? '（ユニファイドメモリ：GPU メモリもメモリとして計上）' : ''}`,
  capacitySources: (memory, gpuMemory, cpu, disk) =>
    `  取得元：メモリ ${memory}、GPU メモリ ${gpuMemory}、CPU ${cpu}、ディスク ${disk}`,
  systemReserve: (amounts) => `システム用の予約：${amounts}`,
  interactiveReserve: (amounts) => `対話処理用の予約：${amounts}`,
  leased: (amounts) => `リース中：${amounts}`,
  backgroundAvailable: (amounts) => `バックグラウンドで利用可能：${amounts}`,
  interactiveAvailable: (amounts) => `対話処理で利用可能：${amounts}`,
  leasesHeader: 'リース：',
  leasesNone: 'リース：なし',
  leaseHolder: (holder) => `${holder} を使用`,
  leaseQueue: (queue) => `キュー ${queue}`,
  holdersHeader: '常駐プロセス：',
  holderState: (users, processes) =>
    `${users > 0 ? `${users} 件のタスクが使用中` : 'アイドル'}、${processes} 個のプロセスが実行中`,
  waitingHeader: '待機中：',
  waitingNone: '待機中：なし',
  waitingAdmission: '受け入れ待ち',
};
