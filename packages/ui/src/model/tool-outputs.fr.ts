import type { ToolOutputsMessages } from './tool-outputs.ts';

export const fr: ToolOutputsMessages = {
  actionLabel: { 'open-movie': 'Ouvrir dans l’éditeur', 'new-movie': 'Créer une vidéo à partir de ceci' },
  blockTextOnly: 'Les transcriptions et les sous-titres nécessitent un fichier vidéo ou audio pour créer une vidéo ; cela n’est pas encore possible ici',
  blockTrashed: 'Restaurez d’abord cet élément depuis la corbeille',
  blockGenerating: 'Génération en cours ; disponible une fois terminée',
  blockMissing: 'Impossible de trouver le fichier de ce résultat sur cet ordinateur',
  handover: {
    subtitle: 'Traduisez ces sous-titres dans une autre langue, en conservant les codes temporels.',
    document: 'Rédigez un résumé de cette transcription.', audio: 'Créez une vidéo avec cet audio.',
    image: 'Créez une vidéo avec cette image comme couverture.', 'video-file': 'Ajoutez des sous-titres à cette vidéo.',
    export: 'Ajoutez des sous-titres à cette vidéo.', video: 'Continuez à modifier cette vidéo.',
  },
  handoverDefault: 'Continuez à travailler sur ce résultat.',
};
