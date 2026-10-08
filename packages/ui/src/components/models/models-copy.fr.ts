import type { OnlineCapability } from '@baocut/protocol';
import type { RefreshKind } from '../../model/models-cloud.ts';
import type { ModelsMessages } from './models-copy.ts';

import { pluralForm } from '@baocut/protocol';
const count = (n: number, one: string, many: string) => `${n} ${pluralForm('fr', n, { one, other: many })}`;

export const fr: ModelsMessages = {
  page: {
    title: "Modèles",
    nav: "Navigation Modèles",
    navSection: "Capacités",
    categories: "Catégories de modèles",
    tabs: (label: string) => `${label} : gestion des modèles`,
    offline: "Les modèles apparaissent après connexion au Runtime.",
    loading: "Chargement des modèles…",
    goAgent: "Aller à Réglages › Agent",
  },
  local: {
    defaultLabel: "Modèle par défaut",
    defaultDesc: "Présélectionné pour les nouvelles vidéos et utilisé pour la transcription en ligne de commande.",
    separateDefaultDesc: "Sépare le fond sonore des doublages traduits sans modèle spécifié et des doublages en ligne de commande.",
    auto: "Automatique",
    autoUses: (id: string) => `Automatique utilise actuellement ${id}.`,
    otherDefault: (name: string) => `Le défaut actuel est ${name} (défini dans les modèles cloud) ; choisir un modèle local ici le remplace.`,
    defaultSet: "Défaut défini",
    defaultFailed: (message: string) => `Impossible de définir le défaut : ${message}`,
    installed: "Installé",
    available: "Téléchargeable",
    emptyInstalled: "Aucun modèle installé.",
    emptyAvailable: "Tous les modèles de cette catégorie sont installés.",
    remove: "Supprimer",
    reenable: "Réactiver",
    reenabled: (id: string) => `Réactivé : ${id}`,
    reenableFailed: (message: string) => `Impossible de réactiver : ${message}`,
    emptyTitle: (label: string) => `Aucun modèle local pour ${label} pour l’instant`,
    emptyBody:
      "Le dossier local contient seulement des paquets de reconnaissance vocale, synthèse vocale, génération d’images et séparation sonore. Pas encore de modèles locaux pour cette catégorie.",
  },

  imageLocal: {
    defaultDesc: "Présélectionné pour les nouvelles tâches image. Sans défaut, choix à chaque fois ; choix manuel toujours prioritaire.",
    cloudDefault: (name: string) =>
      `Le défaut est un modèle cloud (${name}) ; changez-le dans Réglages › Modèles cloud. Choisir un modèle local le remplace.`,
    noInstalled: "Aucun modèle d’image installé. Téléchargez-en un ci-dessous.",
    licenseUse: "Ses images sont réservées aux contenus non commerciaux ; choisissez un autre modèle pour une vidéo à usage commercial.",

    tryButton: "Essayer",
    tryTitle: (name: string) => `Essayer ${name}`,
    tryPromptTitle: "Prompt de test · une image 512 × 512",
    tryPromptLabel: "Invite de test",
    tryPlaceholder: "Décrivez l’image",
    tryChars: (n: number, max: number) => `${n} / ${max} caractères`,
    trySample: "Autre exemple",
    tryFacts: (steps: number) => `1:1 · 512 × 512 · ${steps} étapes · 1 image · hors ligne · utilise le créneau de tâches lourdes`,
    tryNote:
      "Dessine une petite image localement pour vérifier le résultat, sans réseau. Utilise le créneau lourd ; autres tâches locales attendent. Fermer la fenêtre ne l’arrête pas ; exécution aussi dans Tâches en arrière-plan.",
    tryReady: "Prêt à démarrer",
    tryRunning: (steps: number) => `Dessin 512² · ${steps} étapes…`,
    tryDone: (seconds: number | null) => (seconds !== null ? `Terminé · ${seconds}s` : "Terminé"),
    tryFailed: "Impossible de dessiner l’image",
    tryResult: "Résultat du test",
    tryImageAlt: "Image générée par le test",
    tryOpenFailed: (message: string) => `Impossible d’ouvrir l’image résultat : ${message}`,
    tryWhere: "Comme les autres images générées, résultat dans Outils › Générer une image, pas dans la vidéo",
    tryDownload: "Télécharger l’image",
    tryCopy: "Copier le prompt",
    tryClose: "Fermer",
    tryStopWaiting: "Arrêtez d'attendre",
    tryStart: "Lancer la génération",
    tryAgain: "En générer une autre",
    tryBusy: "Génération…",

    tryFileName: (id: string) => `image-try-${id}`,
  },
  cloud: {
    heading: {
      transcribe: "Transformez le discours en transcription",
      synthesizeSpeech: "Lire le texte à voix haute",
      generateImage: "Transformer une description en image",
      generateText: "Traduire les sous-titres et générer du texte",
    } satisfies Record<OnlineCapability, string>,
    lede: {
      transcribe: "Reçoit de l’audio et renvoie le texte reconnu. Un seul modèle de reconnaissance par défaut, partagé avec la page locale.",
      synthesizeSpeech: "Reçoit du texte et renvoie la parole. Utilisé pour synthèse et doublage ; en ligne et facturé, généralement par caractère.",
      generateImage:
        "Reçoit un prompt et renvoie une image. En ligne, facturé par image. Codex CLI peut aussi dessiner sans clé sur votre abonnement ; interrupteur sur la première carte ci-dessous.",
      generateText:
        "Reçoit des instructions et renvoie du texte. Pour traductions, doublages traduits et Outils › Génération de texte ; en ligne, facturé au token.",
    } satisfies Record<OnlineCapability, string>,
    defaultLabel: {
      transcribe: "Modèle vocal cloud par défaut",
      synthesizeSpeech: "Modèle de synthèse vocale cloud par défaut",
      generateImage: "Modèle cloud d’image par défaut",
      generateText: "Modèle de texte par défaut",
    } satisfies Record<OnlineCapability, string>,
    defaultDesc: {
      transcribe:
        "Utilisé sans modèle nommé en transcription. Un seul défaut : choisir un cloud ici remplace le local ; « Utiliser un modèle local » efface le cloud et revient à la sélection locale automatique.",
      synthesizeSpeech:
        "Utilisé sans modèle nommé en synthèse ou doublage. « Choisir à chaque fois » = aucun défaut ; requêtes sans modèle refusées, choix lors de l’utilisation.",
      generateImage:
        "Utilisé sans modèle nommé pour images, bcut image ou Agent. Codex n’est jamais choisi pour vous ; sélectionnez-le ici comme défaut. « Choisir à chaque fois » = aucun défaut.",
      generateText:
        "Utilisé sans modèle nommé pour traduction, doublage traduit ou texte. « Choisir à chaque fois » = aucun défaut ; le Runtime ne choisit pas pour vous, requêtes sans modèle refusées.",
    } satisfies Record<OnlineCapability, string>,

    localDefaultDesc: "Défini sur la page locale · « Choisir à chaque fois » efface le défaut",
    none: {
      transcribe: "Utiliser un modèle local",
      synthesizeSpeech: "Choisissez à chaque fois",
      generateImage: "Choisissez à chaque fois",
      generateText: "Choisissez à chaque fois",
    } satisfies Record<OnlineCapability, string>,
    noneDesc: {
      transcribe: "Revenir à la sélection automatique sur la page locale",
      synthesizeSpeech: "Choisir lors de la synthèse ou du doublage",
      generateImage: "Choisir lors de la génération d’images",
      generateText: "Choisir à l’utilisation (le Runtime ne choisit pas pour vous)",
    } satisfies Record<OnlineCapability, string>,
    codexItem: "Codex CLI · Images",
    codexItemDesc: "Votre abonnement Codex · une image à la fois · 5–10× plus lent",
    unavailable: "Indisponible",
    pickerEmpty: { image: "Connectez un fournisseur ou activez les images Codex pour choisir", other: "Connectez un fournisseur pour choisir" },
    defaultSet: "Modèle par défaut modifié",
    defaultFailed: (message: string) => `Impossible de changer le modèle par défaut : ${message}`,
    providers: "Fournisseurs",
    providersDesc: "Tous les types d’un fournisseur partagent sa clé. Un test concerne seulement le modèle testé.",

    providersExtra: {
      transcribe: "",
      synthesizeSpeech: " Synthèse vocale généralement facturée par caractère.",
      generateImage: " Images facturées par image ; conditions du fournisseur applicables.",
      generateText: " Texte facturé au token.",
    } satisfies Record<OnlineCapability, string>,
    addCustom: "Ajouter un fournisseur personnalisé",
    connected: "Connecté",
    manageKey: "Gérer la clé",
    connect: "Connecter",
    addModel: "Ajouter un modèle",
    defaultChip: "Par défaut",
    expand: (name: string) => `Afficher ${name} modèles`,
    collapse: (name: string) => `Masquer ${name} modèles`,
    probe: {
      transcribe: "Test de discours",
      synthesizeSpeech: "Tester la synthèse",
      generateImage: "Tester l’image",
      generateText: "Génération de tests",
    } satisfies Record<OnlineCapability, string>,
    probeUnsupported: "Test séparé indisponible",
    headNoModels: (kind: string) => `Aucun modèle pour ${kind} pour l’instant · ajoutez-en un ci-dessous, sur cette clé`,
    headCustomOff: "Non connecté · personnalisé · après connexion, ajoutez des modèles par usage",
    headOff: (first: string, total: number) =>
      `Non connecté · ${first}${total > 1 ? ` et ${count(total - 1, "autre modèle", "autres modèles")}` : ""} · connectez pour tester et définir un défaut`,
    headCount: (total: number) => count(total, "modèle", "modèles"),
    headDefault: (id: string) => ` · Défaut : ${id}`,

    refresh: { models: "Actualiser les modèles", voices: "Actualiser le catalogue de voix" } satisfies Record<RefreshKind, string>,
    refreshNeedsKey: (label: string) => `${label} (connectez d’abord une clé)`,
    refreshing: { models: "Actualisation des modèles…", voices: "Actualisation du catalogue de voix…" } satisfies Record<RefreshKind, string>,
    refreshFailedLine: { models: "Impossible d’actualiser les modèles", voices: "Échec de l'actualisation des voix" } satisfies Record<RefreshKind, string>,
    builtinModels: "Liste intégrée · actualisez pour voir les modèles accessibles à cette clé",
    builtinVoices: (models: number, voices: number) =>
      `${count(models, "modèle", "modèles")} · ${count(voices, "voix", "voix")} · catalogue intégré · actualisez pour voir les voix accessibles à cette clé`,
    freshModels: (models: number, ago: string) => `${count(models, "modèle", "modèles")} · mis à jour ${ago}`,
    freshVoices: (models: number, voices: number, ago: string) =>
      `${count(models, "modèle", "modèles")} · ${count(voices, "voix", "voix")} · actualisé ${ago}`,
    unusable: (n: number) => ` · ${n} inutilisables avec cette clé`,
    refreshFailed: (message: string) => `Impossible d’actualiser : ${message}`,
    modelVoices: (n: number) => (n ? `${count(n, "voix prédéfinie", "voix prédéfinies")}` : "Aucune voix prédéfinie · test nécessitant un identifiant de voix"),
    modelSizes: (sizes: string[], max: number) =>
      `${sizes.length ? sizes.join(" / ") : "Taille définie par le service"} · jusqu’à ${count(max, "image", "images")} à la fois`,
    customTag: "Personnalisé",
    emptyProviders: "Aucun fournisseur cloud pour cette catégorie. Vous pouvez ajouter un service compatible OpenAI personnalisé.",
    noCloud: "Cette catégorie n’a aucun modèle cloud.",
  },

  textParams: {
    effort: "Effort de raisonnement",
    effortDesc:
      "Modèles avec raisonnement uniquement : niveau absent remplacé par le plus proche ; modèles non réglables l’ignorent. « Automatique » utilise le défaut du modèle.",

    effortCount: (tunable: number, total: number) => (total ? ` ${tunable} parmi les ${count(total, "modèle connecté", "modèles connectés")} sont réglables.` : ""),
    concurrency: "Requêtes simultanées",
    concurrencyDesc: (min: number, max: number) =>
      `Requêtes texte simultanées maximum par fournisseur (${min}–${max}), partagées entre traduction et génération. Réduisez en cas de limitation.`,
    saved: "Enregistré",
    failed: (message: string) => `Impossible d’enregistrer : ${message}`,
  },
  codexCard: {
    title: "Codex CLI",
    on: "Activé · abonnement Codex, sans clé · une image à la fois · taille ignorée · 5–10× plus lent",
    off: "Désactivé · activez pour le choisir en génération et comme défaut ici",
    missing: "Codex introuvable · installez Codex CLI et connectez-vous avant de dessiner.",
    switchLabel: "Dessiner avec Codex",
    toggleFailed: (enabled: boolean, message: string) => `Impossible de ${enabled ? "activé" : "désactivé"} les images Codex : ${message}`,
  },
  key: {
    title: (name: string) => `${name} · Clé API`,
    shared: (name: string, kinds: string) => `Cette clé est partagée par tous les ${name} modèles (${kinds}) ; saisissez-la une fois pour toutes les listes.`,
    sharedCustom: (name: string) =>
      `Cette clé est partagée par tous les ${name} modèles. Reconnaissance, texte, synthèse et images peuvent tous être ajoutés ; saisissez la clé une seule fois.`,
    field: 'API key',
    fieldCustom: "Laissez vide si le service n’a pas besoin de clé.",
    endpoint: (url: string) => `URL de base · ${url}`,
    keep: "Une clé est déjà enregistrée. Laissez vide pour la conserver et vérifier seulement.",
    verifyNote:
      "Avant enregistrement, requête en lecture seule au fournisseur pour vérifier la clé ; échec = non enregistrée. Clé stockée seulement localement, jamais réaffichée.",
    removeKey: 'Remove key',
    removeProvider: "Supprimer le fournisseur",
    cancel: 'Cancel',
    save: "Vérifier et enregistrer",
    saved: (name: string) => `Connexion de ${name}`,
    failed: (message: string) => message,
    removed: (name: string) => `Clé ${name} retirée`,
    providerRemoved: (name: string) => `Supprimé : ${name}`,
    removeFailed: (message: string) => `Impossible de retirer : ${message}`,
    confirmTitle: (name: string) => `Supprimer « ${name} » ?`,
    confirmBody: "Les modèles déclarés sont supprimés avec la clé. Les défauts qui y font référence sont conservés et signalés indisponibles.",
    confirm: 'Delete',
  },
  custom: {
    title: "Ajouter un fournisseur personnalisé",
    name: "Nom du fournisseur",
    url: "Socle URL",
    urlPlaceholder: "https://api.example.com/v1",
    model: "Premier identifiant de modèle",
    kind: "Choisir",
    voices: "Identifiants de voix",
    voicesPlaceholder: "Séparés par des virgules (facultatif) · ex. zh-female, zh-male",
    taken: (name: string) => `Cette URL est déjà ajoutée comme « ${name} ». Ajoutez des modèles dessous pour réutiliser la clé.`,
    takenAction: (name: string) => `Ajouter à « ${name} »`,
    note: {
      transcribe: "Doit prendre en charge la transcription audio (/v1/audio/transcriptions) ; les services de chat seuls ne reconnaissent pas la parole.",
      synthesizeSpeech: "Doit prendre en charge /v1/audio/speech ; sans identifiants de voix, vous devrez en fournir un à l’utilisation.",
      generateImage: "Doit prendre en charge /v1/images/generations ; tailles prudentes par défaut (1024 × 1024, une image à la fois).",
      generateText: "Doit prendre en charge /v1/chat/completions ; contexte et sortie prudents par défaut (32K et 4K tokens).",
    } satisfies Record<OnlineCapability, string>,

    noteHead: "Service compatible OpenAI. ",
    noteTail: " Après ajout, connectez-le (clé ou vide) et testez le modèle.",
    add: "Ajouter",
    added: (name: string) => `Ajouté : ${name} · connectez-le ensuite`,
    failed: (message: string) => `Impossible d’ajouter : ${message}`,
  },

  kindLabel: {
    transcribe: "Reconnaissance vocale · ASR",
    generateText: "Génération de texte · LLM",
    synthesizeSpeech: "Synthèse vocale · TTS",
    generateImage: "Génération d’images · Image",
  } satisfies Record<OnlineCapability, string>,
  addModel: {
    title: "Ajouter un modèle",
    model: "ID du modèle",
    taken: "Ce fournisseur a déjà cet identifiant de modèle.",
    note: "L’usage détermine la liste du modèle et si le test envoie du texte ou reçoit une image. Testez après ajout.",
    added: (id: string) => `Ajouté : ${id}`,
    failed: (message: string) => `Impossible d’ajouter le modèle : ${message}`,
  },
  probe: {
    title: {
      synthesizeSpeech: "Tester la synthèse vocale",
      generateImage: "Tester la génération d’images",
      generateText: "Tester la génération de texte",
    } as Partial<Record<OnlineCapability, string>>,
    chip: { transcribe: "ASR", synthesizeSpeech: "TTS", generateImage: "Images", generateText: "LLM" } satisfies Record<OnlineCapability, string>,
    sample: {
      synthesizeSpeech: "Texte de test · chinois simplifié",
      generateImage: "Prompt de test · une image · taille par défaut",
      generateText: "Invite de test",
    } as Partial<Record<OnlineCapability, string>>,
    voice: (voice: string) => `Voix · ${voice}`,
    voiceField: "Identifiant de voix",
    voiceDesc: "Ce modèle n’a aucune voix prédéfinie ; le test nécessite un identifiant reconnu par le fournisseur.",
    note: {
      synthesizeSpeech: "Envoie ce texte au modèle sélectionné pour synthèse et vérifie le retour audio.",
      generateImage: "Envoie ce prompt au modèle sélectionné et vérifie le retour d’une image.",
      generateText: "Envoie le prompt au modèle sélectionné et vérifie le retour de texte.",
    } as Partial<Record<OnlineCapability, string>>,
    cost: "Le fournisseur peut facturer l’utilisation. Fermer ne retire pas une requête envoyée ; test aussi dans Tâches en arrière-plan.",
    ready: "Prêt à démarrer",
    running: {
      synthesizeSpeech: "Envoi du texte et attente de l'audio…",
      generateImage: "Envoi du prompt et attente de l’image…",
      generateText: "Attente de réponse du modèle…",
    } as Partial<Record<OnlineCapability, string>>,
    done: (seconds: number | null) => (seconds !== null ? `Test réussi · ${seconds}s` : "Test réussi"),
    failed: "Échec du test",
    result: "Résultat du test",
    resultNote: "Résultat affiché ici uniquement, sans ajout à la vidéo.",

    textResultNote: "Réponse non ajoutée à la vidéo ; comme les textes générés, enregistrée en document dans Space.",
    start: "Démarrer l'essai",
    retry: "Testez à nouveau",
    testing: "Test en cours…",
    close: "Fermer",
    openFailed: (message: string) => `Impossible d’ouvrir le résultat : ${message}`,
    asrUnsupported: "Test séparé de reconnaissance vocale indisponible",
  },
  voices: {
    title: "Mes voix",
    lede:
      "Enregistrez une référence comme voix, puis choisissez-la par nom pour synthèse ou doublage ; enregistrement conservé localement. Pour un moteur cloud (ElevenLabs), envoyez d’abord la référence ici pour créer un clone. Supprimable à tout moment.",
    emptyTitle: "Aucune voix",
    emptyBody: "Choisissez une référence de 5–12 secondes ou importez un pack exporté. Une fois enregistrée, elle sera sélectionnable partout.",
  },

  quoted: (text: string) => `« ${text} »`,
};
