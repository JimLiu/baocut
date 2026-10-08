import type { ToolsTextMessages } from './tools-text.ts';

export const fr: ToolsTextMessages = {
  emptyInput: 'Saisissez d’abord ce qu’il faut générer', tooLong: (max) => `Au maximum ${max} caractères à la fois`,
  sample: 'Rédigez un doublage de 30 secondes pour une vidéo de balade en ville. Gardez un ton naturel et évoquez les rues, les cafés et le crépuscule.',
  counter: (n, max) => `${n} / ${max} caractères`, connectTextModel: 'Connectez d’abord un modèle de texte', connectFirst: (provider) => `Connectez d’abord ${provider}`,
  effortFixed: 'Effort de raisonnement · non réglable pour ce modèle', effort: (label) => `Effort de raisonnement · ${label} (valeur par défaut définie dans Modèles)`,
  auto: 'Automatique', headerChip: (provider) => `En ligne · ${provider} · facturation au token`, fileStem: 'Texte généré',
  chars: (n) => `${n} caractères`, outputTokens: (n) => `${n} tokens de sortie`, truncated: 'Limite de sortie atteinte ; la suite a été tronquée',
};
