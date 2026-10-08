import type { ModelsModelDownloaderMessages } from './model-downloader.ts';

export const fr: ModelsModelDownloaderMessages = {
  remedyNoSpace: "Le disque du dossier des modèles est plein. Libérez assez d’espace (ou déplacez le dossier vers un autre disque dans Réglages), puis réinstallez",
  remedyNetwork: "Réseau inaccessible ou téléchargement interrompu. Vérifiez le réseau et réinstallez ; les parties téléchargées sont reprises. Vous pouvez changer de miroir dans « Source de téléchargement des modèles » de « Réglages › Général »",
  remedyIntegrity: "Un fichier téléchargé ne correspond pas à la taille ou au sha256 du manifeste (contenu incorrect de la source ou du miroir). Fichier supprimé ; changez de source et réinstallez",
  remedySource: "La source n’a pas ce fichier ou refuse l’accès. Vérifiez que le miroir dans « Source de téléchargement des modèles » de « Réglages › Général » (ou BAOCUT_MODELS_ENDPOINT) est complet",
  remedyManifestIncomplete: "Le manifeste intégré de ce paquet n’a pas de sha256 fiable ; installation impossible. Attendez une mise à jour de BaoCut",
  downloadFailed: (p: { file: string; reason: string }) => `Impossible de télécharger ${p.file} : ${p.reason}`,
  integrityMismatch: (p: { file: string }) => `La taille ou le sha256 de ${p.file} ne correspond pas au manifeste`,
  sourceHttp: (p: { file: string; status: number }) => `La source de téléchargement a renvoyé HTTP ${p.status} pour ${p.file}`,
  diskFull: "Le disque s’est rempli pendant l’écriture des fichiers de modèle",
};
