import type { JobsUpscaleImageMessages } from './upscale-image.ts';

export const vi: JobsUpscaleImageMessages = {
  label: 'Phóng to ảnh',
  description: 'Phóng to ảnh 2–4 lần bằng Real-ESRGAN trên máy này: từ tệp sang tệp, đầu ra là PNG và không ghi đè tệp có sẵn.',
  stepProbe: 'Đọc ảnh',
  stepUpscale: 'Phóng to',
  stepVerify: 'Kiểm tra đầu ra',
  stepPublish: 'Xuất bản',
  inputNotFound: (p: { file: string }) => `Không tìm thấy ảnh đầu vào ${p.file}`,
  inputUnsupported: (p: { name: string }) => `${p.name} không phải ảnh PNG, JPEG hoặc WebP đọc được`,
  outputTooLarge: (p: { name: string; width: number; height: number; max: number }) => `${p.name} sau khi phóng to sẽ là ${p.width}×${p.height}; mỗi cạnh tối đa ${p.max} điểm ảnh. Hãy chọn tỉ lệ nhỏ hơn.`,
  upscaleFailed: (p: { name: string; detail: string }) => `Real-ESRGAN không phóng to được ${p.name}: ${p.detail}`,
  outputMissing: (p: { name: string }) => `Không có đầu ra nào được ghi cho ${p.name}`,
  outputSizeMismatch: (p: { name: string; actual: string; expected: string }) => `Đầu ra của ${p.name} là ${p.actual}; dự kiến ${p.expected}`,
  exifOrientation: (p: { name: string }) => `${p.name} có thẻ hướng EXIF; đầu ra được phóng to theo đúng điểm ảnh và không được xoay thẳng`,
  toolNotFound: (p: { code: string }) => `Không khởi động được Real-ESRGAN (${p.code})`,
};
