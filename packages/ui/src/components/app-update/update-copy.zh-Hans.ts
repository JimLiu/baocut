import type { UpdateMessages, UpdateStep } from './update-copy.ts';

const STEP: Record<UpdateStep, string> = {
  install: '开始安装',
  check: '检查更新',
  download: '开始下载',
  cancel: '取消下载',
  retry: '重试',
  downloadPage: '打开下载页',
};

export const zhHans: UpdateMessages = {
  failed: (step, message) => `没能${STEP[step]}：${message}`,
  progress: '下载进度',
  notes: '这一版的更新说明',
  close: '关闭',
};
