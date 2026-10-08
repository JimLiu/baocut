import type { QuickChatMessages } from './quick-chat-copy.ts';

export const zhHant: QuickChatMessages = {
  label: '這部影片的對話',
  open: '開啟這部影片的對話',
  fresh: '新對話',
  expand: '在左側展開對話',
  minimize: '最小化',
  about: (name: string) => `關於「${name}」`,
  placeholder: '想對這部影片做什麼？輸入 / 使用工具',
  hint: 'Agent 會直接在這裡處理',
  failed: (message: string) => `無法傳送：${message}`,
  untitled: '影片',
  send: '傳送',
};
