import type { LegacyImportMessages } from './legacy-import-copy.ts';

export const zhHant: LegacyImportMessages = {
  title: '匯入舊版專案？',
  lead: (n) => `這台電腦上有 ${n} 個舊版 BaoCut 的專案。匯入後可以在新版裡繼續編輯，舊檔案留在原處，不會改動。`,
  found: '找到的舊版專案',
  destination: '匯入到',
  resetDefault: '改回預設',
  change: '變更…',
  pickTitle: '選擇匯入位置',
  destinationNote: '這個資料夾會作為一個專案出現在 Home，每個舊版專案是其中的一部影片。',
  hint: '略過後，下次啟動還會再問；勾選「不再提醒」後不再匯入。',
  never: '不再提醒',
  skip: '略過',
  import: '匯入',
  importing: (n) => `開始在背景匯入 ${n} 個舊版專案`,
  neverDone: '以後不再提醒匯入舊版專案，舊檔案保持原樣',
  skipped: '已略過，下次啟動時再問',
  failed: (message) => `無法匯入：${message}`,
};
