import type { JobsSpeakersMessages } from './speakers.ts';

export const fr: JobsSpeakersMessages = {

  label: "Identifier les intervenants",
  description:
    "Distingue les locuteurs par la voix dans une transcription existante de la vidéo (modèle local, sans retranscription). Le résultat est une proposition ; après confirmation, appliquez-la avec edits.applySpeakers.",
  stepDiarize: "Distinguer les locuteurs",
  stepPropose: "Organiser les résultats",
  videoNotOpen: "La vidéo n’est pas ouverte",
  notFromAsset: "Cette transcription n’est pas associée à un média de la vidéo ; impossible de distinguer les locuteurs par la voix",
  modelMissing: "Cet ordinateur n’a aucun modèle de diarisation des locuteurs",
  modelNotInstalled: "Le modèle de diarisation des locuteurs n’est pas installé. Téléchargez-le d’abord.",
  transcriptUnreadable: "Impossible de lire la transcription",
  videoClosed: "La vidéo a été fermée",
  transcriptGone: "La transcription n’est plus dans la vidéo",
  noWords: "La transcription ne contient aucun mot",
  untimedWords: "Des mots de la transcription n’ont aucun horaire ; impossible de distinguer les locuteurs par la voix",
  sourceMissing: "Fichier source du média introuvable",
  hashMismatch: "L’empreinte de speakers.json ne correspond pas à celle déclarée par le Worker",
  wordCountMismatch: "speakers.json n’a pas le même nombre de mots que la transcription",
  transcriptChanged: "La transcription a changé depuis l’identification. Identifiez à nouveau les locuteurs.",
  translationChanged: "Une traduction a changé depuis l’identification. Identifiez à nouveau les locuteurs.",
  unknownSpeaker: "Ce locuteur n’est pas dans la proposition",
  nameInvalid: (p: { max: number }) => `Les noms de locuteurs doivent être non vides et ne pas dépasser ${p.max} caractères`,
  applyFailed: "Impossible d’appliquer la proposition",
};
