import type { TtsQuickTestMessages } from './tts-quick-test-copy.ts';

export const fr: TtsQuickTestMessages = {
  kindIntro: 'Présentation', kindNumbers: 'Nombres', kindMood: 'Ton',
  presetSub: { Vivian: 'Féminine · Lumineuse', Serena: 'Féminine · Calme', Uncle_Fu: 'Masculine · Grave', Dylan: 'Masculine · Jeune', Eric: 'Masculine · Radio', Ryan: 'Masculine · Enjouée', Aiden: 'Masculine · Narrative', Ono_Anna: 'Féminine · Japonaise', Sohee: 'Féminine · Coréenne' },
  builtinVoice: { 'zh-female': 'Féminine en chinois', 'zh-male': 'Masculine en chinois', 'en-female': 'Féminine en anglais', 'en-male': 'Masculine en anglais', 'ja-female': 'Féminine en japonais', 'ja-male': 'Masculine en japonais', 'es-female': 'Féminine en espagnol', 'es-male': 'Masculine en espagnol' },
  builtinCredit: 'Corpus FLEURS (CC BY 4.0) et CMU ARCTIC · extraits raccourcis et volume normalisé · mentions originales conservées',
  describeWarm: 'Féminine chaleureuse', describeWarmText: 'Une voix féminine adulte chaleureuse et amicale, à un rythme modéré, comme une conversation avec un ami',
  describeAnchor: 'Masculine posée', describeAnchorText: 'Une voix masculine adulte posée et claire, avec un ton de présentateur et un rythme régulier',
  describeBright: 'Jeune lumineuse', describeBrightText: 'Une voix jeune lumineuse et vive, avec un ton détendu',
  toneUpbeat: 'Enjoué', toneUpbeatText: 'Parler avec une énergie lumineuse et enjouée, un peu plus vite que d’habitude', toneNatural: 'Naturel',
  toneAnchor: 'Posé', toneAnchorText: 'Parler d’une voix de présentateur posée et claire, à un rythme régulier', toneSoft: 'Doux', toneSoftText: 'Parler doucement et plus lentement, comme dans une conversation intime',
  customDescribe: 'Décrire ma voix', defaultVoice: 'Voix par défaut', myVoices: 'Mes voix', fileVoice: 'Utiliser un extrait une fois', seconds: (n) => `${n} s`,
  textRequired: 'Saisissez d’abord le texte à synthétiser', textTooLong: (max) => `${max} caractères maximum à la fois ; utilisez une phrase plus courte pour l’aperçu`,
  describeRequired: 'Décrivez d’abord la voix souhaitée en une phrase', myVoiceGone: 'Cette voix n’est plus dans Mes voix ; choisissez-en une autre',
  referenceRequired: 'Choisissez d’abord un enregistrement de référence ou revenez à une voix intégrée',
  phaseSubmitting: 'Envoi', phaseQueued: 'En file d’attente', phaseLoading: 'Chargement du modèle', phaseGeneratingStep: (step, total) => `Génération de l’audio · étape ${step}/${total}`,
  phaseGenerating: 'Génération de l’audio', phaseWriting: 'Écriture de l’audio', phasePreparing: 'Préparation', sampleVoice: (name) => `Exemple · ${name}`, customText: 'Texte personnalisé',
  elapsed: (seconds) => `Durée : ${seconds} s`, audioLength: (seconds) => `Audio ${seconds} s`,
};
