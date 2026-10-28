import type { ProvidersAgentMessages } from './providers-agent.ts';

export const fr: ProvidersAgentMessages = {
  codexUpgradeHint: 'Mettez à jour le CLI Codex (par exemple, npm install -g @openai/codex@latest), puis vérifiez à nouveau', codexImageModel: 'Génération d’images Codex (modèle choisi par Codex et votre compte)',
  codexImageNotes: 'Génère avec le compte Codex connecté sur cet ordinateur : un PNG par génération, une tâche à la fois, généralement en une ou deux minutes. La taille et la graine ne peuvent pas être définies (les demandes qui les incluent sont refusées), et les dimensions en pixels dépendent du résultat. Votre quota d’abonnement est utilisé ; le quota restant est inconnu. L’activer signifie accepter d’envoyer les invites à votre compte Codex.',
  codexImageNotesApiKey:
    "Codex est connecté avec une clé d’API ou une autre méthode que ChatGPT : la génération d’images peut ne pas fonctionner et le coût est facturé à ce compte, pas à un abonnement. BaoCut ne le choisira pas automatiquement ; choisissez-le vous-même pour essayer. Un PNG à la fois ; la taille et la graine ne peuvent pas être définies.",
  imagesOnly: (p) => `${p.label} peut uniquement générer des images`, onePngOnly: (p) => `${p.label} génère un PNG à la fois et n’accepte ni taille ni graine`, unavailable: (p) => `${p.label} est indisponible : ${p.message}`, sessionNotStarted: (p) => `La session de ${p.label} n’a pas démarré : ${p.error}`,
  timedOut: (p) => `${p.label} n’a pas terminé en ${p.minutes} minutes et a été interrompu`, exited: (p) => `${p.label} s’est arrêté de façon inattendue : ${p.message}`, notCompleted: (p) => `${p.label} n’a pas terminé cette génération : ${p.reason}`,
  turnInterrupted: 'le tour a été interrompu', noImage: (p) => `${p.label} n’a pas généré d’image`, noImageReply: (p) => `${p.label} n’a pas généré d’image : ${p.reply}`, unknownError: 'Erreur inconnue', processExited: 'Le processus s’est arrêté', turnNotStarted: (p) => `Le tour n’a pas démarré : ${p.error}`,
  codexTextModel: "Modèle par défaut de l’Agent",
  codexTextNotes:
    "Rédige avec le compte Codex connecté sur cet ordinateur : une requête à la fois, chacune dans une nouvelle session Codex, donc plus lentement qu’une API. La température, la graine et la longueur de sortie ne peuvent pas être définies. Votre quota d’abonnement est utilisé ; le quota restant est inconnu. L’activer signifie accepter d’envoyer les prompts, y compris le texte de transcription qu’ils contiennent, à votre compte Codex.",
  codexTextNotesApiKey:
    "Codex est connecté avec une clé d’API ou une autre méthode que ChatGPT : le coût est facturé à ce compte, pas à un abonnement. Une requête à la fois ; la température, la graine et la longueur de sortie ne peuvent pas être définies.",
};
