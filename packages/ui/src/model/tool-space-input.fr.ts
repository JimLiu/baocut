import type { ToolSpaceInputMessages } from './tool-space-input.ts';

export const fr: ToolSpaceInputMessages = {
  reasons: {
    trashed: 'Dans la corbeille', generating: 'Génération en cours ; vous pourrez le choisir une fois terminé',
    missing: 'Le fichier est introuvable ; reconnectez-le avant de le choisir', failed: 'La dernière génération a échoué',
    textOnly: 'Seul le texte des documents .txt et .md peut être lu', subtitleOnly: 'Seuls les sous-titres .srt et .vtt sont acceptés',
    noPath: 'Cet élément n’a pas de fichier sur cet ordinateur ; une nouvelle vidéo doit partir d’un fichier local',
  }, joinKinds: (labels) => labels.join(', '),
};
