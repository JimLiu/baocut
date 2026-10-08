import type { HomeBriefMessages } from './home-brief.ts';

export const fr: HomeBriefMessages = {
  about: (minutes: number, seconds: number) =>
    `À propos de ${[minutes ? `${minutes} min` : "", seconds ? `${seconds} s` : ""].filter(Boolean).join(" ")}`,
  fromMaterials: "Créez une vidéo depuis les sources jointes.",
  materials: (paths: readonly string[]) => `Sources : ${paths.join(", ")}`,
  connectFirst: "Connecter d’abord l’IA",
  sayFirst: "Décrivez quoi créer ou joignez des sources",
  agentOffTitle: "Tous les Agents de code installés sont désactivés",
  agentOffBody: "Un Agent de code est installé mais désactivé dans Réglages. Activez-en un pour commencer ici.",
  enableNamed: (name: string) => `Activer ${name}`,
  enableAgent: "Activer l’Agent",
  agentMissingTitle: "Nécessite un Agent de code",
  agentMissingBody: "Installez Claude Code ou Codex CLI, connectez votre abonnement, puis revenez commencer.",
  connectAgent: "Connecter l’Agent",
  nameEmpty: "Saisissez un nom de projet",
  nameInvalid: "Le nom ne peut pas contenir de barres obliques ni caractères de contrôle",
};
