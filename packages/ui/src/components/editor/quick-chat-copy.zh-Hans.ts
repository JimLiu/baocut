import type { QuickChatMessages } from './quick-chat-copy.ts';

export const zhHans: QuickChatMessages = {
  label: '这个视频的会话',
  open: '打开这个视频的会话',
  fresh: '新会话',
  expand: '在左侧展开会话',
  minimize: '最小化',
  about: (name: string) => `关于「${name}」`,
  placeholder: '想对这个视频做些什么？输入 / 使用工具',
  hint: 'Agent 在这里直接动手',
  failed: (message: string) => `没能发送：${message}`,
  untitled: '视频',
  send: '发送',
};
