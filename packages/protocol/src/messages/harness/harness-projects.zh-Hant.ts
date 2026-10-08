import type { HarnessProjectsMessages } from './harness-projects.ts';

export const zhHant: HarnessProjectsMessages = {
  conversationNotFound: (p) => `找不到對話：${p.id}`,
  projectNotFound: (p) => `找不到專案：${p.id}`,
  folderInaccessible: (p) => `資料夾不存在或無法存取：${p.dir}`,
  markerReadFailed: (p) => `無法讀取專案標記：${p.error}`,
  markerNewer: (p) => `這個專案是由較新版本的 BaoCut 建立的（專案標記版本 ${p.version}）。請更新 BaoCut 後再開啟`,
  untitledProject: '未命名專案',
  createFolderFailed: (p) => `無法建立專案資料夾：${p.error}`,
  tooManySameName: '同名的專案資料夾太多，請換一個名稱',
  markerNotWritable: (p) => `專案資料夾無法寫入，因此無法寫入專案標記 .bcut/project.json：${p.dir}`,
  markerWriteFailed: (p) => `無法寫入專案標記：${p.error}`,
};
