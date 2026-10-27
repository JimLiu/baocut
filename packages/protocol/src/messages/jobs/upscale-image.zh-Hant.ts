import type { JobsUpscaleImageMessages } from './upscale-image.ts';

export const zhHant: JobsUpscaleImageMessages = {
  label: '圖片超解析',
  description: '用本機的 Real-ESRGAN 把圖片放大 2–4 倍：檔案到檔案，輸出 PNG，不覆寫已有的檔案。',
  stepProbe: '讀取圖片',
  stepUpscale: '放大',
  stepVerify: '校驗輸出',
  stepPublish: '發佈',
  inputNotFound: (p: { file: string }) => `找不到輸入圖片 ${p.file}`,
  inputUnsupported: (p: { name: string }) => `${p.name} 不是讀得出的 PNG、JPEG 或 WebP 圖片`,
  outputTooLarge: (p: { name: string; width: number; height: number; max: number }) => `${p.name} 放大後是 ${p.width}×${p.height}，每邊至多 ${p.max} 像素。請選小一點的倍數。`,
  upscaleFailed: (p: { name: string; detail: string }) => `Real-ESRGAN 沒能放大 ${p.name}：${p.detail}`,
  outputMissing: (p: { name: string }) => `${p.name} 沒有寫出輸出`,
  outputSizeMismatch: (p: { name: string; actual: string; expected: string }) => `${p.name} 的輸出是 ${p.actual}，應為 ${p.expected}`,
  exifOrientation: (p: { name: string }) => `${p.name} 帶 EXIF 方向標記；輸出按像素原樣放大，沒有轉正`,
  toolNotFound: (p: { code: string }) => `啟動不了 Real-ESRGAN（${p.code}）`,
};
