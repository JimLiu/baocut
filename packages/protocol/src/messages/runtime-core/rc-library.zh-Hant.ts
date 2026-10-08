import type { RcLibraryMessages } from './rc-library.ts';

export const zhHant: RcLibraryMessages = {
  problemSeparator: '；',
  referenceUndecodable: (p) => `無法解碼參考錄音：${p.problems}`,
  clonesNotReady: '音色克隆尚未就緒',
  entryHasNoFile: '這個條目沒有檔案',
  notCopyable: (p) =>
    `${p.library === 'glossaries' ? '術語表' : p.library === 'voices' ? '音色' : '顏色'}無法直接複製到影片中：術語表在轉錄和翻譯時選用，音色在合成語音時選用，顏色在編輯樣式時選用`,
  captionItemIdsStyleOnly: 'captionItemIds 只適用於字幕樣式',
  addFromLibraryLabel: (p) => `從資料庫加入「${p.name}」`,
  duplicateGlossaries: (p) => `glossaries.${p.step} 多次列出了同一個術語表`,
  tooManyGlossaries: (p) => `每個步驟最多只能使用 ${p.max} 個術語表`,
  glossaryWrongStep: (p) =>
    `「${p.name}」是${p.transcription ? '轉錄' : '翻譯'}用的術語表，不能用於${p.transcribeStep ? '轉錄' : '翻譯'}`,
  selectionDocumentName: '使用中的資料庫條目',
  changeSelectionLabel: '變更使用中的資料庫條目',
  adoptDefaultsLabel: '使用資料庫的預設條目',
  noDocumentIdAfterWrite: '寫入後沒有取得文件 ID',
  speakerBoundTwice: (p) => `說話者 ${p.speakerId} 被指派了兩次`,
  noSuchDocument: (p) => `影片中沒有文件 ${p.documentId}`,
  documentNotSpeech: (p) => `文件 ${p.documentId} 是 ${p.kind}；只有逐字稿（speech）中才有說話者`,
  speakerNotInTranscript: (p) => `逐字稿 ${p.documentId} 中沒有說話者 ${p.speakerId}`,
  libraryVoiceNoProvider: '資料庫中的音色會換成配音所選供應商上的克隆音色：請勿傳入 providerId',
  outputNotFound: '產出不存在',
  pathNotAbsolute: '檔案路徑必須是絕對路徑',

  serviceClientNoLibraryVoice: '外部服務的用戶端無法使用資料庫中的音色',
  clonerNotConfigured: (p) => `${p.label} 未啟用或沒有金鑰，無法克隆音色`,
  cloneExists: (p) => `音色「${p.name}」在 ${p.label} 上已有有效的克隆`,
  clonePurpose: (p) => `克隆音色「${p.name}」`,
  noClone: '這個音色在這個供應商上沒有克隆',
  remoteCloneNotDeleted: (p) => `${p.label} 上的克隆未刪除，因此保留了記錄：${p.reason}`,
  cloneUnsupported: (p) => `${p.providerId} 沒有音色克隆 API（目前只有 ElevenLabs 提供）`,
  cloneVersionGone: '要克隆的音色版本已不存在',
  oldCloneNotDeleted: (p) => `被取代的舊克隆（${p.voiceId}）未從 ${p.label} 刪除：${p.reason}`,
};
