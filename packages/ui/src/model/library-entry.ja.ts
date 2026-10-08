import type { LibraryEntryMessages } from './library-entry.ts';

export const ja: LibraryEntryMessages = {
  versionConflict: 'この項目は直前にほかの場所で変更されたため、今回の編集は保存されませんでした。最新の内容を読み込み直しました。もう一度変更してください。',
  failed: (action: string, message: string) => `${action}できませんでした：${message}`,
};
