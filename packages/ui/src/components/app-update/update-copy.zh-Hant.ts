import type { UpdateMessages, UpdateStep } from './update-copy.ts';

const STEP: Record<UpdateStep, string> = {
  install: '開始安裝',
  check: '檢查更新',
  download: '開始下載',
  cancel: '取消下載',
  retry: '重試',
  downloadPage: '開啟下載頁面',
};

export const zhHant: UpdateMessages = {
  failed: (step, message) => `無法${STEP[step]}：${message}`,
  progress: '下載進度',
  notes: '這個版本的新功能',
  close: '關閉',
};
