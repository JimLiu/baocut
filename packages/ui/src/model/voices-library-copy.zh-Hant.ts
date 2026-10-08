import type { VoicesLibraryMessages } from './voices-library-copy.ts';

export const zhHant: VoicesLibraryMessages = {
  consentStatement: '這是我本人的聲音，或已獲得說話者本人許可',
  uploading: (label) => `正在上傳到 ${label}…`,
  noConsent: '未聲明是本人的聲音或已獲許可，因此不會上傳到第三方。請先在「編輯」中勾選聲明。',
  cannotClone: (label) => `這個 Runtime 無法在 ${label} 上克隆`,
  providerOff: (label, detail) => `目前無法使用 ${label}${detail ? `（${detail}）` : ''}：請先在「雲端模型」中啟用並設定金鑰`,
  consentUnstated: '未聲明是否為本人',
  cloned: (label) => `已在 ${label} 上克隆`,
  cloneStale: (label) => `${label} 上的克隆已過期`,
  languageUnknown: '未註明語言',
  recorded: '在應用程式中錄製',
  imported: '從檔案匯入',
  edited: (ago) => `${ago}編輯過`,
  nameRequired: '請為音色命名',
  nameTooLong: (max) => `名稱最多 ${max} 個字`,
  transcriptTooLong: (max) => `逐字稿最多 ${max} 個字`,
  dontKnow: '不確定',
  deleteClones: (labels) => `會先刪除在 ${labels.join('、')} 上的克隆；若刪除失敗，則保留音色。`,
  deleteBody: (clones) => `使用它的影片下次生成時會改用預設音色；已生成的配音不受影響。${clones}`,
  uploadNotice: (name, size, label) =>
    `「${name}」的參考錄音${size ? `（${size}）` : ''}將上傳到 ${label} 以建立克隆。之後在 ${label} 上使用這個音色時，會直接使用對方的 voice ID；刪除音色時會先刪除這個克隆。`,
  withRemedy: (message, remedy) => `${message.replace(/[。.]$/, '')}。${remedy}`,
  remedyConsent: '沒有本人聲明的音色不會上傳到第三方：請先在「編輯」中勾選聲明。',
  remedyConfigure: '請到「雲端模型」中啟用這家供應商並設定金鑰。',
  remedyConflict: '這個音色剛在其他地方被修改過，下方已換成最新的內容，請確認後再儲存。',
  remedyGrant: '將參考錄音傳送給供應商需要外發授權：請在設定中核發授權後再試一次。',
};
