import type { VoicesLibraryMessages } from './voices-library-copy.ts';

export const zhHans: VoicesLibraryMessages = {
  consentStatement: '这是我自己的声音，或已获本人许可',
  uploading: (label) => `正在上传到 ${label}…`,
  noConsent: '没有说明是本人的声音或已获许可，不上传到第三方。先在「编辑」里勾上声明。',
  cannotClone: (label) => `这个 Runtime 不能在 ${label} 上克隆`,
  providerOff: (label, detail) => `${label} 现在不能用${detail ? `（${detail}）` : ''}：先到「云端模型」里启用并设置密钥`,
  consentUnstated: '未说明是否本人',
  cloned: (label) => `${label} 已克隆`,
  cloneStale: (label) => `${label} 克隆已过期`,
  languageUnknown: '语言未注明',
  recorded: '在应用里录的',
  imported: '从文件导入',
  edited: (ago) => `${ago}改过`,
  nameRequired: '给音色起个名字',
  nameTooLong: (max) => `名字最多 ${max} 个字`,
  transcriptTooLong: (max) => `逐字稿最多 ${max} 个字`,
  dontKnow: '不知道',
  deleteClones: (labels) => `会先删掉 ${labels.join('、')} 上的克隆，删不掉时不删音色。`,
  deleteBody: (clones) => `用了它的视频下次生成时会退回默认音色；已经生成的配音不受影响。${clones}`,
  uploadNotice: (name, size, label) =>
    `要把「${name}」的参考录音${size ? `（${size}）` : ''}上传到 ${label} 建克隆。之后在 ${label} 上用这只音色时直接用对方的 voice id；删音色时会先删掉这个克隆。`,
  withRemedy: (message, remedy) => `${message}。${remedy}`,
  remedyConsent: '没有本人声明的音色不会上传到第三方：先在「编辑」里勾上声明。',
  remedyConfigure: '到「云端模型」里启用这家服务商并设置密钥。',
  remedyConflict: '这只音色刚在别处改过，下面已经换成最新的内容，看一眼再保存。',
  remedyGrant: '把参考录音交给服务商要先有外发授权：在设置里发放授权之后再试。',
};
