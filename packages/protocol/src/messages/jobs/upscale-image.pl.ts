import type { JobsUpscaleImageMessages } from './upscale-image.ts';

export const pl: JobsUpscaleImageMessages = {
  label: 'Powiększanie obrazu',
  description: 'Powiększa obrazy 2–4× za pomocą Real-ESRGAN na tym komputerze: z pliku do pliku, wynik w PNG, bez nadpisywania istniejących plików.',
  stepProbe: 'Odczyt obrazów',
  stepUpscale: 'Powiększanie',
  stepVerify: 'Sprawdzenie wyniku',
  stepPublish: 'Publikowanie',
  inputNotFound: (p: { file: string }) => `Nie znaleziono obrazu wejściowego ${p.file}`,
  inputUnsupported: (p: { name: string }) => `${p.name} nie jest czytelnym obrazem PNG, JPEG ani WebP`,
  outputTooLarge: (p: { name: string; width: number; height: number; max: number }) => `${p.name} miałby wymiary ${p.width}×${p.height}; każdy bok może mieć najwyżej ${p.max} pikseli. Wybierz mniejszą skalę.`,
  upscaleFailed: (p: { name: string; detail: string }) => `Real-ESRGAN nie mógł powiększyć ${p.name}: ${p.detail}`,
  outputMissing: (p: { name: string }) => `Nie zapisano wyniku dla ${p.name}`,
  outputSizeMismatch: (p: { name: string; actual: string; expected: string }) => `Wynik dla ${p.name} ma ${p.actual}; oczekiwano ${p.expected}`,
  exifOrientation: (p: { name: string }) => `${p.name} ma znacznik orientacji EXIF; wynik jest powiększony piksel w piksel i nie jest obrócony`,
  toolNotFound: (p: { code: string }) => `Nie można uruchomić Real-ESRGAN (${p.code})`,
};
