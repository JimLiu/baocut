import type { ThreadMessages } from './thread-copy.ts';

export const zhHant: ThreadMessages = {
  videoTools: {
    videos_list: '列出影片',
    videos_create: '新增影片',
    videos_inspect: '讀取影片',
    edits_apply: '修改影片',
    edits_undo: '還原修改',
  },
  toolTitle: (action: string, label: string) => `${action}：${label}`,
  steps: { command: '執行指令', read: '讀取檔案', edit: '修改檔案', search: '搜尋', other: '其他工具' },
  phrase: {
    command: '執行了指令',
    read: (count: number) => `讀取了 ${count} 個檔案`,
    edit: (count: number) => `修改了 ${count} 個檔案`,
    search: '搜尋了',
    video: (count: number) => `提交了 ${count} 筆影片修改`,
    tool: '呼叫了工具',
  },
  summary: (phrases: readonly string[]) => phrases.join('、'),
  thinking: '思考',
  stepsFallback: '步驟',
};
