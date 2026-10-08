import { pluralForm } from '@baocut/protocol';
import type { ToolsImageMessages } from './tools-image-copy.ts';

export const de: ToolsImageMessages = {
  emptyPrompt: "Zuerst das Bild beschreiben",
  promptTooLong: (n: number, max: number) => `Prompt enthält ${n} Zeichen · dieses Modell akzeptiert höchstens ${max}`,
  maxImages: (max: number) => `Bis zu ${max} ${pluralForm('de', max, { one: "Bild", other: "Bilder" })} gleichzeitig`,
  seedInteger: "Der Seed muss eine ganze Zahl sein",
  pickModel: "Zuerst ein Modell auswählen",
  downloadFirst: (label: string) => `Herunterladen: ${label}`,
  connectFirst: (provider: string) => `Verbinden: ${provider}`,
  local: "Auf diesem Computer",
  steps: (n: number) => `${n} ${pluralForm('de', n, { one: "Schritt", other: "Schritte" })}`,
  deviceTime: "Die Dauer hängt von Ihrem Gerät ab",
  offline: "Funktioniert offline",
  images: (n: number) => `${n} ${pluralForm('de', n, { one: "Bild", other: "Bilder" })}`,
  aspects: (n: number) => `${n} ${pluralForm('de', n, { one: "Seitenverhältnis", other: "Seitenverhältnisse" })}`,
  providerSize: "Größe vom Anbieter vorgegeben",
  takesSeed: "Unterstützt Seed",
  localChip: "Auf diesem Computer erzeugt · offline",
  cloudChip: (provider: string) => `Online · ${provider} · nach Nutzung abgerechnet`,
  imageName: (n: number) => `Bild ${n}`,
  seed: (seed: number) => `Seed ${seed}`,
  decoding: "Wird decodiert",
  stepOf: (done: number, total: number) => `Schritt ${done}/${total}`,
};
