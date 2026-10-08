import type { ModelsDownloadSourceMessages } from './download-source.ts';

export const vi: ModelsDownloadSourceMessages = {
  invalidEndpoint: (p: { name: string }) => `${p.name} phải là URL gốc bắt đầu bằng http(s)://, không có thông tin xác thực, tham số truy vấn hoặc đoạn`,
};
