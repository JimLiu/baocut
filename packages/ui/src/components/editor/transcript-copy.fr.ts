import type { RestoreRefusal } from '../../model/transcript-cut.ts';
import type { TranscriptMessages, TranscriptToolsMessages } from './transcript-copy.ts';

import { pluralForm } from '@baocut/protocol';
import { secondsLabel } from './transcript-copy.ts';
export const frSeconds = (seconds: number): string => seconds < 10 ? `${(Math.round(seconds * 10) / 10).toFixed(1).replace('.', ',')} s` : `${Math.round(seconds)} s`;
const words = (n: number) => `${n} ${pluralForm('fr', n, { one: 'mot', other: 'mots' })}`;

export const frTranscript: TranscriptMessages = {
  title: "Transcription",
  modes: "Mode de modification de transcription",
  modeEdit: "Modifier le texte",
  modeCut: "Couper le média",

  hintEdit: "Modifie seulement le texte ; vidéo et audio inchangés. Double-cliquez un mot pour le modifier ; ⌫ supprime seulement le texte.",
  hintCut: "Sélectionnez du texte et appuyez ⌫ pour couper vidéo, audio et sous-titres ensemble. Les mots restent barrés et restaurables.",

  emptyTitle: "Aucune transcription",
  emptyNoMedia: "Ajoutez un fichier vidéo ou audio. Après transcription, les mots prononcés apparaissent ici.",
  emptyNotPlaced: "Le média n’est pas sur la timeline. Placez-le et transcrivez-le pour afficher le texte ici.",
  emptyNotTranscribed: "Les médias de la timeline ne sont pas transcrits. Transcrivez-les dans Sous-titres pour afficher le texte ici.",
  gotoSubtitle: "Transcrire dans Sous-titres",
  addMedia: "Ajouter un média",
  loading: "Chargement de la transcription…",
  noWords: "Cette transcription n’a aucun mot à afficher.",
  notSpeech: "Le format de cette transcription n’est pas reconnu.",


  stats: (count: number, cut: number) => (cut ? `${words(count)} · ${cut} coupés` : words(count)),
  jump: "Aller ici",
  cutWordTitle: "Couper de la timeline",
  partialWordTitle: "Une coupe traverse ce mot ; seule une partie reste sur la timeline",

  selected: (count: number, seconds: number | null) =>
    seconds === null ? `${words(count)} sélectionnées` : `${words(count)} sélectionnés · ${secondsLabel(seconds)}`,
  cut: "Couper",
  restore: "Restaurer",
  editWord: "Modifier le mot",
  deleteText: "Supprimer le texte",
  clear: "Annuler la sélection · Échap",
  aiFind: "Trouver des coupes",
  aiFindHint: "Ou laissez d’abord l’IA trouver les tics de langage et pauses",

  cutDone: (seconds: number, ranges: number) =>
    ranges > 1 ? `Coupé ${secondsLabel(seconds)} · ${ranges} plages` : `Coupé ${secondsLabel(seconds)}`,
  cutNothing: "Les mots sélectionnés ne sont plus sur la timeline ; rien à couper.",
  cutTooShort: "La sélection dure moins d’une image et ne peut pas être coupée.",
  restoreDone: (seconds: number) => `Restauré : ${secondsLabel(seconds)}`,
  restoreNotRelaid: "Certaines coupes n’ont pas de raccord correspondant. Retirées de la liste, mais contenu non restauré.",
  restoreRefused: {
    untracked: "Cette plage n’a pas été supprimée par une coupe (par exemple, bord du clip raccourci) ; aucune coupe à restaurer. Glissez le bord du clip pour la récupérer.",
    partial: "Seule une partie de cette plage a été coupée ; impossible de changer sa plage. Cliquez d’abord la bande de coupe pour la restaurer.",
  } satisfies Record<RestoreRefusal, string>,
  textSaved: "Texte mis à jour · vidéo et audio inchangés",
  textDeleted: (count: number) => `Texte supprimé pour ${words(count)} · vidéo et audio inchangés`,

  stale: (count: number) =>
    pluralForm('fr', count, { one: `${count} piste de sous-titres vient d’une ancienne transcription et n’a pas été mise à jour.`, other: `${count} pistes de sous-titres viennent d’une ancienne transcription et n’ont pas été mises à jour.` }),
  gotoCaptions: "Ouvrir Sous-titres",
  undo: "Annuler",

  seamLabel: (seconds: number) => `Coupé ${secondsLabel(seconds)} · cliquez pour restaurer`,
  cutLabel: "Couper dans la transcription",
  restoreLabel: "Restaurer le contenu coupé",
  liveCopy: "Copier la partie déjà transcrite",
  liveCopied: "Partie déjà transcrite copiée · la transcription continue",
  liveSpeaker: "Reconnaissance en cours",
  liveWaiting: "Le texte reconnu s’affiche ici au fur et à mesure. Certains services le renvoient en entier à la fin.",
  liveNote: "Le texte reconnu s’affiche paragraphe par paragraphe. Vous pourrez le modifier une fois la transcription terminée.",
  liveJump: "Revenir au plus récent",
  liveSaving: "Enregistrement de la transcription",
};

export const frTranscriptTools: TranscriptToolsMessages = {

  toolsMenu: "Organiser la transcription",
  toolsTidy: "Organiser toute la transcription",
  toolsFrom: "Partir de la transcription",

  findTip: "Rechercher et remplacer · ⌘F",
  findLabel: "Rechercher et remplacer",
  findPlaceholder: "Rechercher dans la transcription",

  lockTranslation: "Les traductions sont consultables mais non modifiables ici ; Transcription modifie seulement l’original",
  lockLoading: "Une nouvelle version est encore en chargement ; remplacez après la fin",
  replaceLabel: "Remplacer le texte de transcription",
  replaceDone: (count: number) => `Remplacé : ${count} ${pluralForm('fr', count, { one: "correspondance", other: "correspondances" })} · vidéo et audio inchangés`,
  replaceNothing: "Aucune correspondance à modifier",

  copyMenu: "Copier la transcription",
  copyAllHead: (lang: string) => `Tout copier · ${lang}`,
  copyText: "Copier le texte",
  copySpeaker: "Avec locuteurs",
  copyTimed: "Avec codes temporels et locuteurs",
  copyScopeHead: (scope: string) => `Copier ${scope}`,
  copied: (scope: string, receipt: string) => `Copié : ${scope} · ${receipt}`,
  copyFailed: "Impossible de copier · accès au presse-papiers refusé par le navigateur",
  copyEmpty: "Rien à copier",
  scopeAll: "tout",
  scopePara: "ce paragraphe",
  scopeChapter: (title: string) => `« ${title} »`,
  scopeSelection: "texte sélectionné",
  copySelection: "Copier",
  copySelectionTip: "Copier le texte sélectionné · ⌘C",

  langLabel: "Langue de transcription",
  langSource: "Originale",
  langTranslation: "Traduction",
  langBoth: (source: string, translation: string) => `${source} + ${translation}`,
  showBoth: "Afficher l’original à côté",
  showBothNeedsTranslation: "Choisissez d’abord une traduction",
  showBothHint: "Côte à côte",
  noTranslation: "Aucune traduction",
  noTranslationHint: "Traduisez depuis Sous-titres avec « + Traduire en… »",
  translationNote: "Les traductions suivent la lecture par paragraphe seulement ; seuls les mots originaux ont des horaires. Le surlignage mot à mot serait inventé.",
  translationOnly: "Modification et coupe impossibles en traduction seule ; revenez à l’original ou côte à côte.",
  noParagraphTranslation: "Ce paragraphe n’a aucune traduction",

  paraMenu: "Ce paragraphe…",
  moveUp: "Déplacer au chapitre précédent",
  moveDown: "Déplacer au chapitre suivant",
  play: "Lire le paragraphe",
  moveHead: "Déplacer au chapitre",
  moveTo: (title: string) => `Déplacer vers « ${title} »`,
  moveWith: (count: number) => (count > 1 ? `Déplace avec ses voisins de ce côté, ${count} paragraphes au total` : "Déplace seulement ce paragraphe"),

  noPrev: "Aucun chapitre avant ce paragraphe",
  noNext: "Aucun chapitre après ce paragraphe",
  moveBlocked: "Le déplacer viderait ce chapitre ou dépasserait le début du voisin",
  moveLabel: "Déplacer le paragraphe au chapitre voisin",
  moved: (title: string, count: number) => (count > 1 ? `Déplacé : ${count} paragraphes vers « ${title} »` : `Déplacé vers « ${title} »`),
  cutPara: "Couper ce paragraphe",
  cutParaHint: "Coupe vidéo, audio et sous-titres ensemble ; restaurable",

  chapterMenu: "Ce chapitre…",
  renameChapter: "Renommer…",
  cutChapter: "Couper ce chapitre",
  cutChapterHint: "Coupe vidéo, audio et sous-titres ensemble ; chapitres suivants avancés",
  cutChapterLabel: "Couper le chapitre",
  cutChapterRefused: {
    empty: "Ce chapitre n’a aucune durée",
    whole: "Ce chapitre est toute la vidéo ; le couper ne laisserait rien",
    'no-tracks': "Aucune piste n’utilise les médias transcrits ; rien à couper",
  } satisfies Record<'empty' | 'whole' | 'no-tracks', string>,
  cutChapterDone: (title: string, seconds: number) => `Couper « ${title} » superposée · ${secondsLabel(seconds)}`,
  removeMarker: "Supprimer le marqueur de chapitre",
  removeMarkerHint: "Supprime seulement le marqueur ; contenu conservé",
  find: "Trouver",
  badRegex: "Expression régulière invalide",
  noResults: "Aucun résultat",
  previous: "Précédent",
  next: "Ensuite",
  closeFind: "Fermer la recherche",
  replaceWith: "Remplacer par",
  matchCase: "Respecter la casse",
  wholeWordShort: "Mot",
  wholeWord: "Mot entier",
  regex: "Expression régulière · remplacement inséré littéralement",
  replace: "Remplacer",
  replaceAll: "Tout remplacer",
  regexError: (error: string) => `Erreur d’expression régulière : ${error}`,
};
