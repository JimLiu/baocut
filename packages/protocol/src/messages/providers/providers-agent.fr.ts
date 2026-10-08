import type { ProvidersAgentMessages } from './providers-agent.ts';

export const fr: ProvidersAgentMessages = {
  codexUpgradeHint: 'Mettez à jour le CLI Codex (par exemple, npm install -g @openai/codex@latest), puis vérifiez à nouveau', codexImageModel: 'Génération d’images Codex (modèle choisi par Codex et votre compte)',
  codexImageNotes: 'Génère avec le compte Codex connecté sur cet ordinateur : un PNG par génération, une tâche à la fois, généralement en une ou deux minutes. La taille et la graine ne peuvent pas être définies (les demandes qui les incluent sont refusées), et les dimensions en pixels dépendent du résultat. Votre quota d’abonnement est utilisé ; le quota restant est inconnu. L’activer signifie accepter d’envoyer les invites à votre compte Codex.',
  imagesOnly: (p) => `${p.label} peut uniquement générer des images`, onePngOnly: (p) => `${p.label} génère un PNG à la fois et n’accepte ni taille ni graine`, unavailable: (p) => `${p.label} est indisponible : ${p.message}`, sessionNotStarted: (p) => `La session de ${p.label} n’a pas démarré : ${p.error}`,
  timedOut: (p) => `${p.label} n’a pas terminé en ${p.minutes} minutes et a été interrompu`, exited: (p) => `${p.label} s’est arrêté de façon inattendue : ${p.message}`, notCompleted: (p) => `${p.label} n’a pas terminé cette génération : ${p.reason}`,
  turnInterrupted: 'le tour a été interrompu', noImage: (p) => `${p.label} n’a pas généré d’image`, noImageReply: (p) => `${p.label} n’a pas généré d’image : ${p.reply}`, unknownError: 'Erreur inconnue', processExited: 'Le processus s’est arrêté', turnNotStarted: (p) => `Le tour n’a pas démarré : ${p.error}`,
};
