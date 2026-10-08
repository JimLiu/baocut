import type { JobsSaveLocationMessages } from './save-location.ts';

export const ja: JobsSaveLocationMessages = {
  notDirectory: 'フォルダではありません',
  unwritable: (p: { dir: string; problem: string }) => `保存場所に書き込めません：${p.dir}（${p.problem}）`,
};
