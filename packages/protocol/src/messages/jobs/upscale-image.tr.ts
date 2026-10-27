import type { JobsUpscaleImageMessages } from './upscale-image.ts';

export const tr: JobsUpscaleImageMessages = {
  label: 'Görüntü büyütme',
  description: 'Bu bilgisayardaki Real-ESRGAN ile görüntüleri 2–4 kat büyütür: dosyadan dosyaya, çıktı PNG olur ve mevcut dosyaların üzerine yazılmaz.',
  stepProbe: 'Görüntüleri oku',
  stepUpscale: 'Büyüt',
  stepVerify: 'Çıktıyı doğrula',
  stepPublish: 'Yayınla',
  inputNotFound: (p: { file: string }) => `Girdi görüntüsü ${p.file} bulunamadı`,
  inputUnsupported: (p: { name: string }) => `${p.name} okunabilir bir PNG, JPEG veya WebP görüntüsü değil`,
  outputTooLarge: (p: { name: string; width: number; height: number; max: number }) => `${p.name} büyütüldüğünde ${p.width}×${p.height} olur; her kenar en fazla ${p.max} piksel olabilir. Daha küçük bir ölçek seçin.`,
  upscaleFailed: (p: { name: string; detail: string }) => `Real-ESRGAN ${p.name} görüntüsünü büyütemedi: ${p.detail}`,
  outputMissing: (p: { name: string }) => `${p.name} için çıktı yazılmadı`,
  outputSizeMismatch: (p: { name: string; actual: string; expected: string }) => `${p.name} çıktısı ${p.actual}; beklenen ${p.expected}`,
  exifOrientation: (p: { name: string }) => `${p.name} bir EXIF yön etiketi içeriyor; çıktı piksel piksel büyütülür ve döndürülmez`,
  toolNotFound: (p: { code: string }) => `Real-ESRGAN başlatılamıyor (${p.code})`,
};
