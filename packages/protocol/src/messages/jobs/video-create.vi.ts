import type { JobsVideoCreateMessages } from './video-create.ts';

export const vi: JobsVideoCreateMessages = {
  videoClosed: 'Video đã đóng nên chưa nhập gì: mở video rồi thử lại',
  noAsset: 'Thao tác nhập không trả về tư liệu',
  notCompleted: (p: { state: string }) => `Chép lời chưa hoàn tất (${p.state})`,
};
