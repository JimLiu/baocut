import type { QuickChatMessages } from './quick-chat-copy.ts';

export const ja: QuickChatMessages = {
  label: 'この動画のセッション',
  open: 'この動画のセッションを開く',
  fresh: '新しいセッション',
  expand: '左側でセッションを展開',
  minimize: '最小化',
  about: (name: string) => `「${name}」について`,
  placeholder: 'この動画で何をしますか？/ を入力するとツールを使えます',
  hint: 'Agent がこの場で作業します',
  failed: (message: string) => `送信できませんでした：${message}`,
  untitled: '動画',
  send: '送信',
};
