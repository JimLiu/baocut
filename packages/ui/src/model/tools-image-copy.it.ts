import type { ToolsImageMessages } from './tools-image-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const it: ToolsImageMessages = {
  emptyPrompt: 'Descrivi prima l’immagine',
  promptTooLong: (n, max) => `Il prompt ha ${n} caratteri · questo modello ne accetta al massimo ${max}`,
  maxImages: (max) => pluralForm('it', max, { one: `Fino a ${max} immagine alla volta`, other: `Fino a ${max} immagini alla volta` }),
  seedInteger: 'Il seme deve essere un numero intero',
  pickModel: 'Scegli prima un modello',
  downloadFirst: (label) => `Scarica prima ${label}`,
  connectFirst: (provider) => `Connetti prima ${provider}`,
  local: 'Su questo computer',
  steps: (n) => pluralForm('it', n, { one: `${n} passaggio`, other: `${n} passaggi` }),
  deviceTime: 'Il tempo dipende dal dispositivo',
  offline: 'Funziona offline',
  images: (n) => pluralForm('it', n, { one: `${n} immagine`, other: `${n} immagini` }),
  aspects: (n) => pluralForm('it', n, { one: `${n} rapporto d’aspetto`, other: `${n} rapporti d’aspetto` }),
  providerSize: 'Dimensione impostata dal provider',
  takesSeed: 'Accetta un seme',
  localChip: 'Generato su questo computer · offline',
  cloudChip: (provider) => `Online · ${provider} · addebito in base all’utilizzo`,
  imageName: (n) => `Immagine ${n}`,
  seed: (seed) => `Seme ${seed}`,
  decoding: 'Decodifica',
  stepOf: (done, total) => `Passaggio ${done}/${total}`,
};
