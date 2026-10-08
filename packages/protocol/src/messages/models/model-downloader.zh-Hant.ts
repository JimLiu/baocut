import type { ModelsModelDownloaderMessages } from './model-downloader.ts';

export const zhHant: ModelsModelDownloaderMessages = {
  remedyNoSpace: '模型資料夾所在的磁碟空間不足。請釋出足夠的空間（或在設定中把模型資料夾移到其他磁碟），然後再安裝一次',
  remedyNetwork: '無法連上網路，或下載中斷。請檢查網路後再安裝一次，已下載的部分會接續下載；也可以在「設定 › 一般」的「模型下載來源」中切換鏡像站',
  remedyIntegrity: '下載的檔案與資訊清單中的大小或 sha256 不符（來源或鏡像站的內容有誤）。損壞的檔案已刪除；請換一個下載來源後再安裝一次',
  remedySource: '下載來源沒有這個檔案或拒絕存取。請確認「設定 › 一般」的「模型下載來源」（或環境變數 BAOCUT_MODELS_ENDPOINT）指向的鏡像站內容完整',
  remedyManifestIncomplete: '這個模型套件的內建資訊清單缺少可信的 sha256，因此無法安裝。請等待 BaoCut 更新',
  downloadFailed: (p: { file: string; reason: string }) => `無法下載 ${p.file}：${p.reason}`,
  integrityMismatch: (p: { file: string }) => `${p.file} 的大小或 sha256 與資訊清單不符`,
  sourceHttp: (p: { file: string; status: number }) => `下載來源對 ${p.file} 傳回 HTTP ${p.status}`,
  diskFull: '寫入模型檔案時磁碟已滿',
};
