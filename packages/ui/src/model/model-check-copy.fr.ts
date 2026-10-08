import type { ModelCheckCode } from '@baocut/protocol';
import type { CheckSentence, CheckSubject, ModelCheckMessages, TrySubject } from './model-check-copy.ts';

const outputWrong: Record<CheckSubject, string> = {
 transcribe: 'Le modèle fonctionne mais ne reconnaît pas la parole de l’échantillon',
 synthesize: 'Le modèle fonctionne mais l’audio synthétisé est incorrect',
 image: 'Le modèle fonctionne mais l’image est incorrecte',
 separate: 'Le modèle fonctionne mais voix et fond ne sont pas séparés',
};
const checkSentences: Record<ModelCheckCode, (subject: CheckSubject) => CheckSentence> = {
 APP_FILE_MISSING: () => ({ text: 'Un fichier de BaoCut manque ; ce n’est pas un problème de modèle', todo: 'Réinstallez BaoCut. Modèles déjà téléchargés inchangés.' }),
 MODEL_FILES_DAMAGED: () => ({ text: 'Fichiers du modèle endommagés', todo: 'Réparer retélécharge les fichiers endommagés.' }),
 MODEL_OUTPUT_WRONG: (subject) => ({ text: outputWrong[subject], todo: 'Réparez d’abord. Si cela persiste, copiez les détails techniques et envoyez-les-nous.' }),
 MODEL_OUT_OF_MEMORY: () => ({ text: 'Mémoire insuffisante pour charger le modèle', todo: 'Fermez autres grands modèles ou applications gourmandes, puis vérifiez.' }),
 MODEL_WORKER_FAILED: () => ({ text: 'Le processus du modèle en arrière-plan a échoué', todo: 'Vérifiez à nouveau. Si cela persiste, redémarrez BaoCut ou envoyez-nous les détails techniques.' }),
};

export const fr: ModelCheckMessages = {

  label: {
    check: "Vérifier",
    checkFull: "Vérifier le modèle",
    recheck: "Vérifier à nouveau",
    repair: "Réparer…",
    repairSub: "Retélécharge seulement les fichiers endommagés",
    details: "Détails techniques",
    hideDetails: "Masquer les détails techniques",
    copy: "Copier les détails techniques",
    copied: "Détails techniques copiés",
    copyFailed: "Impossible de copier. Sélectionnez et copiez le texte ci-dessus.",
    cancel: "Annuler",
    retry: "Réessayer",
    pickRef: "Choisir un autre enregistrement…",
    useSample: "Utiliser l’échantillon",
  },

  caption:
    "Vérifier confirme le fonctionnement ; Réparer retélécharge seulement les fichiers endommagés. Supprimer conserve les composants partagés utilisés ailleurs.",
  head: {
    running: "Vérification…",
    repairing: "Réparation…",
    failed: "Vérification en échec :",
    notStarted: "Vérification non démarrée :",
  },

  sentence: (text: string) => `${text}.`,
  phase: {
    queued: "En file",
    loading: "Chargement du modèle",
    running: "Exécution d’un court échantillon",
    verifying: "Vérification du résultat",
    repairing: "Retéléchargement des fichiers endommagés ; vérification automatique après réparation",
  },

  checkSentences: checkSentences as Record<ModelCheckCode, (subject: CheckSubject) => CheckSentence>,

  unknown: {
    text: "Le modèle n’a pas fonctionné correctement",
    todo: "Vérifiez à nouveau. Si cela persiste, copiez les détails techniques et envoyez-les-nous.",
  } as CheckSentence,

  notStarted: {
    RUNTIME_UNREACHABLE: {
      text: "Le service BaoCut en arrière-plan ne répond pas",
      todo: "Vérifiez plus tard. Si cela persiste, redémarrez BaoCut.",
    },
    MODEL_IN_USE: {
      text: "Une autre tâche utilise ce modèle",
      todo: "Attendez sa fin ou annulez dans Tâches en arrière-plan, puis vérifiez.",
    },
    MODEL_UNAVAILABLE: { text: "Modèle actuellement inutilisable", todo: "Réparez ou réactivez-le avant de vérifier." },
    RESOURCE_ADMISSION_UNSATISFIABLE: {
      text: "Mémoire insuffisante pour ce modèle",
      todo: "Choisissez un modèle plus petit.",
    },
    WEB_METHOD_NOT_ALLOWED: { text: "Vérification des modèles locaux indisponible dans le navigateur", todo: "Vérifiez dans l’application de bureau." },
    OFFLINE_STRICT: { text: "Hors ligne strict activé", todo: "Désactivez ce mode dans Réglages, puis vérifiez." },
  } as Record<string, CheckSentence>,
  notStartedUnknown: {
    text: "BaoCut a refusé cette vérification",
    todo: "Vérifiez plus tard. Si cela persiste, copiez les détails techniques et envoyez-les-nous.",
  } as CheckSentence,

  detail: {
    code: (code: string) => `Code ${code}`,
    model: (id: string, when: string) => `Le modèle ${id} · ${when}`,
    message: (message: string) => `Message ${message}`,
    passed: (when: string) => `Vérification réussie · ${when}`,
  },

  noticeText: (what: string) => `Dernière vérification de ce modèle en échec : ${what}`,

  refUnreadable: (file: string) => ({
    text: `Impossible de lire votre enregistrement « ${file} ». Fichier peut-être endommagé ou non audio`,
    todo: "Essayez une autre référence ou écoutez d’abord l’échantillon.",
  }),
  refUnknown: "enregistrement",

  trySpeech: {
    noMemory: {
      text: "Mémoire insuffisante pour terminer la synthèse",
      todo: "Fermez autres grands modèles ou applications gourmandes et réessayez.",
    },
    modelError: { text: "Le modèle a échoué sans produire d’audio", todo: "Vérifiez le modèle pour voir le motif." },
    other: (message: string) => ({
      text: `Impossible de synthétiser : ${message}`,
      todo: "Réessayez. Si cela persiste, consultez les détails dans Tâches en arrière-plan.",
    }),
    notStarted: (message: string) => ({ text: `Impossible de démarrer la synthèse : ${message}`, todo: "" }),
    noticeTodo: (todo: string) => `${todo} Un aperçu échouera probablement aussi.`,
  } as TrySubject,

  tryImage: {
    noMemory: {
      text: "Mémoire insuffisante pour terminer le dessin",
      todo: "Fermez les autres grands modèles et réessayez, ou réduisez les étapes.",
    },
    modelError: { text: "Le modèle a échoué sans image", todo: "Vérifiez le modèle pour voir le motif." },
    other: (message: string) => ({
      text: `Impossible de dessiner : ${message}`,
      todo: "Réessayez. Si cela persiste, consultez les détails dans Tâches en arrière-plan.",
    }),
    notStarted: (message: string) => ({ text: `Impossible de démarrer le dessin : ${message}`, todo: "" }),
    noticeTodo: (todo: string) => `${todo} Un test d’image échouera probablement aussi.`,
  } as TrySubject,
};
