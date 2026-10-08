import type { DriversCommonMessages } from './drivers-common.ts';

export const zhHant: DriversCommonMessages = {
  executableMissing: (p) => `指定的 ${p.command}（${p.path}）不存在或無法執行。`,
  commandMissing: (p) => `找不到 ${p.command} 指令。${p.hint}，或在設定中指定它的位置。`,
  commandNotFound: (p) => `找不到 ${p.command} 指令`,
  installItFirst: '請先安裝',
  versionFailed: (p) => `${p.command} --version 沒有正常結束。`,
  outdated: (p) => `${p.name} ${p.version} 版本太舊，BaoCut 需要 ${p.min} 或更新版本。`,
  startFailed: (p) => `${p.name} 無法啟動：${p.error}`,
  openSessionFailed: (p) => `${p.name} 無法開啟對話：${p.error}`,
  confinedUnsupported: (p) => `${p.name} 不支援受限的一次性呼叫`,
  resumeFailed: (p) => `無法繼續 ${p.name} 原生對話${p.error ? `（${p.error}）` : ''}。已開始新對話，Agent 看不到先前的對話內容。`,
  sessionClosed: (p) => `${p.name} 對話已關閉`,
  sessionNotReady: (p) => `${p.name} 對話尚未就緒`,
  turnInProgress: '上一輪尚未結束',
  modelSwitchFailed: (p) => `${p.name} 無法切換到模型 ${p.model}：${p.error}`,
  timedOut: (p) => `${p.label} 逾時（${p.seconds} 秒）`,
  unknownError: '未知的錯誤',
  unknownReason: '原因不明',
  imagePlaceholder: '[圖片]',
  officialScript: '官方指令碼',
};
