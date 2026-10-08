import type { JobsToolCatalogueMessages } from './tool-catalogue.ts';

export const fr: JobsToolCatalogueMessages = {
  transcribeLabel: "Transcrire",
  transcribeDescription:
    "Transcrit un fichier média local ou une vidéo de Space. Pour une vidéo, écrit une nouvelle transcription et crée un calque de sous-titres ; pour un fichier seul, écrit TXT et SRT à l’emplacement de sauvegarde ou peut créer une vidéo.",
  translateSubtitlesLabel: "Traduire les sous-titres",
  translateSubtitlesDescription:
    "Traduit phrase par phrase une transcription de vidéo dans une autre langue et l’écrit dans la vidéo comme nouvelle traduction. Peut aussi traduire un fichier SRT / VTT (local ou sous-titres de Space) dans un nouveau fichier.",
  dubLabel: "Doublage traduit",
  dubDescription:
    "Synthétise chaque phrase de la transcription dans la langue cible (traduit d’abord si nécessaire), aligne les horaires et l’écrit dans la vidéo comme nouveau groupe de doublage.",
  synthesizeSpeechLabel: "Générer la voix",
  synthesizeSpeechDescription:
    "Synthétise de la parole depuis un texte ; résultat audio. Peut aussi lire un document ou des sous-titres de Space (sans codes temporels).",
  generateTextLabel: "Générer du texte",
  generateTextDescription:
    "Génère du texte depuis un prompt (avec schéma JSON facultatif) ; résultat texte. Les documents ou sous-titres de Space peuvent être joints comme sources.",
  generateImageLabel: "Générer une image",
  generateImageDescription: "Génère une image depuis une description ; résultat image.",
  linkImportLabel: "Télécharger la vidéo",
  linkImportDescription:
    "Télécharge une vidéo sur cet ordinateur avec yt-dlp. Peut utiliser les cookies du navigateur et transcrire le téléchargement en texte et sous-titres.",
  compressVideoLabel: "Compresser une vidéo",
  compressVideoDescription:
    "Compresse les fichiers vidéo un à un : fichier vers fichier, sans création de vidéo ni écrasement de fichiers existants.",
  mergeVideoLabel: "Fusionner des vidéos",
  mergeVideoDescription:
    "Fusionne plusieurs fichiers vidéo dans l’ordre : fichier vers fichier, sans création de vidéo ni écrasement de fichiers existants.",
  extractAudioLabel: "Extraire l’audio",
  extractAudioDescription:
    "Extrait la piste audio d’un fichier vidéo ou audio. Les codecs compatibles avec un conteneur courant sont copiés tels quels ; les autres sont réencodés en AAC. Fichier vers fichier, sans création de vidéo ni écrasement de fichiers existants.",
};
