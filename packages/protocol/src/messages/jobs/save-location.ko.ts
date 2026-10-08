import type { JobsSaveLocationMessages } from './save-location.ts';

export const ko: JobsSaveLocationMessages = {
  notDirectory: '폴더가 아닙니다',
  unwritable: (p: { dir: string; problem: string }) => `저장 위치에 쓸 수 없습니다: ${p.dir}(${p.problem})`,
};
