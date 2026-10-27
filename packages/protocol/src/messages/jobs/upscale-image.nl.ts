import type { JobsUpscaleImageMessages } from './upscale-image.ts';

export const nl: JobsUpscaleImageMessages = {
  label: 'Afbeelding opschalen',
  description: 'Vergroot afbeeldingen 2–4× met Real-ESRGAN op deze computer: bestand naar bestand, uitvoer is PNG en bestaande bestanden worden niet overschreven.',
  stepProbe: 'Afbeeldingen lezen',
  stepUpscale: 'Opschalen',
  stepVerify: 'Uitvoer controleren',
  stepPublish: 'Publiceren',
  inputNotFound: (p: { file: string }) => `Invoerafbeelding ${p.file} niet gevonden`,
  inputUnsupported: (p: { name: string }) => `${p.name} is geen leesbare PNG-, JPEG- of WebP-afbeelding`,
  outputTooLarge: (p: { name: string; width: number; height: number; max: number }) => `${p.name} zou ${p.width}×${p.height} worden; elke zijde mag hoogstens ${p.max} pixels zijn. Kies een kleinere schaal.`,
  upscaleFailed: (p: { name: string; detail: string }) => `Real-ESRGAN kon ${p.name} niet opschalen: ${p.detail}`,
  outputMissing: (p: { name: string }) => `Er is geen uitvoer geschreven voor ${p.name}`,
  outputSizeMismatch: (p: { name: string; actual: string; expected: string }) => `De uitvoer van ${p.name} is ${p.actual}; verwacht was ${p.expected}`,
  exifOrientation: (p: { name: string }) => `${p.name} heeft een EXIF-oriëntatietag; de uitvoer wordt pixel voor pixel vergroot en niet rechtgezet`,
  toolNotFound: (p: { code: string }) => `Real-ESRGAN kan niet starten (${p.code})`,
};
