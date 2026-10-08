import type { VoicePickerMessages } from './voice-picker.ts';

export const fr: VoicePickerMessages = {
  clonedOn: (provider) => `Cloné sur ${provider} · synthèse avec ce clone`, defaultVoice: 'Voix par défaut', providerPreset: (provider, name) => `${name} de ${provider}`,
  loadingMine: 'Chargement de Mes voix…', cloneNew: 'Cloner une nouvelle voix…',
  cloneNewHint: 'Enregistrez une voix ou importez un fichier dans Réglages › Modèles › Synthèse vocale › Mes voix', myVoices: 'Mes voix',
  providerVoices: (provider) => `Voix de ${provider}`, customVoice: 'Saisir un ID de voix…', customVoiceHint: 'Un ID de voix de votre compte fournisseur',
  tempReference: 'Utiliser un enregistrement une fois…', tempReferenceHint: 'L’API de synthèse de cette version n’accepte pas encore d’enregistrement de référence ponctuel · enregistrez-le dans Mes voix et clonez-le d’abord',
  other: 'Autre', voiceDeleted: 'Cette voix a été supprimée · choisissez-en une autre ou revenez à la voix par défaut',
  customLine: 'Transmis tel quel au fournisseur pour vérification ; vous pouvez aussi créer une voix clonée dans Mes voix et la choisir',
  presetLine: (provider, voiceId) => voiceId === null ? `Voix de ${provider}` : `Voix de ${provider} · ${voiceId}`,
  defaultLine: (provider, name) => `Sans sélection, la voix par défaut de ${provider} (${name}) est utilisée`, noDefault: 'Ce modèle n’a pas de voix par défaut ; choisissez-en une d’abord',
};
