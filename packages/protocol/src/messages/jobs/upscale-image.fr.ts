import type { JobsUpscaleImageMessages } from './upscale-image.ts';

export const fr: JobsUpscaleImageMessages = {
  label: 'Agrandir une image',
  description: 'Agrandit les images de 2 à 4× avec Real-ESRGAN sur cet ordinateur : de fichier à fichier, sortie en PNG, sans écraser les fichiers existants.',
  stepProbe: 'Lire les images',
  stepUpscale: 'Agrandir',
  stepVerify: 'Vérifier la sortie',
  stepPublish: 'Publier',
  inputNotFound: (p: { file: string }) => `Image d’entrée introuvable : ${p.file}`,
  inputUnsupported: (p: { name: string }) => `${p.name} n’est pas une image PNG, JPEG ou WebP lisible`,
  outputTooLarge: (p: { name: string; width: number; height: number; max: number }) => `${p.name} ferait ${p.width}×${p.height} ; chaque côté peut faire au plus ${p.max} pixels. Choisissez un facteur plus petit.`,
  upscaleFailed: (p: { name: string; detail: string }) => `Real-ESRGAN n’a pas pu agrandir ${p.name} : ${p.detail}`,
  outputMissing: (p: { name: string }) => `Aucune sortie n’a été écrite pour ${p.name}`,
  outputSizeMismatch: (p: { name: string; actual: string; expected: string }) => `La sortie de ${p.name} fait ${p.actual} ; attendu ${p.expected}`,
  exifOrientation: (p: { name: string }) => `${p.name} a une balise d’orientation EXIF ; la sortie est agrandie pixel pour pixel sans être redressée`,
  toolNotFound: (p: { code: string }) => `Impossible de lancer Real-ESRGAN (${p.code})`,
};
