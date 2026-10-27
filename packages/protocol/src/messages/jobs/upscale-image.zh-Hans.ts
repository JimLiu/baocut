import type { JobsUpscaleImageMessages } from './upscale-image.ts';

export const zhHans: JobsUpscaleImageMessages = {
  label: '图片超分',
  description: '用本机的 Real-ESRGAN 把图片放大 2–4 倍：文件到文件，输出 PNG，不覆盖已有的文件。',
  stepProbe: '读取图片',
  stepUpscale: '放大',
  stepVerify: '校验输出',
  stepPublish: '发布',
  inputNotFound: (p: { file: string }) => `找不到输入图片 ${p.file}`,
  inputUnsupported: (p: { name: string }) => `${p.name} 不是读得出的 PNG、JPEG 或 WebP 图片`,
  outputTooLarge: (p: { name: string; width: number; height: number; max: number }) => `${p.name} 放大后是 ${p.width}×${p.height}，每边至多 ${p.max} 像素。请选小一点的倍数。`,
  upscaleFailed: (p: { name: string; detail: string }) => `Real-ESRGAN 没能放大 ${p.name}：${p.detail}`,
  outputMissing: (p: { name: string }) => `${p.name} 没有写出输出`,
  outputSizeMismatch: (p: { name: string; actual: string; expected: string }) => `${p.name} 的输出是 ${p.actual}，应为 ${p.expected}`,
  exifOrientation: (p: { name: string }) => `${p.name} 带 EXIF 方向标记；输出按像素原样放大，没有转正`,
  toolNotFound: (p: { code: string }) => `启动不了 Real-ESRGAN（${p.code}）`,
};
