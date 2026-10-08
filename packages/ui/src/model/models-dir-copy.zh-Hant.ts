import type { ModelsDirMessages } from './models-dir-copy.ts';

export const zhHant: ModelsDirMessages = {
  dir: {
    title: '模型資料夾',
    defaultChip: '預設',
    envChip: '環境變數',
    change: '變更…',
    restore: '回復預設值',
    envNote: '由環境變數 BAOCUT_MODELS_DIR 指定。若要變更，請修改環境變數並重新啟動 BaoCut。',
    shareHint: '如果其他應用程式共用這個資料夾，在這裡刪除模型會一併刪除資料夾中的檔案，其他應用程式也會找不到它。',
    blockedPrefix: '目前無法變更：',
    viewTasks: '查看任務',
    changeTitle: '變更模型資料夾',
    restoreTitle: '回復預設位置',
    restoreLead: '將模型資料夾改回',
    checking: '正在查看這個資料夾…',
    cancel: '取消',
    howTo: '如何處理現有的模型',
    moveOption: '將現有模型移到新位置',
    switchOption: '只切換位置',
    confirmMove: '移動並變更',
    confirmSwitch: '變更位置',
    movingLabel: '正在移動模型',
    stayOpen: '期間請勿結束 BaoCut',
    missingDir: '這個資料夾不存在（外接磁碟未連接時也會如此）。連接後模型即可再次使用，你也可以選擇其他位置。',
    notWritableDir: 'BaoCut 沒有這個資料夾的寫入權限，因此無法將模型下載到這裡。',
    loading: '正在讀取模型資料夾…',
    pickFailed: (message) => `無法選擇資料夾：${message}`,
    same: '這已經是目前的模型資料夾',
  },
  stats: (used, free, count) => [`已使用 ${used}`, ...(free !== null ? [`磁碟可用 ${free}`] : []), `已找到 ${count} 個模型`].join(' · '),
  blocker: (downloading, testing, tasks) => {
    const parts: string[] = [];
    if (downloading.length) parts.push(`正在下載 ${downloading.join('、')}`);
    if (testing.length) parts.push(`正在檢查 ${testing.join('、')}`);
    if (tasks) parts.push(`有 ${tasks} 個任務正在使用本機模型`);
    return `${parts.join('；')}。請等它們完成後再變更，否則檔案會在使用中被移動。`;
  },
  missingTitle: '找不到這個資料夾',
  missingText: '這個資料夾不存在。外接磁碟未連接時也會如此，請連接後再選擇一次。',
  notWritableTitle: '這個資料夾無法寫入',
  notWritableText: 'BaoCut 沒有這個資料夾的寫入權限，因此無法將模型下載到這裡。請選擇可寫入的位置，或先變更它的權限。',
  nestedTitle: '無法放在這裡',
  nestedText: '新位置與目前的模型資料夾互相包含（一個在另一個裡面）。請選擇既不在它裡面、也不包含它的資料夾。',
  found: (count, bytes, free) =>
    `${count ? `找到 ${count} 個已下載的模型（${bytes}），可以直接使用。` : '這個資料夾中還沒有模型，之後下載的模型會放在這裡。'}${
      free !== null ? `磁碟可用 ${free}。` : ''
    }`,
  moveNoFit: (required, free, short) => `移動需要 ${required}，但目標磁碟只有 ${free} 可用（還差 ${short}），空間不足。`,
  moveSameVolume: (size) => `將在同一個磁碟上移動 ${size}，很快就能完成。移動後，原位置不會保留這些檔案。`,
  moveOther: (size) => `將移動 ${size}。移動後，原位置不會保留這些檔案。`,
  switchDescription: (count) => `原位置的檔案會保留，不會刪除。只有新位置中已有的${count ? ` ${count} 個` : ''}模型可以使用，其餘會顯示為未安裝。`,
  appliedMoving: (where) => `已開始將模型移到 ${where}`,
  appliedKept: (where) => `模型資料夾已變更為 ${where} · 原位置的檔案已保留`,
  applied: (where) => `模型資料夾已變更為 ${where}`,
  moveWaiting: (to) => `正在等待開始移動${to ? `到 ${to}` : ''}…`,
  moveValidating: (amount) => `正在驗證複製的檔案${amount ? `（${amount}）` : ''}…`,
  movePublishing: '正在完成移動…',
  moving: (amount, to) => `正在移動${amount ? ` ${amount}` : ''}${to ? ` 到 ${to}` : ''}…`,
};
