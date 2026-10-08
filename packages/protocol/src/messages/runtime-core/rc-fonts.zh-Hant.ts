import type { RcFontsMessages } from './rc-fonts.ts';

export const zhHant: RcFontsMessages = {
  manageOnlyInAppOrCli: '只能在桌面應用程式或 CLI 中下載、刪除和檢查字型',
  catalogueInvalid: '字型目錄的格式不正確',

  remedyNetwork:
    '無法連線到網路或下載中斷。請檢查網路後再次下載，或在「設定 › 字型」的「樣式表 URL」和「字型檔 URL」中切換鏡像站',
  remedySource: '字型服務沒有提供這個字型的檔案。請檢查字族名稱和字重，或設定中的鏡像站位址',
  remedyIntegrity: '下載的不是可用的字型（字族名稱不符、無法讀取或檔案過大）。損壞的檔案已刪除，請切換到其他鏡像站後再次下載',
  remedyNoSpace: 'Runtime Home 所在的磁碟空間不足。請釋放空間後再次下載',

  diskFullWriting: (p) => `寫入「${p.what}」時磁碟已滿`,
  sourceHttpStatus: (p) => `字型服務對「${p.what}」傳回 HTTP ${p.status}`,
  downloadFailed: (p) => `下載「${p.what}」失敗：${p.reason}`,
  overByteLimit: (p) => `「${p.what}」超過 ${p.limit} 位元組的上限`,

  downloadCancelled: '已取消字型下載',
  cancelled: '已取消下載',
  offlineStrict: '嚴格離線模式下不會下載字型',
  autoDownloadOff: '自動下載字型已關閉（「設定 › 字型」中的「自動下載字型」）',
  downloadFailedOutcome: (p) => `下載失敗：${p.reason}`,
  notInCatalogue: (p) => `字型目錄中沒有「${p.family}」`,
  noNeedToDownload: (p) => `「${p.family}」${p.bundled ? '隨應用程式內建' : '已安裝在這台電腦上'}，不需要下載`,
  inUseByExport: (p) => `「${p.family}」正被尚未完成的匯出使用，請在匯出結束後再刪除`,

  sampleLabel: (p) => `${p.family} 樣本`,
  sampleCss: (p) => `${p.label}的樣式表`,
  noSampleBlock: (p) => `字型服務的回應中不包含「${p.label}」`,
  sampleNotOnHost: (p) => `「${p.label}」不在所設定的字型檔主機上`,
  sampleNotUsable: (p) => `下載的「${p.label}」不是可用的字型`,

  faceLabel: (p) => `${p.family} ${p.italic ? '斜體 ' : ''}${p.weight}`,
  faceCss: (p) => `${p.label} 的字型樣式表`,
  noFaceBlock: (p) => `字型服務的回應中不包含「${p.label}」`,
  faceSplit: (p) => `字型服務將「${p.label}」切分成依字元劃分的子集，BaoCut 目前還無法合併`,
  faceNotOnHost: (p) => `「${p.label}」的檔案不在所設定的字型檔主機上`,
  faceNotUsable: (p) => `下載的「${p.label}」不是可用的字型`,
  familyMismatch: (p) => `下載的「${p.label}」字族名稱不符`,
};
