import type { HarnessRunsMessages } from './harness-runs.ts';

export const zhHans: HarnessRunsMessages = {
  retrying: (p) => `${p.message}（正在重试）`,
  modeChanged: (p) => `访问模式切换为「${p.to}」（之前是「${p.from}」），对之后的动作生效。`,
  jobsCancelled: (p) => `已请求取消这个会话还没结束的 ${p.count} 个后台任务；已经完成的结果保留。`,
  jobsCancelledGenerated: (p) => `已请求取消这个会话还没结束的 ${p.count} 个后台任务（生成或转写）；已经完成的结果保留。`,
  goalChangedStopped: '目标已改变：旧任务已停止，按新目标建立新任务。',
  goalChangedKept: '目标已改变：旧任务的回合已停下，已经提交的后台任务照常完成，产物留作候选；按新目标建立新任务。',
  stopReplyUnconfirmed: (p) => `已请求停止回复，但无法确认 ${p.agent} 是否已经停下。`,
  stopUnconfirmed: (p) => `已请求停止，但无法确认 ${p.agent} 是否已经停下。`,
  stopTimedOut: (p) => `${p.agent} 没有在 10 秒内确认停止，已结束它的进程。未确认取消的步骤可能已经产生了效果。`,
  agentRemovedNotice: (p) => `智能体 ${p.agent} 已被移除，这个任务没有完成。已经发生的修改不会自动撤销。`,
  agentRemoved: (p) => `智能体 ${p.agent} 已被移除`,
  runtimeStoppedNotice: 'Runtime 停止时任务还没结束，已中断。',
  runtimeExitedNotice: 'Runtime 在任务运行中退出，这个任务没有完成。已经发生的修改不会自动撤销。',
  runtimeExited: 'Runtime 在任务运行中退出',
  turnFailed: '回合失败',
  processExited: (p) => `${p.agent} 进程意外结束：${p.error}`,
  noErrorMessage: '没有错误信息',
  fileChangeSummary: '修改文件',
};
