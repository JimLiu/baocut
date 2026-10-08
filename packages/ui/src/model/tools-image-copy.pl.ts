import { pluralForm } from '@baocut/protocol';
import type { ToolsImageMessages } from './tools-image-copy.ts';

export const pl: ToolsImageMessages = {
  emptyPrompt: "Najpierw opisz obraz",
  promptTooLong: (n, max) => `Długość promptu: ${n} znaków · ten model przyjmuje najwyżej ${max}`,
  maxImages: (max: number) => pluralForm('pl', max, { one: `Do ${max} obrazu naraz`, few: `Do ${max} obrazów naraz`, many: `Do ${max} obrazów naraz`, other: `Do ${max} obrazu naraz` }),
  seedInteger: "Ziarno musi być liczbą całkowitą",
  pickModel: "Najpierw wybierz model",
  downloadFirst: (label) => `Najpierw pobierz ${label}`,
  connectFirst: (provider) => `Najpierw połącz ${provider}`,
  local: "Na tym komputerze",
  steps: (n: number) => pluralForm('pl', n, { one: `${n} krok`, few: `${n} kroki`, many: `${n} kroków`, other: `${n} kroku` }),
  deviceTime: "Czas zależy od urządzenia",
  offline: "Działa offline",
  images: (n: number) => pluralForm('pl', n, { one: `${n} obraz`, few: `${n} obrazy`, many: `${n} obrazów`, other: `${n} obrazu` }),
  aspects: (n: number) => pluralForm('pl', n, { one: `${n} proporcja`, few: `${n} proporcje`, many: `${n} proporcji`, other: `${n} proporcji` }),
  providerSize: "Rozmiar ustala dostawca",
  takesSeed: "Obsługuje ziarno",
  localChip: "Generowane na tym komputerze · offline",
  cloudChip: (provider) => `Online · ${provider} · opłata za użycie`,
  imageName: (n) => `Obraz ${n}`,
  seed: (seed) => `Ziarno ${seed}`,
  decoding: "Dekodowanie",
  stepOf: (done, total) => `Krok ${done}/${total}`,
};
