import type { ModelsLocalImageMessages } from './local-image.ts';

export const vi: ModelsLocalImageMessages = {
  slowCpu: (p: { steps: number }) => `Tạo trên CPU của máy tính này với ${p.steps} bước: hình 1024² mất vài giờ, ngay cả 512² cũng mất khoảng một giờ; nhanh hơn nhiều với GPU NVIDIA (CUDA)`,
  slowLocal: (p: { steps: number }) => `Tạo trên máy tính này với ${p.steps} bước: mỗi hình mất vài phút đến hơn mười phút`,
};
