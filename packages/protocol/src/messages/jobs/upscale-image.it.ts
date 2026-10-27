import type { JobsUpscaleImageMessages } from './upscale-image.ts';

export const it: JobsUpscaleImageMessages = {
  label: 'Ingrandisci immagine',
  description: 'Ingrandisce le immagini da 2 a 4× con Real-ESRGAN su questo computer: da file a file, l’output è PNG e non sovrascrive i file esistenti.',
  stepProbe: 'Leggi immagini',
  stepUpscale: 'Ingrandisci',
  stepVerify: 'Verifica output',
  stepPublish: 'Pubblica',
  inputNotFound: (p: { file: string }) => `Immagine di input ${p.file} non trovata`,
  inputUnsupported: (p: { name: string }) => `${p.name} non è un’immagine PNG, JPEG o WebP leggibile`,
  outputTooLarge: (p: { name: string; width: number; height: number; max: number }) => `${p.name} diventerebbe ${p.width}×${p.height}; ogni lato può avere al massimo ${p.max} pixel. Scegli un fattore più piccolo.`,
  upscaleFailed: (p: { name: string; detail: string }) => `Real-ESRGAN non è riuscito a ingrandire ${p.name}: ${p.detail}`,
  outputMissing: (p: { name: string }) => `Nessun output scritto per ${p.name}`,
  outputSizeMismatch: (p: { name: string; actual: string; expected: string }) => `L’output di ${p.name} è ${p.actual}; previsto ${p.expected}`,
  exifOrientation: (p: { name: string }) => `${p.name} ha un tag di orientamento EXIF; l’output è ingrandito pixel per pixel e non viene raddrizzato`,
  toolNotFound: (p: { code: string }) => `Impossibile avviare Real-ESRGAN (${p.code})`,
};
