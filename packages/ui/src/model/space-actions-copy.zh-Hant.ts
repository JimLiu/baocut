import type { SpaceActionsMessages } from './space-actions-copy.ts';

export const zhHant: SpaceActionsMessages = {
  edit: {
    video: '開啟影片',
    'source-video': '回到來源影片編輯',
    'new-video': '以這個素材建立新影片',
    text: '編輯文字',
    version: '另存副本後編輯',
  },
  trashed: '請先從垃圾桶回復這個項目',
  editGenerating: '仍在生成中，完成後才能編輯',
  editMissing: '找不到檔案；請重新連結檔案後再編輯',
  editFailed: '產生失敗，沒有可編輯的檔案',
  editPackage: '影片套件（可攜式套件）無法編輯',
  editText: '目前還無法在這裡另存文字的新版本；請在對話中繼續，讓 Agent 修改',
  editVersion: '目前還無法手動修改圖片、音訊與範本；請在對話中繼續，讓 Agent 修改',
  newVideoOutside: '這個檔案不在專案或對話的資料夾中，目前還無法用它建立新影片',
  packageGenerating: '仍在匯出中，完成後才能開啟',
  packageMissing: '找不到這個檔案',
  packageFailed: '匯出失敗，沒有可開啟的套件',
  packageOutside: '這個套件不在專案或對話的資料夾中，目前還無法開啟',
  continueTrashed: '請先從垃圾桶回復這個項目，才能帶入對話',
  purgeGenerating: '任務仍在執行；請先在任務頁面取消',
  purgeNotTrashed: '請先移到垃圾桶，再從垃圾桶中刪除',
  referenceKind: {
    'video-asset': '影片素材',
    job: '執行中的任務',
    unverified: '無法確認',
    'user-file': '影片資料夾中的其他檔案',
  },
  importAllFailed: (count: number, error: string) => `${count} 個檔案都未匯入：${error}`,
  importFailed: (error: string) => `未匯入：${error}`,
  imported: (count: number) => `已匯入 ${count} 個素材`,
  copiedAll: '已複製到專案的 imports/',
  copiedSome: (count: number) => `${count} 個已複製到專案的 imports/`,
  notImported: (count: number) => `${count} 個未匯入`,
  references: (names: readonly string[], total: number) => {
    const quoted = names.map((name) => `「${name}」`).join('');
    return total > names.length ? `Space 項目 ${quoted}等 ${total} 個` : `Space 項目 ${quoted}`;
  },
  referenceOutput: '產出',
};
