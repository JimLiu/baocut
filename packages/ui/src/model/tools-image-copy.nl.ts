import { pluralForm } from '@baocut/protocol';
import type { ToolsImageMessages } from './tools-image-copy.ts';

export const nl: ToolsImageMessages = {
  emptyPrompt: "Beschrijf eerst de afbeelding",
  promptTooLong: (n: number, max: number) => `Prompt bevat ${n} tekens · dit model accepteert maximaal ${max}`,
  maxImages: (max: number) => `Maximaal ${max} ${pluralForm('nl', max, { one: "afbeelding", other: "afbeeldingen" })} tegelijk`,
  seedInteger: "Seed moet een geheel getal zijn",
  pickModel: "Kies eerst een model",
  downloadFirst: (label: string) => `Downloaden: ${label}`,
  connectFirst: (provider: string) => `Verbinden: ${provider}`,
  local: "Op deze computer",
  steps: (n: number) => `${n} ${pluralForm('nl', n, { one: "stap", other: "stappen" })}`,
  deviceTime: "De tijd hangt af van je apparaat",
  offline: "Werkt offline",
  images: (n: number) => `${n} ${pluralForm('nl', n, { one: "afbeelding", other: "afbeeldingen" })}`,
  aspects: (n: number) => `${n} ${pluralForm('nl', n, { one: "beeldverhouding", other: "beeldverhoudingen" })}`,
  providerSize: "Grootte bepaald door de aanbieder",
  takesSeed: "Accepteert een seed",
  localChip: "Gegenereerd op deze computer · offline",
  cloudChip: (provider: string) => `Online · ${provider} · gefactureerd op basis van gebruik`,
  imageName: (n: number) => `Afbeelding ${n}`,
  seed: (seed: number) => `Seed ${seed}`,
  decoding: "Decoderen",
  stepOf: (done: number, total: number) => `Stap ${done}/${total}`,
};
