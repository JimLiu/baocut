import type { VideoInfoMessages } from './video-info-copy.ts';

export const vi: VideoInfoMessages = {
  section: { media: 'Nguồn và tư liệu', source: 'Thông tin nguồn' },
  speakers: (count: number) => `${count} người nói`,
  chapters: (count: number) => `${count} chương`,
  paragraphs: (count: number) => `${count} đoạn`,
  list: (names: readonly string[]) => names.join(', '),
  sourceKind: {
    'link-import': 'Nhập từ URL',
    'user-import': 'Tệp cục bộ',
    generated: 'Đã tạo',
    library: 'Thư viện người dùng',
  },
  row: {
    contents: 'Nội dung',
    translation: 'Bản dịch',
    location: 'Vị trí',
    media: 'Tư liệu',
    transcript: 'Chép lời',
    channel: 'Kênh',
    published: 'Xuất bản',
    platform: 'Nền tảng',
    mediaId: 'ID video',
    url: 'URL',
  },
};
