import type { JobsDownloadTranscriptMessages } from './download-transcript.ts';

export const vi: JobsDownloadTranscriptMessages = {
  fileTranscribeUnavailable: 'Chép lời tệp không khả dụng',
  notCompleted: 'Chép lời chưa hoàn tất; đã giữ tệp video',
  resultMissing: 'Không tìm thấy kết quả chép lời',
  tooManySameName: (p: { name: string }) => `Có quá nhiều tệp trùng tên trong thư mục đầu ra: ${p.name}`,
};
