import type { JobsSaveLocationMessages } from './save-location.ts';

export const vi: JobsSaveLocationMessages = {
  notDirectory: 'Không phải thư mục',
  unwritable: (p: { dir: string; problem: string }) => `Không thể ghi vào vị trí lưu: ${p.dir} (${p.problem})`,
};
