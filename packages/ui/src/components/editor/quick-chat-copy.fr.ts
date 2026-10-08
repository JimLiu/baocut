import type { QuickChatMessages } from './quick-chat-copy.ts';

export const fr: QuickChatMessages = {
  label: "Session de cette vidéo",
  open: "Ouvrir la session de cette vidéo",
  fresh: "Nouvelle session",
  expand: "Développer la session à gauche",
  minimize: "Réduire",
  about: (name: string) => `À propos de « ${name} »`,
  placeholder: "Que voulez-vous faire de cette vidéo ? Tapez / pour les outils",
  hint: "L’Agent travaille ici même",
  failed: (message: string) => `Impossible d’envoyer : ${message}`,
  untitled: "Vidéo",
  send: "Envoyer",
};
