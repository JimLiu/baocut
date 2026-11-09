import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const zhHant: ModelsModelServiceStoreMessages = {
  notMigrated: '第 1 版的金鑰尚未遷移',
  orderMismatch: 'order 必須恰好列出這個供應商現有的每個帳號各一次',
  credentialNotSaved: (p: { reason: string }) => `憑證未儲存：${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} 沒有這個帳號：${p.account}`,
  accountLinked: (p: { home: string }) => `這個帳號是從 ${p.home} 連結來的，要在那邊改或刪它的金鑰`,
  linkSameHome: '不能從同一個 BaoCut 主目錄連結帳號',
  linkSourceFileBacked: (p: { home: string }) => `${p.home} 把金鑰存在檔案裡，不在系統鑰匙圈裡；只能連結使用鑰匙圈的主目錄`,
  linkSourceEmpty: (p: { home: string }) => `${p.home} 裡沒有 BaoCut 的模型服務設定`,
  linkNoMatch: (p: { home: string }) => `${p.home} 裡沒有相符的帳號`,
  linkedHelperMissing: (p: { home: string }) => `從 ${p.home} 連結來的帳號讀不了金鑰：找不到已安裝的 BaoCut 應用程式裡的憑證助手`,
  linkedSourceMissing: (p: { account: string; home: string }) => `連結帳號 ${p.account} 已經不在 ${p.home} 裡了`,
  linkedKeyMissing: (p: { account: string; home: string }) => `連結帳號 ${p.account}（來自 ${p.home}）的金鑰不在系統鑰匙圈裡`,
  linkedUnreadable: (p: { account: string; home: string; reason: string }) => `連結帳號 ${p.account}（來自 ${p.home}）的金鑰讀不了：${p.reason}`,
};
