import type { JobsLibraryMessages } from './job-library.ts';

export const zhHant: JobsLibraryMessages = {
  serviceNoGlossaries: '對外服務的用戶端無法使用使用者資料庫中的術語表',
  serviceNoVoices: '對外服務的用戶端無法使用使用者資料庫中的音色',
  noLibraryForGlossaries: '這個 Runtime 沒有使用者資料庫，無法使用術語表',
  noLibraryForVoices: '這個 Runtime 沒有使用者資料庫，無法使用資料庫中的音色',
  translationGlossary: (p: { name: string }) => `「${p.name}」是翻譯用術語表，不能用於轉錄`,
};
