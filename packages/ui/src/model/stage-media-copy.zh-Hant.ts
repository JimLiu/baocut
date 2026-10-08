import type { StageMediaMessages } from './stage-media-copy.ts';

export const zhHant: StageMediaMessages = {
  titles: {
    missing: '找不到原始檔案',
    changed: '原始檔案已變更',
    'outside-project': '原始檔案在專案資料夾之外',
    unplayable: '無法播放原始檔案',
  },
  causes: {
    missing: '檔案可能已被移動、重新命名或刪除，也可能位於已中斷連接的磁碟上。',
    changed: '這個位置上的檔案已不是匯入時的那一個（大小不符），可能已被覆寫或重新匯出。',
    'outside-project': '記錄的位置在這部影片所屬的專案資料夾之外，BaoCut 不會讀取那裡的檔案。',
  },
  unplayable: (error: string) => `播放器無法開啟這個檔案：${error}。`,
  tail: { video: '字幕仍可正常播放，只是沒有畫面和原聲。', audio: '字幕仍可正常播放，只是聽不到這段音訊。' },
  body: (cause: string, tail: string) => `${cause}${tail}`,
  volume: (volume: string) => `檔案位於「${volume}」。連接該磁碟後就會自動回復。`,
  more: (count: number) => `還有 ${count} 個影片或音訊素材也無法播放。`,
  relinkHint: '選擇原本的檔案即可回復。BaoCut 會核對內容，內容不同的檔案無法重新連結。',
  desktopOnly: '若要回復，請在 BaoCut 桌面應用程式中開啟這部影片，並使用畫布上的「重新連結…」選擇原本的檔案。',
  managed: '這個檔案原本存放在影片資料夾中，因此無法重新連結到其他位置。',
  oldRevision: '時間軸使用的是這個素材的舊版本；只有目前版本可以重新連結。',
  relink: '重新連結…',
  relinking: '正在核對…',
  pickTitle: (name: string) => `尋找「${name}」`,
  pickButton: '重新連結',
  label: (name: string) => `重新連結「${name}」`,
  relinkFailed: (message: string) => `無法重新連結：${message}`,
  decodeFailed: '解碼失敗',
  unsupported: '不支援此格式',
};
