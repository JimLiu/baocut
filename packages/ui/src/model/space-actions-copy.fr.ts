import { pluralForm } from '@baocut/protocol';
import type { SpaceReference } from '@baocut/protocol';
import type { SpaceActionsMessages } from './space-actions-copy.ts';

export const fr: SpaceActionsMessages = {
  edit: {
    video: "Ouvrir la vidéo",
    'source-video': "Modifier dans la vidéo source",
    'new-video': "Nouvelle vidéo depuis ce média",
    text: "Modifier le texte",
    version: "Enregistrer une copie et modifier",
  },
  trashed: "Restaurez d’abord depuis la corbeille",
  editGenerating: "Génération en cours ; modification après la fin",
  editMissing: "Fichier introuvable, reconnectez avant de modifier",
  editFailed: "Génération en échec, aucun fichier à modifier",
  editPackage: "Paquets vidéo (portables) non modifiables",
  editText: "Nouvelle version texte non enregistrable ici ; continuez en session et confiez à l’Agent",
  editVersion: "Images, audio et modèles non modifiables manuellement ; continuez en session et confiez à l’Agent",
  newVideoOutside: "Fichier hors projet ou session ; création vidéo indisponible",
  packageGenerating: "Export en cours ; ouverture après la fin",
  packageMissing: "Fichier introuvable",
  packageFailed: "Export en échec, aucun paquet à ouvrir",
  packageOutside: "Paquet hors projet ou session ; ouverture indisponible",
  continueTrashed: "Restaurez depuis la corbeille avant d’ajouter à une session",
  purgeGenerating: "Tâche en cours ; annulez d’abord dans Tâches",
  purgeNotTrashed: "Placez d’abord dans la corbeille, puis supprimez-y",
  referenceKind: {
    'video-asset': "Média vidéo",
    job: "Tâche en cours",
    unverified: "Confirmation impossible",
    'user-file': "Autres fichiers du dossier vidéo",
  } satisfies Record<SpaceReference['kind'], string>,
  importAllFailed: (count: number, error: string) => `Aucun des ${count} fichiers importé : ${error}`,
  importFailed: (error: string) => `Non importé : ${error}`,
  imported: (count: number) => `Importé : ${count} ${pluralForm('fr', count, { one: "média", other: "médias" })}`,
  copiedAll: "copiés dans imports/ du projet",
  copiedSome: (count: number) => `${count} copiés dans imports/ du projet`,
  notImported: (count: number) => `${count} non importés`,

  references: (names: readonly string[], total: number) => {
    const quoted = names.map((name) => `« ${name} »`).join(", ");
    return total > names.length ? `Éléments Space ${quoted} et ${total - names.length} de plus` : `Space ${pluralForm('fr', total, { one: "élément", other: "éléments" })} ${quoted}`;
  },
  referenceOutput: "Résultat",
};
