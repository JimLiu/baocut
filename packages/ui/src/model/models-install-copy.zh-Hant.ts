import type { ModelsInstallMessages } from './models-install-copy.ts';

const KEEP = '已下載的部分會保留，下次下載會從中斷處繼續。';

export const zhHant: ModelsInstallMessages = {
  planSize: (size) => `將下載 ${size}`,
  planSizeEstimate: (size) => `約 ${size}（部分檔案大小不明，依登錄的估計值計算）`,
  amountEstimate: (size) => `約 ${size}`,
  noSpace: (need, have) => `磁碟空間不足：這次需要 ${need}，但模型資料夾所在的磁碟只剩 ${have}。請先清出空間再下載。`,
  resumed: (size) => `上次已下載的 ${size} 會直接沿用，不會重新下載。`,
  space: (size) => `磁碟可用 ${size}`,
  lineKeep: '已安裝，保持不變',
  lineSize: (size, count) => `${size} · ${count} 個檔案`,
  lineUnknown: (count) => `大小不明 · ${count} 個檔案`,
  queued: '排隊等待下載',
  downloading: (amount) => `正在下載 ${amount}`,
  downloadingUnknown: (amount) => `正在下載 · 已接收 ${amount}`,
  verifying: '正在驗證並發布',
  pausedKept: (amount) => `已暫停 · 保留 ${amount}，繼續時會從中斷處接續`,
  paused: '已暫停',
  remedyNoSpace: (need, have) => `${need !== null && have !== null ? `這次需要 ${need}，但只剩 ${have}。` : ''}請清出磁碟空間後再下載。${KEEP}`,
  remedyNetwork: `請檢查網路後再下載。${KEEP}如果無法連上預設來源，可以在「設定 › 一般」的「模型下載來源」中改用鏡像站。`,
  remedyIntegrity: '下載來源提供的檔案與清單中的大小或 sha256 不符，損壞的檔案已刪除。請改用其他下載來源（「設定 › 一般」的「模型下載來源」）後再下載。',
  remedySource: '下載來源沒有這個檔案或拒絕存取。請檢查「設定 › 一般」的「模型下載來源」（或環境變數 BAOCUT_MODELS_ENDPOINT）指向的鏡像站是否完整。',
  remedyManifest: '這個模型套件的內建清單缺少可信的 sha256，必須等 BaoCut 更新後才能安裝。',
  remedyOffline: '嚴格離線模式已開啟，不會下載任何內容。若要下載，請先在設定中關閉嚴格離線模式。',
  remedySizeChanged: '下載大小已變更，請依新的計畫再確認一次。',
  remedyInUse: '有任務正在使用這個模型套件（轉錄、合成、檢查或安裝）。請等它完成，或在背景任務中取消它，再刪除一次。',
  remedyUnavailable: '目前無法使用這個模型套件（未完整安裝、已停用，或這台電腦不支援）。請先修復或重新啟用。',
  remedyInstallFailed: `請再下載一次。${KEEP}`,
  problemText: (message, remedy) => (/[.!?。！？]$/.test(message) ? `${message}${remedy}` : `${message}。${remedy}`),
  removalBody: (unknown, frees, kept) =>
    `${unknown ? '將刪除只有這個模型套件使用的檔案。' : frees !== null ? `約可釋出 ${frees}。` : ''}${kept
      .map((k) => `${k.repo} 仍由 ${k.usedBy.join('、')} 使用，因此會保留。`)
      .join('')}若要再次使用，需要重新下載。`,
  removed: (bundleId) => `已刪除 ${bundleId}`,
  removedKept: (bundleId, repos) => `已刪除 ${bundleId} · ${repos.join('、')} 仍有其他模型套件在使用，因此已保留`,
};
