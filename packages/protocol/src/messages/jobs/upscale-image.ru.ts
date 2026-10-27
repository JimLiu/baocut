import type { JobsUpscaleImageMessages } from './upscale-image.ts';

export const ru: JobsUpscaleImageMessages = {
  label: 'Увеличение изображения',
  description: 'Увеличивает изображения в 2–4 раза с Real-ESRGAN на этом компьютере: из файла в файл, результат в PNG, существующие файлы не перезаписываются.',
  stepProbe: 'Чтение изображений',
  stepUpscale: 'Увеличение',
  stepVerify: 'Проверка результата',
  stepPublish: 'Публикация',
  inputNotFound: (p: { file: string }) => `Не удаётся найти входное изображение ${p.file}`,
  inputUnsupported: (p: { name: string }) => `${p.name} — не читаемое изображение PNG, JPEG или WebP`,
  outputTooLarge: (p: { name: string; width: number; height: number; max: number }) => `${p.name} получится ${p.width}×${p.height}; каждая сторона может быть не больше ${p.max} пикселей. Выберите меньший масштаб.`,
  upscaleFailed: (p: { name: string; detail: string }) => `Real-ESRGAN не смог увеличить ${p.name}: ${p.detail}`,
  outputMissing: (p: { name: string }) => `Для ${p.name} результат не записан`,
  outputSizeMismatch: (p: { name: string; actual: string; expected: string }) => `Результат для ${p.name} — ${p.actual}; ожидалось ${p.expected}`,
  exifOrientation: (p: { name: string }) => `У ${p.name} есть тег ориентации EXIF; результат увеличен попиксельно и не повёрнут`,
  toolNotFound: (p: { code: string }) => `Не удаётся запустить Real-ESRGAN (${p.code})`,
};
