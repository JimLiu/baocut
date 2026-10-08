import type { LibraryEntryMessages } from './library-entry.ts';

export const zhHans: LibraryEntryMessages = {
  versionConflict: '这一条刚在别处改过，没有保存你这次的修改。已重新读取最新内容，请再改一次。',
  failed: (action: string, message: string) => `没能${action}：${message}`,
};
