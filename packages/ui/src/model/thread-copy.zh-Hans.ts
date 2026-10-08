import type { ThreadMessages } from './thread-copy.ts';

export const zhHans: ThreadMessages = {
  videoTools: {
    videos_list: '列出视频',
    videos_create: '新建视频',
    videos_inspect: '读取视频',
    edits_apply: '修改视频',
    edits_undo: '撤销修改',
  },
  toolTitle: (action: string, label: string) => `${action}：${label}`,
  steps: { command: '运行命令', read: '读取文件', edit: '修改文件', search: '搜索', other: '其他工具' },
  phrase: {
    command: '运行了命令',
    read: (count: number) => `读取了 ${count} 个文件`,
    edit: (count: number) => `修改了 ${count} 个文件`,
    search: '搜索了',
    video: (count: number) => `提交了 ${count} 笔视频修改`,
    tool: '调用了工具',
  },
  summary: (phrases: readonly string[]) => phrases.join('、'),
  thinking: '思考',
  stepsFallback: '执行步骤',
};
