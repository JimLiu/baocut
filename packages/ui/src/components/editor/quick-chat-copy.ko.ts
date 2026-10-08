import type { QuickChatMessages } from './quick-chat-copy.ts';

export const ko: QuickChatMessages = {
  label: '이 영상의 세션',
  open: '이 영상의 세션 열기',
  fresh: '새 세션',
  expand: '왼쪽에서 세션 펼치기',
  minimize: '최소화',
  about: (name: string) => `“${name}” 관련`,
  placeholder: '이 영상으로 무엇을 할까요? /를 입력하면 도구를 쓸 수 있습니다',
  hint: 'Agent가 여기서 바로 작업합니다',
  failed: (message: string) => `보내지 못했습니다: ${message}`,
  untitled: '영상',
  send: '보내기',
};
