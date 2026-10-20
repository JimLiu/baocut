import type { ModelManagementMessages } from './model-management-copy.ts';

export const zhHant: ModelManagementMessages = {
  removeModel: "刪除模型",
  removeModelBody: "從 BaoCut 刪除這筆手動新增的模型設定？供應商與帳號保留；若它是預設模型，對應預設值會清除。若有同名預設模型，刪除後仍會顯示該預設模型，且無法繼續刪除。",
  pickAudio: "選擇音訊或影片",
  asrTitle: "測試語音辨識",
  asrNote: "請選擇一段短音訊或影片。音訊會傳送給所選供應商；TXT/SRT 結果儲存在設定的儲存位置，並列入 Space。",
  asrRunning: "正在傳送音訊並等待轉錄…",
  desktopOnly: "請在桌面應用程式選擇本機檔案測試語音辨識。",
};
