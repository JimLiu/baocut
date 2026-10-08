import type { LibraryEntryMessages } from './library-entry.ts';

export const zhHant: LibraryEntryMessages = {
  versionConflict: '這個項目剛在其他地方被修改，因此未儲存你的編輯。已重新載入最新版本，請再修改一次。',
  failed: (action: string, message: string) => `無法${action}：${message}`,
};
