import type { JobsYtDlpMessages } from './yt-dlp.ts';

export const fr: JobsYtDlpMessages = {
  toolNotFound: (p: { code: string }) => `yt-dlp exécutable introuvable (${p.code})`,
  remedyUnsupported: "L’outil ne prend pas en charge ce lien : utilisez la page de la vidéo (pas une playlist, un direct ou une recherche)",
  remedyLoginRequired: "Connectez-vous au site dans votre navigateur, sélectionnez-le dans « Connexion au site », puis téléchargez à nouveau",
  remedyCookiesUnavailable: "Impossible de lire les cookies : vérifiez la connexion dans le navigateur ; si la base est utilisée, fermez complètement le navigateur (processus en arrière-plan compris) ; autorisez l’accès au trousseau s’il est refusé ; Safari nécessite l’accès complet au disque ; sous Windows, yt-dlp ne peut pas lire les cookies de Chrome, Edge ou Brave protégés par chiffrement lié à l’application : utilisez Firefox ou un autre navigateur",
  remedyToolUpdateRequired: "Échec d’analyse du site ou outil obsolète : mettez yt-dlp à jour, détectez-le à nouveau et réessayez",
  remedyUnavailable: "Vidéo indisponible (supprimée, restriction géographique ou aucun format téléchargeable)",
  remedyNetworkError: "Connexion impossible ou téléchargement interrompu : vérifiez le réseau et réessayez (parties téléchargées reprises)",
  remedyDiskFull: "Espace disque insuffisant pour Téléchargements ou Runtime Home : libérez de l’espace et réessayez",
  remedyDownloadFailed: "L’outil a signalé une erreur : voir details.stderr ; une mise à jour de yt-dlp peut être nécessaire (baocut external-tools detect)",
  exited: (p: { code: number | null }) => `yt-dlp s’est arrêté avec ${p.code}`,
  cookieLoginRequired: (p: { browser: string }) => `${p.browser} : le site exige toujours une connexion`,
  cookieUnreadable: (p: { browser: string }) => `${p.browser} : impossible de lire les cookies`,
  reasonSeparator: " ; ",
  cookieAttemptsFailed: (p: { count: number; reasons: string }) => `Cookies essayés depuis ${p.count} navigateurs, aucun n’a fonctionné (${p.reasons})`,
  metadataUnreadable: "Impossible de lire les métadonnées de l’outil de téléchargement",
  metadataNotObject: "Les métadonnées de l’outil ne sont pas un objet",
  playlist: "Le lien est une playlist ; importez une vidéo à la fois",
  live: "Les directs ne peuvent pas être importés",
};
