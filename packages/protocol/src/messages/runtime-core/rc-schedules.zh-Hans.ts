import type { RcSchedulesMessages } from './rc-schedules.ts';

export const zhHans: RcSchedulesMessages = {
  notFound: (p) => `找不到定时任务：${p.id}`,
  conversationNotFound: (p) => `找不到会话：${p.id}`,
  conversationArchived: '这条会话已归档。先从「已归档会话」里恢复，再给它建定时任务。',
  noProject: '这条会话不在项目里，不能每次在项目里新开一条会话。',
  invalid: '定时任务的设置不对：检查每次发的话、频率与最多运行次数。',
  notActive: '只有启用中的定时任务能立即运行。',
  resumeArchived: '目标会话已归档。把它从「已归档会话」里恢复，或编辑定时任务改成每次新开一条会话。',
  resumeDeleted: '目标会话已删除。编辑定时任务改成每次新开一条会话。',
  resumeProjectRemoved: '这个项目已从 BaoCut 移除，不能在里面新开会话。',
  resumeCompleted: '已经跑满最多运行次数。先把次数改大，再继续。',
  runStopped: '没跑完就停下了',
};
