import type { JobsSaveLocationMessages } from './save-location.ts';

export const zhHans: JobsSaveLocationMessages = {
  notDirectory: '不是目录',
  unwritable: (p: { dir: string; problem: string }) => `保存位置不能写入：${p.dir}（${p.problem}）`,
};
