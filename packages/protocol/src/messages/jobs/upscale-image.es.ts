import type { JobsUpscaleImageMessages } from './upscale-image.ts';

export const es: JobsUpscaleImageMessages = {
  label: 'Ampliar imagen',
  description: 'Amplía imágenes 2–4× con Real-ESRGAN en este ordenador: de archivo a archivo, la salida es PNG y no sobrescribe archivos existentes.',
  stepProbe: 'Leer imágenes',
  stepUpscale: 'Ampliar',
  stepVerify: 'Verificar la salida',
  stepPublish: 'Publicar',
  inputNotFound: (p: { file: string }) => `No se encuentra la imagen de entrada ${p.file}`,
  inputUnsupported: (p: { name: string }) => `${p.name} no es una imagen PNG, JPEG o WebP legible`,
  outputTooLarge: (p: { name: string; width: number; height: number; max: number }) => `${p.name} quedaría en ${p.width}×${p.height}; cada lado puede tener como máximo ${p.max} píxeles. Elige una escala menor.`,
  upscaleFailed: (p: { name: string; detail: string }) => `Real-ESRGAN no pudo ampliar ${p.name}: ${p.detail}`,
  outputMissing: (p: { name: string }) => `No se escribió ninguna salida para ${p.name}`,
  outputSizeMismatch: (p: { name: string; actual: string; expected: string }) => `La salida de ${p.name} es ${p.actual}; se esperaba ${p.expected}`,
  exifOrientation: (p: { name: string }) => `${p.name} tiene una etiqueta de orientación EXIF; la salida se amplía píxel a píxel y no se endereza`,
  toolNotFound: (p: { code: string }) => `No se puede iniciar Real-ESRGAN (${p.code})`,
};
