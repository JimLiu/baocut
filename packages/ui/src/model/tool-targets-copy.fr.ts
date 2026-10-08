import type { ToolTargetsMessages } from './tool-targets-copy.ts';

export const fr: ToolTargetsMessages = {
  unknownLanguage: 'Langue inconnue', langCount: (label, count) => `${label} ×${count}`, joinLangs: (labels) => labels.join(', '),
  tagTranscript: (langs) => `Transcription · ${langs}`, tagTranslation: (langs) => `Traduction · ${langs}`, tagDub: (langs) => `Doublage · ${langs}`,
  tagPending: 'Lecture du contenu en cours ; une transcription sera choisie au démarrage',
  blockTranscribing: 'Transcription en cours ; vous pourrez retranscrire une fois terminée',
  blockQueued: 'Déjà en file d’attente pour la transcription',
  blockTranscribingWait: 'Transcription en cours ; vous pourrez la choisir une fois terminée',
  blockQueuedWait: 'En file d’attente pour la transcription ; vous pourrez la choisir après la transcription',
  blockFailed: 'La dernière transcription a échoué ; retranscrivez d’abord',
  blockNoTranscript: 'Aucune transcription ; transcrivez d’abord',
  duplicateTranscript: (langs) =>
    `Cette vidéo a déjà une transcription en ${langs}. Par défaut, une nouvelle vidéo est créée et cette vidéo et ses traductions ne changent pas. « Remplacer la transcription de cette vidéo » change la transcription actuelle : les traductions sont reportées en appariant l’original, les phrases dont l’original a changé sont marquées obsolètes, et le tout forme une seule modification annulable.`,
  duplicateTranslation: (lang) =>
    `Cette vidéo a déjà une traduction en ${lang}. Une nouvelle traduction sera ajoutée et l’ancienne sera conservée ; choisissez celle à utiliser dans l’éditeur.`,
  duplicateDub: (lang) => `Cette vidéo a déjà un doublage en ${lang}. Un nouvel ensemble sera ajouté et l’ancien sera conservé.`,
  duplicateTitle: {
    transcribe: 'Cette vidéo a déjà une transcription',
    'translate-subtitles': 'Les traductions existantes sont conservées',
    dub: 'Les doublages existants sont conservés',
  },
  translationOption: (lang, nth) => `Traduction en ${lang}${nth === null ? '' : ` #${nth}`}`,
  translatedFrom: (lang) => `Depuis la transcription en ${lang}`,
  destNewVideo: 'Nouvelle vidéo',
  destNewVideoNote: 'Une nouvelle vidéo dans le même projet, liée au même média ; cette vidéo et ses traductions ne changent pas',
  destReplace: 'Remplacer la transcription de cette vidéo',
  destReplaceNote:
    'Change la transcription actuelle ; traductions, sous-titres et doublages sont reportés dans la même modification, que vous pouvez annuler',
  newVideoName: (name) => `${name} · Retranscrit`,
  impactTranslation: (lang, units) => `${lang} · ${units} ${units === 1 ? 'phrase' : 'phrases'}`,
  impactDub: (lang, groups) =>
    `${lang} · ${groups} ${groups === 1 ? 'ensemble' : 'ensembles'} · le doublage des phrases dont la traduction ne change pas est conservé et marqué comme peut-être désynchronisé`,
  impactRule:
    'Les phrases dont l’original ne change pas gardent leur traduction et leur statut de relecture, alignées par phrase ; celles qui ont changé ou ne peuvent pas être appariées sont marquées obsolètes, à retraduire ensuite avec « Actualiser les traductions obsolètes ». Les chiffres exacts figurent dans le résultat.',
  impactUndo: 'Une seule modification, que vous pouvez annuler',
};
