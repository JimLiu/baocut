import type { ThreadMessages } from './thread-copy.ts';

export const zhHant: ThreadMessages = {
  withDetail: (text, detail) => `${text}（${detail}）`,
  copy: '複製',
  copied: '已複製',
  copyFailed: '無法複製，請重試',
  copyCode: '複製程式碼',
  copyReply: '複製這則回覆',
  change: {
    added: (n) => `新增 ${n}`,
    updated: (n) => `修改 ${n}`,
    deleted: (n) => `刪除 ${n}`,
    duration: (clock) => `長度 ${clock}`,
    durationChange: (before, after) => `長度 ${before} → ${after}`,
    revision: (before, after) => `版本 ${before} → ${after}`,
    locked: '影片目前無法修改',
    undoStep: (videoName, label) => `已還原「${videoName}」中的一個步驟：${label}`,
    changed: (videoName, label) => `已修改「${videoName}」：${label}`,
    aria: (label) => `影片修改：${label}`,
  },
  message: {
    contextTitle: '隨訊息傳送的編輯器狀態',
    context: (videoName, revision, playhead, selected) =>
      `「${videoName}」 · 版本 ${revision} · 播放頭 ${playhead}${selected ? ` · 已選取 ${selected} 個片段` : ''}`,
  },
  output: {
    aria: (name, detail) => `${name}，${detail}`,
  },
  steps: {
    more: (n) => `等 ${n} 項`,
    failed: (n) => `${n} 項失敗`,
    thinking: '思考',
    viewFile: (name) => `檢視 ${name}`,
    input: '輸入',
    error: '錯誤',
    output: '輸出',
    waiting: '等待輸出',
    noOutput: '沒有輸出',
  },
};
