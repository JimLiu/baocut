import type { ToolsImageMessages } from './tools-image-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const fr: ToolsImageMessages = {
  emptyPrompt: 'Décrivez d’abord l’image', promptTooLong: (n, max) => `L’invite contient ${n} caractères · ce modèle accepte au maximum ${max}`,
  maxImages: (max) => `${max} ${pluralForm('fr', max, { one: 'image maximum', other: 'images maximum' })} à la fois`,
  seedInteger: 'La graine doit être un entier', pickModel: 'Choisissez d’abord un modèle', downloadFirst: (label) => `Téléchargez d’abord ${label}`,
  connectFirst: (provider) => `Connectez d’abord ${provider}`, local: 'Sur cet ordinateur',
  steps: (n) => `${n} ${pluralForm('fr', n, { one: 'étape', other: 'étapes' })}`, deviceTime: 'La durée dépend de votre appareil', offline: 'Fonctionne hors ligne',
  images: (n) => `${n} ${pluralForm('fr', n, { one: 'image', other: 'images' })}`, aspects: (n) => `${n} ${pluralForm('fr', n, { one: 'format', other: 'formats' })}`,
  providerSize: 'Taille définie par le fournisseur', takesSeed: 'Accepte une graine', localChip: 'Généré sur cet ordinateur · hors ligne',
  cloudChip: (provider) => `En ligne · ${provider} · facturation à l’utilisation`, imageName: (n) => `Image ${n}`, seed: (seed) => `Graine ${seed}`,
  decoding: 'Décodage', stepOf: (done, total) => `Étape ${done}/${total}`,
};
