import type { JobsApplicationMessages } from './job-application.ts';

export const ja: JobsApplicationMessages = {
  applyFailed: '動画に書き込めませんでした',
  taskProtected: '結果がタスク契約で「変更しない」とされている内容に関わるため、動画には書き込みませんでした',
  applicationCancelled: 'タスクが停止したため、結果は自動で適用されませんでした。生成物は候補として残してあります。',
};
