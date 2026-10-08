import type { ToolFrameMessages } from './tool-frame.ts';

export const fr: ToolFrameMessages = {
  noneAvailable: (noun) => `Aucun ${noun} disponible pour le moment ; configurez-en un dans les Réglages`,
  pickOne: (noun) => `Choisissez d’abord un ${noun}`,
  notInstalled: (name) => `${name} n’est pas encore installé`,
  notConnected: (provider) => `${provider} n’est pas encore connecté`,
  unavailable: (name, why) => `${name} · ${why ?? 'Indisponible'}`,
  notInstalledWarning: (name) => `${name} n’est pas encore installé. Choisissez-en un installé ou téléchargez-le dans les Réglages`,
  notConnectedWarning: (provider) => `${provider} n’est pas encore connecté. Choisissez-en un disponible ou connectez-le dans les Réglages`,
  noModel: (noun, local) => local
    ? `Aucun ${noun} disponible pour le moment. Installez un modèle local ou connectez un service cloud dans les Réglages.`
    : `Aucun ${noun} disponible pour le moment. Connectez un service cloud dans les Réglages.`,
};
