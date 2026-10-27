import type { JobsUpscaleImageMessages } from './upscale-image.ts';

export const ptBR: JobsUpscaleImageMessages = {
  label: 'Ampliar imagem',
  description: 'Amplia imagens de 2 a 4× com o Real-ESRGAN neste computador: de arquivo para arquivo, a saída é PNG e não sobrescreve arquivos existentes.',
  stepProbe: 'Ler imagens',
  stepUpscale: 'Ampliar',
  stepVerify: 'Verificar a saída',
  stepPublish: 'Publicar',
  inputNotFound: (p: { file: string }) => `Não foi possível encontrar a imagem de entrada ${p.file}`,
  inputUnsupported: (p: { name: string }) => `${p.name} não é uma imagem PNG, JPEG ou WebP legível`,
  outputTooLarge: (p: { name: string; width: number; height: number; max: number }) => `${p.name} ficaria com ${p.width}×${p.height}; cada lado pode ter no máximo ${p.max} pixels. Escolha uma escala menor.`,
  upscaleFailed: (p: { name: string; detail: string }) => `O Real-ESRGAN não conseguiu ampliar ${p.name}: ${p.detail}`,
  outputMissing: (p: { name: string }) => `Nenhuma saída foi gravada para ${p.name}`,
  outputSizeMismatch: (p: { name: string; actual: string; expected: string }) => `A saída de ${p.name} é ${p.actual}; o esperado era ${p.expected}`,
  exifOrientation: (p: { name: string }) => `${p.name} tem uma marca de orientação EXIF; a saída é ampliada pixel a pixel e não é endireitada`,
  toolNotFound: (p: { code: string }) => `Não foi possível iniciar o Real-ESRGAN (${p.code})`,
};
