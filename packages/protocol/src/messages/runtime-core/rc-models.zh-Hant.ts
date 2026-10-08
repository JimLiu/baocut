import type { RcModelsMessages } from './rc-models.ts';

export const zhHant: RcModelsMessages = {
  offlineStrict: '嚴格離線模式下不會下載模型',
  sizeChanged: '要下載的位元組數已變更，請依新的計畫重新確認',
  bundleInUse: '模型套件正在使用中。請在任務結束或取消後再刪除',
  diarizationNoCheck: '說話者區分模型套件沒有獨立的檢查：它會在轉錄時與辨識模型套件一起使用',
  bundleUnavailable: '模型套件目前無法使用',
  installFailed: '安裝模型時發生錯誤',
  noSuchBundle: (p) => `沒有這個模型套件：${p.bundleId}`,
  movingDirWait: '正在移動模型資料夾。請在移動完成後再試',
  dirMissing: '模型資料夾不存在（外接磁碟未連接時也會發生）。請連接後再試，或在設定中選擇其他模型資料夾',
  selfTestSampleLabel: '辨識檢查的樣本',

  workerFailed: (p) => `Worker 失敗：${p.reason}`,
  workerCancelledCheck: 'Worker 自行取消了檢查',
  noWorkerOutput: 'Worker 沒有產生任何輸出',
  outputMissing: '輸出檔案不存在',
  outputMismatch: '輸出檔案的長度或 sha256 與 Worker 的回應不符',
  namedOutputMissing: (p) => `輸出檔案 ${p.file} 不存在`,
  namedOutputMismatch: (p) => `${p.file} 的長度或 sha256 與 Worker 的回應不符`,
  outputNotJson: '輸出不是有效的 JSON',
  outputNotAsrResult: '輸出不符合 asr-result 合約',
  transcriptMissingExpected: (p) => `辨識出的文字中不包含「${p.expected}」`,
  separationPassed: (p) => `${p.duration} 秒 · ${p.sampleRate} Hz · 人聲比背景高 ${p.finite ? `${p.ratio} dB` : '很多'}`,
  speechPassed: (p) => `${p.duration} 秒 · ${p.sampleRate} Hz`,
  imagePassed: (p) => `${p.width}×${p.height} · ${p.steps} 步`,

  envLocked: '模型資料夾由環境變數 BAOCUT_MODELS_DIR 設定。若要變更，請修改該變數並重新啟動 BaoCut',
  movingDirWaitOrCancel: '正在移動模型資料夾。請在移動完成或取消後再變更',
  folderMissing: '這個資料夾不存在（外接磁碟未連接時也會發生）',
  folderNotWritable: 'BaoCut 沒有寫入這個資料夾的權限',
  dirNested: '新位置與目前的模型資料夾互相包含。請選擇既不在它裡面、也不包含它的資料夾',
  noSpaceForMove: '新位置所在的磁碟空間不足，無法容納要移動的模型',
  noSpaceRemedy: '請釋放空間、選擇其他位置，或選擇「只切換位置」',
  dirInUse: '有任務正在使用本機模型。請在它們結束或取消後再變更模型資料夾',
  sourceKept: (p) => `舊資料夾中有 ${p.count} 個存放庫無法刪除，你可以手動刪除`,
  moveNoSpace: '新位置的磁碟已滿，已回復移動前的狀態',
  moveFailed: '移動模型時發生錯誤，已回復移動前的狀態',
  moveFailedRemedy: '原本的模型資料夾沒有變更，模型仍可正常使用',

  noAlignableFormat: (p) => `模型 ${p.modelId} 不會輸出可對齊的音訊格式`,
  synthOutputCount: (p) => `語音合成產生了 ${p.count} 個輸出，應該只有 1 個`,
  synthOutputOutsideStaging: '語音合成的輸出不在暫存資料夾中',
  dubGrantHint: (p) =>
    `配音會將逐字稿（譯文，缺少譯文處則為原文）傳送給 ${p.recipient}。啟用供應商時建立的預設授權不包含逐字稿，` +
    '因此使用者必須明確發出授權（使用下方的命令，或在 BaoCut 的設定中），然後再重新執行這次配音。',
  voiceRemoved: (p) => `${p.reason}：音色 ${p.voice}`,

  notSpeakersJob: '這個任務不是說話者辨識',
  jobNotForVideo: '這次辨識不屬於這部影片',
  speakersNotDone: '說話者辨識尚未完成',
  speakersCleaned: '辨識結果已被清除。請重新辨識說話者',

  recoveryPrincipalName: '任務復原',
};
