import type { VoicesMessages } from './voices-copy.ts';

export const fr: VoicesMessages = {
  myVoices: {
    offline: "Les voix apparaissent après connexion au Runtime.",
    add: "Ajouter une voix",
    fromFile: "Créer depuis un fichier audio…",
    fromFileHint: "WAV, MP3 ou FLAC, 20 Mo maximum ; phrase complète de 5–12 secondes idéale",
    importPackage: "Importer un pack de voix…",
    importHint: "Un .bcvoice exporté",
    record: "Enregistrer au microphone",
    recordWhy:
      "Enregistrement dans l’application indisponible : référence à sauvegarder en fichier avant le Runtime, étape pas encore construite. Enregistrez dans une autre application (WAV, MP3, FLAC), puis « Créer depuis un fichier audio ».",

    recordWhyNoPicker:
      "Enregistrement dans l’application indisponible : référence à sauvegarder en fichier avant le Runtime, étape pas encore construite. Enregistrez dans une autre application (WAV, MP3, FLAC), puis « Créer depuis un fichier audio ». Import de pack : cette fenêtre n’ouvre pas le sélecteur système ; utilisez l’application de bureau.",
    noPicker: "Cette fenêtre n’ouvre pas le sélecteur système ; utilisez l’application de bureau.",
    pickAudioTitle: "Choisir une référence",
    pickAudioFilter: "Audio (WAV, MP3, FLAC)",
    pickPackageTitle: "Choisir un pack de voix",
    pickPackageFilter: "Pack de voix",
    pickButton: "Choisir",
    notAudio: "Les références doivent être WAV, MP3 ou FLAC.",
    imported: (name: string) => `Importé : « ${name} » · disponible pour synthèse et doublage`,
    importFailed: (text: string) => `Impossible d’importer : ${text}`,
    foot:
      "Une voix = référence + texte prononcé + consentement. Référence conservée localement ; un pack exporté (name.bcvoice) inclut l’enregistrement et peut être importé ailleurs, mais pas les clones. " +
      "Sans déclaration indiquant si la voix appartient au locuteur, aucun envoi à un tiers.",

    play: (name: string) => `Écouter ${name}`,
    stop: (name: string) => `Arrêter l’écoute de ${name}`,
    playFailed: (text: string) => `Impossible d’écouter : ${text}`,
    more: (name: string) => `Plus · ${name}`,
    edit: "Modifier…",
    cloneTo: (label: string) => `Envoyer à ${label} pour cloner…`,
    recloneTo: (label: string) => `Envoyer à ${label} à nouveau…`,
    recloneHint: "Référence modifiée ; ancien clone obsolète",
    removeClone: (label: string) => `Supprimer le clone de ${label}…`,
    export: "Exporter le pack de voix…",
    remove: "Supprimer…",
    cloning: (label: string) => `Envoi à ${label} pour cloner…`,
    cloneFailed: (label: string, text: string) => `Le dernier clonage chez ${label} a échoué : ${text}`,
    loadingMeta: "Chargement…",

    createTitle: "Nouvelle voix",
    editTitle: (name: string) => `Modifier « ${name} »`,
    referenceFile: (file: string) => `Référence : ${file}`,
    name: "Nom",
    language: "Langue",
    languageHint: "Langue parlée dans la référence",
    transcript: "Transcription",
    transcriptHint: "Texte de la référence. Certains moteurs en ont besoin pour cloner ; laissez vide si incertain.",
    consentHint: "Vous pouvez enregistrer sans cocher, mais aucun envoi à un tiers pour clonage.",
    save: "Enregistrer comme voix",
    saveEdit: "Enregistrer",
    cancel: "Annuler",
    loading: "Chargement de la voix…",
    loadFailed: (text: string) => `Impossible de charger cette voix : ${text}`,
    saved: (name: string) => `Enregistré : « ${name} » · disponible pour synthèse et doublage`,
    updated: (name: string) => `« ${name} »`,
    unchanged: "Aucune modification",

    uploadTitle: (label: string) => `Envoyer à ${label} ?`,
    upload: "Importer",
    cloneStarted: (label: string) => `Envoi à ${label} · progression dans Tâches en arrière-plan`,
    cloneRejected: (text: string) => `Impossible de démarrer le clonage : ${text}`,
    removeCloneTitle: (label: string) => `Supprimer le clone de ${label} ?`,
    removeCloneBody: (label: string) =>
      `${label} recevra la demande de supprimer cette voix clonée. Pour l’utiliser ensuite chez ${label}, il faudra la renvoyer.`,
    removeCloneConfirm: "Supprimer le clone",
    cloneRemoved: (label: string) => `Clone supprimé chez ${label}`,
    cloneGoneRemote: (label: string) => `${label} n’a plus ce clone ; enregistrement local aussi effacé`,
    cloneRemoveFailed: (text: string) => `Impossible de supprimer le clone : ${text}`,

    exportTitle: "Exporter le pack de voix",
    exportButton: "Exporter",
    exported: (path: string) => `Exporté vers ${path}`,
    exportFailed: (text: string) => `Impossible d’exporter : ${text}`,
    exportExists: "BaoCut n’écrase aucun fichier existant. Choisissez un autre nom ou emplacement et réexportez.",

    exportFailedExists: (text: string) =>
      `Impossible d’exporter : ${text}. BaoCut n’écrase aucun fichier existant. Choisissez un autre nom ou emplacement et réexportez.`,

    deleteTitle: (name: string) => `Supprimer « ${name} » ?`,
    deleteConfirm: "Supprimer",
    deleted: (name: string) => `Supprimé : « ${name} »`,
    deleteFailed: (text: string) => `Impossible de supprimer : ${text}`,
    localOnlyTitle: (label: string) => `Le clone chez ${label} n’a pas été supprimé`,
    localOnlyBody: (label: string, text: string) =>
      `${text}

La voix est toujours ici. Réessayez plus tard ou supprimez seulement l’enregistrement et la voix sur cet ordinateur. Le clone de votre compte ${label} restera ; vous devrez le supprimer vous-même chez ${label}.`,
    localOnlyConfirm: "Supprimer seulement localement",
    later: "Réessayer plus tard",
  },
};
