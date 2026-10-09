import type { ThreadMessages } from './thread-copy.ts';

export const zhHans: ThreadMessages = {
  withDetail: (text, detail) => `${text}（${detail}）`,
  copy: '复制',
  copied: '已复制',
  copyFailed: '复制失败，请重试',
  copyCode: '复制代码',
  copyReply: '复制这一轮的回复',
  change: {
    added: (n) => `新增 ${n}`,
    updated: (n) => `修改 ${n}`,
    deleted: (n) => `删除 ${n}`,
    duration: (clock) => `时长 ${clock}`,
    durationChange: (before, after) => `时长 ${before} → ${after}`,
    revision: (before, after) => `版本 ${before} → ${after}`,
    locked: '视频暂时不能修改',
    undoStep: (videoName, label) => `撤销了一步「${videoName}」：${label}`,
    changed: (videoName, label) => `修改了「${videoName}」：${label}`,
    aria: (label) => `视频修改：${label}`,
  },
  message: {
    contextTitle: '发送时附带的编辑器状态',
    context: (videoName, revision, playhead, selected) =>
      `「${videoName}」 · 版本 ${revision} · 播放头 ${playhead}${selected ? ` · 选中 ${selected} 个片段` : ''}`,
  },
  output: {
    aria: (name, detail) => `${name}，${detail}`,
  },
  steps: {
    more: (n) => `等 ${n} 项`,
    failed: (n) => `${n} 项失败`,
    thinking: '思考',
    viewFile: (name) => `查看 ${name}`,
    input: '输入',
    error: '错误',
    output: '输出',
    waiting: '等待输出',
    noOutput: '没有输出',
  },
};
