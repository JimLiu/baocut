import type { LibraryEntryMessages } from './library-entry.ts';

export const ko: LibraryEntryMessages = {
  versionConflict: '이 항목이 방금 다른 곳에서 변경되어 수정 내용을 저장하지 못했습니다. 최신 버전을 다시 불러왔으니 다시 수정하세요.',
  failed: (action: string, message: string) => `${action}에 실패했습니다: ${message}`,
};
