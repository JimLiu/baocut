import type { JobsSaveLocationMessages } from './save-location.ts';

export const zhHant: JobsSaveLocationMessages = {
  notDirectory: '不是資料夾',
  unwritable: (p: { dir: string; problem: string }) => `無法寫入儲存位置：${p.dir}（${p.problem}）`,
};
