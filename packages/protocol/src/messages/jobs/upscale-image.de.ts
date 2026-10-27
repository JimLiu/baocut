import type { JobsUpscaleImageMessages } from './upscale-image.ts';

export const de: JobsUpscaleImageMessages = {
  label: 'Bild hochskalieren',
  description: 'Vergrößert Bilder mit Real-ESRGAN auf diesem Computer um das 2- bis 4-Fache: Datei zu Datei, Ausgabe als PNG, vorhandene Dateien werden nicht überschrieben.',
  stepProbe: 'Bilder lesen',
  stepUpscale: 'Hochskalieren',
  stepVerify: 'Ausgabe prüfen',
  stepPublish: 'Veröffentlichen',
  inputNotFound: (p: { file: string }) => `Eingabebild ${p.file} nicht gefunden`,
  inputUnsupported: (p: { name: string }) => `${p.name} ist kein lesbares PNG-, JPEG- oder WebP-Bild`,
  outputTooLarge: (p: { name: string; width: number; height: number; max: number }) => `${p.name} hätte danach ${p.width}×${p.height}; jede Seite darf höchstens ${p.max} Pixel haben. Wähle einen kleineren Faktor.`,
  upscaleFailed: (p: { name: string; detail: string }) => `Real-ESRGAN konnte ${p.name} nicht hochskalieren: ${p.detail}`,
  outputMissing: (p: { name: string }) => `Für ${p.name} wurde keine Ausgabe geschrieben`,
  outputSizeMismatch: (p: { name: string; actual: string; expected: string }) => `Die Ausgabe von ${p.name} ist ${p.actual}; erwartet war ${p.expected}`,
  exifOrientation: (p: { name: string }) => `${p.name} hat ein EXIF-Ausrichtungs-Tag; die Ausgabe wird pixelgenau vergrößert und nicht aufgerichtet`,
  toolNotFound: (p: { code: string }) => `Real-ESRGAN kann nicht gestartet werden (${p.code})`,
};
