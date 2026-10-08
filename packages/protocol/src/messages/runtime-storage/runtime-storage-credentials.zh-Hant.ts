import type { RuntimeStorageCredentialsMessages } from './runtime-storage-credentials.ts';

export const zhHant: RuntimeStorageCredentialsMessages = {
  denied: '存取遭拒',
  unavailable: '無法使用憑證儲存區',
  unsupported: '這個平台不支援系統的安全儲存區',
  internal: '讀寫憑證時發生錯誤',
  problem: (p) => `${p.reason}：${p.message}`,
  fileWriteFailed: (p) => `無法寫入憑證檔案（${p.code}）`,
  fileUnreadable: (p) => `無法讀取憑證檔案，已原樣保留（${p.code}）`,
  helperBadResponse: '憑證輔助程式傳回的回應無效',
  helperNotFound: '找不到憑證輔助程式',
  helperTimedOut: (p) => `憑證輔助程式未在 ${p.seconds} 秒內回應`,
  helperMissing: '缺少憑證輔助程式',
  helperStartFailed: (p) => `無法啟動憑證輔助程式（${p.code}）`,
  helperResponseTooLong: '憑證輔助程式的回應過長',
  helperExitedSilently: '憑證輔助程式未回應就結束了',
  helperReportedError: '憑證輔助程式回報了錯誤',
  redacted: '[已遮蔽]',
};
