import type { UpdateMessages, UpdateStep } from './update-copy.ts';

const STEP: Record<UpdateStep, string> = {
  install: 'インストールを開始',
  check: '更新を確認',
  download: 'ダウンロードを開始',
  cancel: 'ダウンロードをキャンセル',
  retry: '再試行',
  downloadPage: 'ダウンロードページを表示',
};

export const ja: UpdateMessages = {
  failed: (step, message) => `${STEP[step]}できませんでした：${message}`,
  progress: 'ダウンロードの進行状況',
  notes: 'このバージョンの新機能',
  close: '閉じる',
};
