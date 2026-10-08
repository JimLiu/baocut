import type { DubOriginalAudio } from '@baocut/protocol';
import type { DubMessages, DubRegenMessages, TimelineDubMessages } from './dub-copy.ts';

import { pluralForm } from '@baocut/protocol';
const sentences = (n: number) => `${n} ${pluralForm('fr', n, { one: 'phrase', other: 'phrases' })}`;
const these = (n: number) => n === 1 ? 'cette phrase' : `${n} phrases`;

export const frDub: DubMessages = {

  title: "Doublage traduit",
  back: "Retour",
  web: "Le doublage traduit nécessite l’application de bureau",
  webBody: "BaoCut dans le navigateur ne fournit pas les flux fixes (pipelines.*) ; le doublage traduit ne peut pas démarrer ici. Ouvrez cette vidéo dans l’application de bureau.",
  summary: (language: string, count: number | null, translate: boolean) =>
    `${translate ? `Traduit d’abord en ${language}, puis synthétise` : `Utilise la traduction existante ${language} et synthétise`} la parole ${count === null ? "phrase par phrase" : `pour ${sentences(count)} une à une`}, aligne chaque phrase sur l’horaire original et les écrit dans la timeline comme groupe de doublage`,
  language: "Langue du doublage",
  languagePicker: "Langue du doublage",
  languageLine: (translate: boolean, count: number | null) =>
    `${translate ? "Aucune traduction dans cette langue · traduit d’abord" : "Utilise la traduction existante · aucune nouvelle traduction"}${count === null ? "" : ` · ${sentences(count)}`}`,
  allTaken: "Aucune langue disponible pour le doublage.",
  staleNote: (n: number) =>
    `${sentences(n)} dans cette traduction ${pluralForm('fr', n, { one: "est obsolète", other: "sont obsolètes" })} (original modifié ou marqué obsolète). Elles ne seront pas synthétisées et figureront dans le résumé. Retraduisez-les dans le panneau Sous-titres pour un doublage complet.`,
  source: "Originale",
  sourcePicker: "Transcription à doubler",
  sourceLine: (language: string, count: number | null) => (count === null ? language : `${language} · ${sentences(count)}`),
  voiceModel: "Modèle vocal",
  voiceModelPicker: "Modèle de synthèse vocale",
  voiceModelsLoading: "Chargement des modèles vocaux…",
  manageVoiceModels: "Gérer les modèles vocaux…",
  ttsMissingTitle: "Aucun modèle vocal disponible",
  goTts: "Ouvrir Modèles › Synthèse vocale",
  voice: "Voix par défaut",
  voicePicker: "Pour les locuteurs sans voix propre",
  voiceDefault: "Défaut du modèle",
  voiceCustom: "Identifiant de voix",
  voiceCustomPlaceholder: "Identifiant de voix du compte fournisseur",
  voiceHint: "Les locuteurs ayant une voix ci-dessous l’utilisent ; les autres utilisent celle choisie ici.",
  voiceCustomEmpty: "Saisissez un identifiant de voix ou choisissez une autre voix",
  speakers: "Locuteurs",
  speakersAside: (n: number) => `${n}`,
  speakersNone: "Cette transcription n’a aucune information de locuteur ; chaque phrase utilise la voix par défaut ci-dessus.",
  speakersNote: "Associations enregistrées dans cette vidéo (modification annulable) et réutilisées. Priorité : associée → voix par défaut → défaut du modèle.",
  speakerLine: (count: number) => sentences(count),
  speakerBinding: (name: string) => `Voix associée à ${name}`,
  bindingNone: "Aucun",
  bindingOther: (label: string) => `${label} (associée ailleurs)`,
  bindingIgnored: (provider: string) => `La voix associée vient d’un autre fournisseur et n’est pas utilisée avec ${provider}`,
  bindingReadOnly: "La vidéo est en lecture seule ; les voix des locuteurs ne peuvent pas être modifiées.",
  bindingFailed: (message: string) => `Impossible de changer la voix du locuteur : ${message}`,
  bindingLoading: "Chargement des voix des locuteurs…",
  bindingReadFailed: (message: string) => `Impossible de lire les voix associées dans cette vidéo : ${message}`,
  bindingSaved: (name: string) => `Voix associée à ${name}`,
  bindingCleared: (name: string) => `Supprimé : ${name} : association de voix`,
  sourceVideo: "Associée",
  sourceParams: "Voix par défaut",
  sourceDefault: "Défaut du modèle",

  effective: (label: string, source: string | null) => (source ? `Utilise : ${label} (${source})` : `Utilise : ${label}`),
  speakerWarning: (reason: string) => `Les phrases de ce locuteur ne seront pas synthétisées : ${reason}`,
  manageVoices: "Gérer Mes voix…",
  mix: "Mixage",
  separate: "Séparer le fond sonore",
  separateHint: "Le doublage remplace seulement la parole ; musique et ambiance restent",
  separateMissing: "Aucun modèle de séparation sur cet ordinateur ; même activée, la séparation est ignorée et l’audio original est traité en entier.",
  installSeparate: "Installer le modèle de séparation…",
  original: "Audio original",
  originalPicker: "Traitement de l’audio original pendant le doublage",
  originalLabel: { duck: "Atténuer", mute: "Couper le son", keep: "Conserver" } satisfies Record<DubOriginalAudio, string>,

  mixHint: (o: { separated: boolean; original: DubOriginalAudio; duckDb: number }) =>
    o.original === 'keep'
      ? `L’audio original reste inchangé et joue sous le doublage${o.separated ? " ; rien n’est séparé lorsqu’il est conservé" : ""}.`
      : `${o.separated ? "Le fond sonore a sa propre piste ; l’original conserve seulement la parole, qui est" : "Sans séparation, l’audio original entier est"} ${o.original === 'mute' ? "muet" : `atténué de −${o.duckDb} dB`}. Vous pouvez revenir à l’audio original depuis l’en-tête de piste de doublage à tout moment.`,
  duckDb: "Atténuation (dB)",
  duckLabel: "Atténuer",
  duckUnit: "dB",
  translate: "Traduction",
  textModel: "Modèle de texte",
  textModelPicker: "Modèle de texte pour la traduction",
  textModelsLoading: "Chargement des modèles de texte…",
  manageTextModels: "Gérer les modèles de texte…",
  textMissingTitle: "Aucun modèle de texte disponible",
  goLlm: "Ouvrir Modèles › Génération de texte",
  noStructured: "Aucune sortie structurée · traduction impossible",
  style: "Indication de style",
  stylePlaceholder: "Par exemple : oral, concis ; conserver les noms originaux",
  styleHint: "Facultatif ; 500 caractères maximum.",
  cta: (language: string) => `Doubler en ${language}`,

  ctaHint: (language: string, stems: { separated: boolean; original: DubOriginalAudio }) => {
    const tracks = [`« Doublage · ${language} »`];
    if (stems.separated && stems.original !== 'keep') tracks.push("« Fond sonore »");
    if (stems.separated && stems.original === 'duck') tracks.push("« Voix »");
    const list = tracks.length === 1 ? tracks[0] : `${tracks.slice(0, -1).join(", ")} et ${tracks[tracks.length - 1]}`;
    return `Une fois terminé, écrit sur ${pluralForm('fr', tracks.length, { one: "la piste", other: "les pistes" })} ${list} de la timeline ; annulable en un clic. Les modèles en ligne sont facturés par appel.`;
  },
  noSpeechTitle: "Aucune transcription à doubler",
  noSpeech: "Le doublage suit les phrases d’une transcription. Transcrivez d’abord un média avec « Générer des sous-titres » dans le panneau Sous-titres.",
  busy: "Un doublage est déjà en cours dans cette vidéo ; attendez sa fin avant un autre.",
  readOnly: "La vidéo est en lecture seule ; doublage impossible.",

  submitting: "Soumission du doublage",
  queued: "En file",
  running: (language: string) => `Doublage · ${language}`,
  stepUnits: (step: 'translate' | 'synthesize', done: number, total: number | null) =>
    `${step === 'translate' ? "Traduit" : "Synthétisé"} ${done}${total ? ` / ${total}` : ""} phrase${pluralForm('fr', total ?? done, { one: "", other: "s" })}`,
  sentences: (running: number, failed: number) =>
    [running ? `${sentences(running)} en synthèse` : "", failed ? `${sentences(failed)} en échec` : ""].filter(Boolean).join(" · "),
  cancel: "Annuler le doublage",
  cancelled: "Doublage annulé",
  cancelFailed: (message: string) => `Impossible d’annuler le doublage : ${message}`,
  liveNote: "Le Runtime écrit directement sur la timeline à la fin ; vous pouvez annuler à tout moment et quitter cette page.",
  foreign: "Ce doublage n’a pas été démarré ici. Vérifiez la timeline à la fin ; utilisez Annuler dans l’éditeur.",

  grantTitle: (recipient: string) => `Aucune autorisation d’envoyer la transcription à ${recipient}`,
  grantBody:
    "Le doublage envoie au fournisseur la traduction à synthétiser (et l’original si traduction absente). Accordez une autorisation limitée à cette vidéo pour continuer ; rien n’est envoyé sans elle.",
  grantAction: "Autoriser et démarrer",
  grantRetryAction: "Autoriser et réessayer",
  grantDialogTitle: "Autoriser le partage de données",
  grantDialogIntro: "Après confirmation, BaoCut enregistre cette autorisation et continue le doublage :",
  grantConfirm: "Autoriser et continuer",
  grantCancel: "Pas maintenant",
  granting: "Autorisation en cours…",
  grantFailed: (message: string) => `Impossible d’accorder l’autorisation : ${message}`,
  grantStillRefused: "Toujours refusé après autorisation",
  grantNext: "Si traduction et synthèse utilisent des fournisseurs différents, chacun nécessite son autorisation.",
  commands: "Ligne de commande",

  notConfigured: "Doublage pas encore disponible",
  submitFailed: "Impossible de démarrer le doublage",
  failed: "Échec du doublage",
  interrupted: "Doublage interrompu",
  retry: "Réessayer",
  retryFailed: (message: string) => `Impossible de réessayer : ${message}`,
  retryCharges:
    "Réessayer reprend à l’étape d’arrêt. Si c’était « Traduire », toute l’étape est relancée ; les lots déjà traduits rappellent le modèle et peuvent être facturés à nouveau.",
  retryPartial: "Réessayer reprend à « Synthétiser les phrases » : phrases déjà synthétisées réutilisées, seules celles en échec ou restantes sont synthétisées.",
  retryFree: "Réessayer reprend à l’étape d’arrêt ; les étapes terminées sont réutilisées sans nouvel appel au modèle.",
  retryFrozen:
    "Les voix associées étaient figées au démarrage : corriger une voix (reclonage, déclaration du propriétaire) aide une nouvelle tentative, mais changer les associations nécessite un nouveau doublage.",
  failedUnits: (n: number) => `${sentences(n)} en échec de synthèse`,
  stoppedAt: (synthesized: number, remaining: number) => `Arrêt après synthèse de ${sentences(synthesized)} ; ${remaining} restantes`,
  dismiss: "OK",

  doneTitle: (language: string) => `Doublé en ${language}`,
  doneToast: (language: string, placed: number) => `Doublé en ${language} · ${sentences(placed)} placées sur la timeline`,
  placed: (placed: number, total: number) => `${placed} / ${total} phrases placées sur la timeline`,
  fitHead: "Destination de chaque phrase",
  speakersHead: "Voix des locuteurs",
  speakerUnits: (n: number) => sentences(n),
  speakerNone: "Aucun locuteur",
  voiceFailedHead: "Les phrases de ces locuteurs n’ont pas été synthétisées",
  voiceFailedLine: (name: string, n: number, reason: string) => `${name} · ${sentences(n)} · ${reason}`,
  voiceFailedFix:
    "Ce doublage est terminé et ne peut pas être relancé : annulez le groupe → corrigez la voix (reclonage, déclaration du propriétaire) ou l’association → doublez à nouveau.",
  synthesisLine: (calls: number, retries: number, failures: number, reused: number) =>
    [
      `${calls} appel${pluralForm('fr', calls, { one: "", other: "s" })}`,
      retries ? `${retries} renvoyées` : "",
      failures ? `${failures} en échec` : "",
      reused ? `${sentences(reused)} réutilisées` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  translationCreated: "La nouvelle traduction est enregistrée dans la vidéo (annuler le doublage ne la supprimera pas)",
  translationUsed: "Traduction existante utilisée",
  glossaryUsed: (n: number) => `Utilisé : ${n} ${pluralForm('fr', n, { one: "glossaire", other: "glossaires" })}`,
  warnings: "Avertissements",
  undo: "Annuler ce doublage",
  undoing: "Annulation…",
  undone: "Doublage annulé",
  undonePartial:
    "Clips, mises en sourdine et atténuations du doublage annulés. La piste vide et le document du plan restent dans la vidéo (aucune opération de suppression de piste ou document dans le protocole).",
  undoLabel: (language: string) => `Annuler le doublage (${language})`,
  undoFailed: "Impossible d’annuler ce doublage",
  undoNotOpen: "Ouvrez d’abord cette vidéo pour annuler le doublage.",
  close: "Fermer",
  again: "Doubler à nouveau",
  providerFallback: "ce fournisseur",
  unknownLanguage: "Langue inconnue",
};

export const frTimelineDub: TimelineDubMessages = {
  trackLabel: (language: string) => `Doublage · ${language}`,

  stemTrackLabel: (stem: 'background' | 'vocals', language: string) => `${stem === 'vocals' ? "Voix" : "Contexte"} · ${language}`,

  rate: (rate: number, fast: boolean) => `${rate.toFixed(2)}×${fast ? " · trop rapide" : ""}`,

  stretching: (rate: number, seconds: number) => `${rate.toFixed(2)}× · ${seconds.toFixed(2)} s`,
  tip: (parts: { text: string; speaker: string | null; rate: string; muted: boolean; manual: boolean; editable: boolean }) =>
    [
      parts.text,
      parts.speaker,
      parts.rate,
      parts.muted ? "Muet" : "",
      parts.manual ? "Vitesse modifiée manuellement" : "",
      parts.editable ? "Glissez le bord droit pour changer la durée · clic droit pour plus" : "",
    ]
      .filter(Boolean)
      .join(" · "),
  menuLabel: (title: string) => `Menu de doublage pour « ${title} »`,
  selection: (n: number) => `${sentences(n)} sélectionnées`,
  count: (n: number) => (n > 1 ? `Ces ${n} phrases` : "Cette phrase"),
  listen: "Lire cette phrase",
  listenHint: (timecode: string, seconds: number, rate: string) => `${timecode} · ${seconds.toFixed(1)} s${rate ? ` · ${rate}` : ""}`,
  mute: (allMuted: boolean, n: number) => `${allMuted ? "Réactiver le son" : "Couper le son"} ${these(n)}`,
  muteHint: (allMuted: boolean): string => (allMuted ? "Restaurer le doublage de ces phrases" : "Ces phrases deviennent muettes · aussi dans les exports"),
  remove: (n: number) => `Supprimer ${these(n)}`,
  removeHint: "Retire de la piste de doublage · annulable",
  removeGroup: "Retirer ce groupe de doublage",
  removeGroupHint: (bed: boolean) =>
    `${bed ? "Retire aussi son fond sonore" : "Retire tout le doublage dans cette langue"} · l’audio original qu’il avait coupé revient`,
  labelMute: "Couper le son du doublage",
  labelUnmute: "Rétablir le son du doublage",
  labelRemove: "Supprimer le doublage",
  labelRemoveGroup: (language: string) => `Retirer le doublage (${language})`,
  labelStretch: "Changer la vitesse du doublage",
  muted: (n: number) => `Son coupé pour ${sentences(n)} de doublage`,
  unmuted: (n: number) => `Son rétabli pour ${sentences(n)} de doublage`,
  removed: (n: number) => `Supprimé : ${sentences(n)} de doublage`,
  groupRemoved: (language: string) =>
    `« Doublage · ${language} » retiré · la piste vide et le document du plan restent dans la vidéo`,
  planUnread: "Impossible de lire le plan de doublage : son audio original coupé n’a pas été restauré. Vous pouvez rétablir le son sur les clips originaux.",
};

export const frDubRegen: DubRegenMessages = {

  headMenu: (label: string) => `« ${label} » : piste`,
  headLine: (c: { total: number; fast: number; muted: number; failed: number; queued: number }) =>
    [
      sentences(c.total),
      c.failed ? `${c.failed} non synthétisées` : "",
      c.fast ? `${c.fast} trop rapides` : "",
      c.muted ? `${c.muted} muettes` : "",
      c.queued ? `${c.queued} en régénération` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  listenDub: "Écouter le doublage",
  listenDubHint: (o: { bed: boolean; duck: boolean; others: boolean }) =>
    `Doublage de ce groupe${o.bed ? " + fond sonore" : ""} · ${o.duck ? "original atténué" : "original muet"}${o.others ? " · autres langues désactivées" : ""}`,
  listenDubKeep: "Ce groupe a conservé l’audio original sans enregistrer les parties concernées ; utilisez « Écouter les deux »",
  listenOriginal: "Écouter l’original",
  listenOriginalHint: (others: boolean) => `Restaure l’audio original de la vidéo · ${others ? "tous les groupes de doublage" : "ce groupe de doublage"} muettes`,
  listenBoth: "Écouter les deux",
  listenBothHint: (bed: boolean) => `Pour comparer${bed ? " · fond sonore de ce groupe désactivé" : ""}`,
  sourceLabel: { dub: "Écouter le doublage", original: "Écouter l’original", both: "Écouter les deux" },
  sourceDone: {
    dub: (language: string) => `Écoute de « Doublage · ${language} »`,
    original: "Écoute de l’original · doublage muet",
    both: "Lecture de l’original et du doublage ensemble",
  },
  regenSome: (n: number) => (n ? `Régénérer ${sentences(n)}…` : "Régénérer…"),
  regenSomeHint: (failed: number, fast: number) =>
    failed || fast
      ? `${[failed ? `${failed} non synthétisées` : "", fast ? `${fast} trop rapides` : ""].filter(Boolean).join(" · ")} · vous pouvez d’abord modifier la traduction`
      : "Aucune phrase en échec ou trop rapide",
  redub: "Doubler à nouveau…",
  redubHint: "Ouvre Doublage traduit : changez langue ou voix et refaites tout le groupe",
  readOnly: "La vidéo est en lecture seule",

  regenBlocks: (n: number) => `Régénérer ${these(n)}`,
  regenBlocksHint: "Synthétise à nouveau avec même traduction et voix · nouvelle graine · ancienne prise conservée",
  retext: "Modifier la traduction et redoubler…",
  retextHint: "Vérifier les durées et modifier la traduction, puis redoubler seulement ces phrases",
  inQueue: "Des phrases sont en cours de régénération",

  queued: "Régénération…",
  queuedTip: (text: string) => `${text} · en régénération`,
  version: (k: number, seed: number | null) => (seed === null ? `Prise ${k}` : `Prise ${k} · graine ${seed}`),

  submitted: (n: number) => `Régénération démarrée pour ${sentences(n)} de doublage`,
  submitFailed: (message: string) => `Impossible de démarrer la régénération : ${message}`,
  grantRefused: (recipient: string) =>
    `La régénération envoie la traduction à ${recipient}, sans autorisation pour l’instant. Accordez-la dans Réglages ou recommencez depuis Doublage traduit`,
  busy: "Ce groupe est en cours de soumission ; un instant",
  done: (replaced: number, total: number) =>
    replaced === total ? `Régénéré : ${sentences(replaced)} de doublage` : `Régénéré : ${replaced}/${total} phrases de doublage`,
  doneNone: "Aucune phrase n’a reçu de nouvelle prise",
  notPlaced: (status: string, n: number) =>
    status === 'overlong'
      ? `${sentences(n)} ne tenaient pas ; ancienne prise conservée`
      : status === 'stale'
        ? `${sentences(n)} avaient une traduction obsolète et n’ont pas été synthétisées`
        : status === 'voice-unavailable'
          ? `${sentences(n)} avaient une voix indisponible et n’ont pas été synthétisées`
          : `${sentences(n)} ne sont pas sur la timeline`,
  failed: (message: string) => `Régénération inachevée : ${message}`,
  cancelled: "Régénération annulée",
  undo: "Annuler",
  undoMissing: "Modification de cette régénération introuvable ; utilisez Annuler dans l’éditeur",
  labelRetext: "Modifier la traduction (redoubler)",

  fitTitle: (n: number) => `Modifier la traduction et redoubler ${sentences(n)}`,
  fitIntro:
    "Vous modifiez la phrase traduite prononcée (marquée vérifiée après modification) ; ses sous-titres ne sont pas redécoupés. Chaque phrase est resynthétisée avec une nouvelle graine ; ancienne prise conservée.",
  fitDub: (seconds: number, rate: string) => `Doublage ${seconds.toFixed(1)} s${rate ? ` · ${rate}` : ""}`,
  fitVoice: "Non synthétisée : voix indisponible",
  fitOverlong: (seconds: number | null) => (seconds === null ? "Non placée : trop longue" : `Non placée : ${seconds.toFixed(1)} s de trop`),
  fitLoading: "Chargement de la traduction…",
  fitUnreadable: (message: string) => `Impossible de lire la traduction du doublage (${message}) ; redoublage depuis la traduction originale uniquement`,
  fitMissing: "Cette phrase n’est pas dans la traduction ; redoublage depuis le texte du plan",
  fitText: (index: number) => `Traduction de la phrase ${index}`,
  fitCancel: "Annuler",
  fitSubmit: (n: number, changed: number) => (changed ? `Modifier ${changed} et redoubler ${sentences(n)}` : `Redoubler ${sentences(n)}`),
  fitBusy: "Soumission…",

  takesTitle: "Prises",
  takesAside: (n: number) => `${n} prise${pluralForm('fr', n, { one: "", other: "s" })}`,
  takeCurrent: "Actuelle",
  takeUse: "Passer à cette prise",
  takeLine: (seed: number | null, seconds: number | null, tempo: number | null) =>
    [
      seed !== null ? `graine ${seed}` : "",
      seconds !== null ? `${seconds.toFixed(1)} s` : "non placée",
      tempo !== null && Math.abs(tempo - 1) >= 0.005 ? `${tempo.toFixed(2)}×` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  takeUnavailable: "Cette prise n’est pas sur la timeline ou son média est introuvable",
  takesNote: "Chaque régénération enregistre une prise ; revenir à une ancienne est annulable et ne relance pas la synthèse.",
  takeName: (k: number) => `Prise ${k}`,
  labelSwitchTake: (k: number) => `Passer à la prise de doublage ${k}`,
  switched: (k: number) => `Passé à la prise ${k}`,
  regenThis: "Régénérer cette phrase",
  unreadableFormat: "Format non reconnu",
  unreadableNoTranslation: "Le plan n’a aucune traduction",
};
