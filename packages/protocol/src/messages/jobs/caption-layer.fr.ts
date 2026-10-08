import type { JobsCaptionLayerMessages } from './caption-layer.ts';

export const fr: JobsCaptionLayerMessages = {

  label: "Ajouter un calque de sous-titres",
  noSource: "Aucun document pour ajouter un calque de sous-titres",
  videoClosed: "La vidéo a été fermée ; aucun calque de sous-titres ajoutée. Ouvrez-la et réessayez.",
  empty: "Le document n’a aucun sous-titre à afficher ; aucun calque ajoutée",
  notOnTimeline: "Aucun clip de la timeline n’utilise ce média ; les sous-titres ne peuvent pas apparaître. Aucun calque ajoutée.",
  noDocumentId: "La calque de sous-titres a été ajoutée mais son identifiant de document n’a pas été renvoyé",
  rejected: "La transaction d’ajout de sous-titres a été refusée",
  documentGone: "Le document de sous-titres n’est plus dans la vidéo",
  needsOutputStore: "La lecture des sous-titres du Speech Worker nécessite le stockage des résultats",
  notSpeech: "Le document n’est pas une transcription",
  speechUnreadable: "Impossible de lire le contenu de la transcription",
  translationUnreadable: "Impossible de lire le contenu de la traduction",
  unaligned: (p: { count: number }) =>
    `${p.count} unités de traduction ne sont pas alignées (alignment est null) ; impossible d’en déterminer les horaires`,
  noSourceSpeech: "Impossible de trouver la transcription source de cette traduction",

  subtitlesName: "Sous-titres",

  translationName: "Traduction",

  styleName: "Style de sous-titre",
};
