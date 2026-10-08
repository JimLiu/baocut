import type { SpeakersMessages } from './speakers-copy.ts';
import { pluralForm } from '@baocut/protocol';

const plural = (n: number, one: string, many: string) => `${n} ${pluralForm('fr', n, { one, other: many })}`;

export const fr: SpeakersMessages = {
  title: "Identifier les intervenants",
  back: "Retour",
  background: "En cours en arrière-plan",

  cardTitle: "Identifier qui parle",
  cardBody: "Réidentifie les locuteurs par empreinte vocale et nomme les sous-titres et la transcription. Vous vérifiez d’abord ; rien ne change avant application.",
  who: "Choisir",
  local: "Modèle local d’empreinte vocale",
  localSub: "Reste sur cet ordinateur",
  agent: "Confier à l’Agent",
  agentSub: "Exécuté dans la session de cette vidéo",
  scope: "Portée",
  scopeAll: "Toute la vidéo",
  scopeLocal: (scope: string) => `L’identification locale couvre toute la vidéo ; pour identifier seulement « ${scope} », confiez-le à l’Agent.`,
  packHint: (size: string | null) =>
    `Le modèle local d’empreinte vocale${size ? ` (environ ${size})` : ""} est téléchargé au premier lancement, puis fonctionne hors ligne.`,
  packDownloading: (pct: number | null) =>
    `Téléchargement du modèle local d’empreinte vocale${pct === null ? "…" : ` · ${pct}%`} ; l’identification démarrera à la fin.`,
  packUnlisted: "Aucun modèle local d’empreinte vocale sur cet ordinateur ; seul l’Agent peut le faire.",
  noSpeech: "Cette vidéo n’est pas encore transcrite. Transcrivez-la d’abord dans Sous-titres, puis identifiez les locuteurs.",
  manySpeech: "La vidéo a plusieurs transcriptions ; la première est utilisée",
  start: "Début",
  startHint: "À la fin, une page de vérification s’ouvre ; seul cet outil demande confirmation avant application.",
  agentHint: "Envoie cette demande à la session de la vidéo ; l’Agent démarre immédiatement.",
  readOnly: "La vidéo est en lecture seule ; identification des locuteurs impossible.",
  web: "Identification des locuteurs indisponible dans le navigateur",
  webBody: "L’identification utilise le modèle local d’empreinte vocale sur cet ordinateur. Utilisez l’application de bureau BaoCut.",

  submitting: "Soumission…",
  queued: "En file d’attente…",
  running: "Identification des locuteurs…",
  activity: (stage: string) => `Modèle local d’empreinte vocale · ${stage}`,
  runNote: "Vous pouvez continuer le montage · identification en arrière-plan et page de vérification à la fin ; aucune modification directe de la transcription.",
  cancel: "Annuler",
  cancelled: "Identification des locuteurs annulée",
  cancelFailed: (message: string) => `Impossible d’annuler : ${message}`,

  found: (n: number) =>
    `Trouvé : ${plural(n, "locuteur", "locuteurs")}. Écoutez les échantillons pour confirmer les identités, cliquez sur un nom pour le modifier, puis appliquez.`,
  same: "Les limites des locuteurs correspondent aux étiquettes actuelles ; seuls les noms changeront.",
  newSpeaker: "Nouveau",
  rename: "Renommer",
  renameLabel: (name: string) => `Renommer « ${name} »`,
  sentences: (n: number) => plural(n, "phrase", "phrases"),
  clipOff: "Cette phrase a été coupée et n’est pas sur la timeline",
  splitTitle: (n: number) => `${plural(n, "traduction", "traductions")} seront redécoupées ; aucune retraduction nécessaire`,
  splitBody: "Changer les limites des locuteurs affecte seulement le découpage des lignes ; texte traduit inchangé.",
  skipped: (n: number) =>
    `${plural(n, "traduction", "traductions")} dans un ancien format ne seront pas redécoupées ; leurs phrases ne s’aligneront plus et seront marquées obsolètes.`,
  apply: "Appliquer",
  applyHint: "Vous pouvez annuler à tout moment après application.",
  discard: "Abandonner ce résultat",

  engine: "Modèle local d’empreinte vocale",
  undoneReceipt: "Annulé · étiquettes des locuteurs restaurées",
  undo: "Annuler",
  redo: "Rétablir",
  again: "Relancer",
  done: "Terminé",
  splitDone: (n: number) => `${plural(n, "traduction a été", "traductions ont été")} redécoupées aux nouvelles limites des locuteurs, sans retraduction.`,
  undoneTitle: "Annulé",
  undoneBody: "« Relancer » recommence ; vos réglages d’identification sont conservés.",
  captionsStale: (n: number) =>
    pluralForm('fr', n, { one: `${n} piste de sous-titres vient d’une ancienne transcription et n’a pas été mise à jour.`, other: `${n} pistes de sous-titres viennent d’une ancienne transcription et n’ont pas été mises à jour.` }),
  gotoCaptions: "Ouvrir Sous-titres",
  noUndo: "Rien à annuler : résultat identique aux étiquettes actuelles.",
  undoFailed: "Impossible d’annuler",
  redoFailed: "Impossible de rétablir",

  failed: "Échec d’identification des locuteurs",
  interrupted: "Identification des locuteurs interrompue",
  submitFailed: "Impossible de démarrer l’identification des locuteurs",
  applyFailed: "Impossible d’appliquer le résultat",
  applyStale: "La transcription ou les traductions ont changé depuis l’identification. Relancez, puis appliquez.",
  badResult: "Le résultat est illisible. Relancez.",
  retry: "Réessayer",
  decide: "Résoudre dans Tâches en arrière-plan",
  dismiss: "OK",
  chapterScope: (n: number, label: string) => `Le chapitre ${n} · ${label}`,
  manySpeechNamed: (name: string) => `La vidéo a plusieurs transcriptions ; utilisation de la première, « ${name} »`,
};
