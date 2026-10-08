import type { TtsLocalMessages } from './tts-local-copy.ts';

export const fr: TtsLocalMessages = {
  ttsLocal: {

    unset: "Non défini",
    defaultDesc: "Présélectionné pour les nouvelles synthèses. Sans défaut, choix à chaque fois ; choix manuel prioritaire.",
    cloudDefault: (name: string) =>
      `Le défaut est un modèle cloud (${name}) ; changez-le dans Réglages › Modèles cloud. Choisir un modèle local le remplace.`,
    noInstalled: "Aucun modèle de synthèse installé. Téléchargez-en un ci-dessous.",

    audition: "Aperçu",
    hideAudition: "Masquer l’aperçu",
    engine: "Moteur",
    license: "Licence",
    components: "Composants",

    licenseTitle: "Licence",
    licenseUse: "Sa parole est réservée aux contenus non commerciaux ; choisissez un autre modèle pour un usage commercial.",
    licenseConfirm: (size: string) => `J’ai compris, télécharger ${size}`,

    voice: "Voix",
    tone: "Ton",
    say: "Texte à prononcer",
    lines: "Répliques",
    more: "Autres voix",
    cloneNew: "Cloner une nouvelle voix…",
    writeOwn: "Écrire mon texte",
    ownPlaceholder: "Saisissez une phrase à écouter",
    ownLabel: "Texte d’aperçu",
    describeLabel: "Description de voix",
    describePlaceholder: "ex. voix masculine âgée, grave et posée",
    builtinRef: (label: string, seconds: number | null) =>
      `Enregistrement de référence · ${label}${seconds !== null ? ` · ${seconds}s` : ""} · transcription incluse automatiquement`,
    describedBuiltin: (label: string) => `Voix depuis description · utilise celle de « ${label} »`,
    describePreset: (text: string) => `Description : ${text}`,
    myVoice: (name: string) => `Mes voix · ${name} · clonée depuis sa référence et sa transcription`,
    presetOnly: (models: string | null) =>
      models
        ? `Ce modèle a seulement ses locuteurs intégrés · essayez Mes voix avec un modèle de clonage : ${models} (aperçu sur sa ligne)`
        : "Ce modèle a seulement ses locuteurs intégrés · téléchargez un modèle de clonage pour essayer Mes voix",

    nameList: (names: readonly string[]) => names.join(", "),
    cloneHint: "Fournissez 5–15 secondes de parole propre : une personne, sans musique. WAV, MP3, M4A, FLAC ou vidéo conviennent.",
    yourFile: (name: string) => `Votre enregistrement · ${name}`,
    sampleFile: (label: string) => `Échantillon · ${label} · fourni avec BaoCut, aucun fichier à chercher`,
    pickFile: "Choisir un enregistrement…",
    changeFile: "Choisissez-en un autre…",
    useSample: "Utiliser l’échantillon",
    crossLang: "Fonctionne entre langues : une référence chinoise peut lire l’anglais.",
    noPicker:
      "Le navigateur ne peut pas choisir des fichiers locaux. Pour une référence ponctuelle, utilisez l’application de bureau ; sinon échantillon ou enregistrement dans Mes voix.",
    pickTitle: "Choisir une référence",
    pickButton: "Choisir",
    pickFilter: "Audio ou vidéo",
    transcriptLabel: "Transcription de la référence (facultatif)",
    transcriptHint: "Écrire le contenu de la référence améliore la ressemblance",
    fileChip: (name: string, sample: boolean) => (sample ? `Échantillon · ${name}` : name),
    generate: "Générer un aperçu",
    again: "Générer à nouveau",
    cancel: "Annuler",
    busy: (phase: string) => `Synthèse · ${phase}`,
    stalePrefix: "Précédent · ",
    stale: "Ce clip utilise vos anciens choix. Après changement de voix ou texte, cliquez « Générer un aperçu » pour le nouveau.",
    download: "Télécharger",
    resultLabel: "Résultat d’aperçu",
    credit: (credit: string) => `Référence vocale intégrée : ${credit}`,
    loadingAudio: "Chargement de l’audio…",
    audioFailed: (message: string) => `Impossible de charger l’audio : ${message}`,
    downloadFailed: (message: string) => `Impossible de télécharger : ${message}`,
    fileName: (name: string) => `${name.replace(/[^\w.-]+/g, "-")}-preview.wav`,

    handoffFrom: (name: string) => `Depuis l’aperçu « ${name} » · enregistrez ou extrayez d’une vidéo ; retour après sauvegarde`,
    handoffSaved: (name: string) => `Enregistré · revenez à l’aperçu « ${name} » où cette voix sera sélectionnée`,
    handoffBack: "Revenir et l’utiliser",
    handoffCancel: "Non merci, revenir",
    auditionClone: "Aperçu du clone",
    auditionCloneLabel: (name: string) => `Aperçu du clone · ${name}`,
    noCloneModel:
      "Aucun modèle local de clonage installé. Téléchargez-en un sur la page locale (IndexTTS2, Qwen3-TTS Base, GPT-SoVITS…).",
    goLocal: "Aller aux modèles locaux",
  },
};
