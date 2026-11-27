import type { DownloaderSettingsMessages } from './downloader-settings-copy.ts';

export const fr: DownloaderSettingsMessages = {
  lead: 'Le téléchargement de vidéos depuis un lien utilise yt-dlp. Télécharger la vidéo, la transcription depuis un lien et l’Agent téléchargent tous avec ces réglages.',
  toolGroup: 'Outil de téléchargement',
  cookiesLead: 'Les téléchargements utilisent votre connexion du navigateur : les vidéos qui demandent de se connecter peuvent aussi être téléchargées. Par défaut, tous les navigateurs détectés sont utilisés.',
  autoUpdate: "Mettre à jour yt-dlp automatiquement",
  autoUpdateDesc:
    "Recherche une nouvelle version stable une fois par jour. S’il y en a une, la copie téléchargée par BaoCut est remplacée après vérification de sa somme de contrôle ; d’ici là, vous pouvez continuer à télécharger avec la copie actuelle. Un yt-dlp que vous avez installé vous-même n’est pas modifié.",
  autoUpdateChecked: (when: string, version: string) => `Dernière vérification : ${when} · dernière version ${version}`,
};
