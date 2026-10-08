import type { ToolsTtsMessages } from './tools-tts-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const fr: ToolsTtsMessages = {
  emptyText: 'Saisissez d’abord le texte à lire',
  vibes: {
    radio: { name: 'Radio de nuit', style: 'Comme une émission de radio nocturne : un peu plus lent, avec une voix basse' },
    launch: { name: 'Lancement de produit', style: 'Un lancement de produit : plus chaleureux et énergique, en insistant sur les points clés' },
    bedtime: { name: 'Histoire du soir', style: 'Une douce histoire du soir : rythme lent, ton doux' },
    news: { name: 'Bulletin d’information', style: 'Un bulletin d’information : diction claire, rythme régulier' },
    teach: { name: 'Leçon', style: 'Expliquer comme une leçon : ton conversationnel, avec des pauses sur les points clés' },
    vlog: { name: 'Narration enjouée', style: 'Léger et enjoué, un peu plus rapide, avec un sourire dans la voix' },
  },
  statsEmpty: (max) => `0 / ${max} caractères`,
  stats: (n, max, segments, seconds) => `${n} / ${max} caractères · ${segments} ${pluralForm('fr', segments, { one: 'segment', other: 'segments' })} · environ ${seconds} s`,
  defaultVoiceOption: (name) => `Par défaut · ${name}`, customVoiceOption: 'Saisir un ID de voix…',
  presetOnly: (model) => `${model} accepte uniquement les voix prédéfinies ; Mes voix ne peut donc pas être utilisé`,
  cannotClone: (provider) => `${provider} ne peut pas cloner · utilisez ses voix prédéfinies`,
  noConsent: 'Voix personnelle ou autorisation du locuteur non déclarée ; aucun envoi à un tiers · ajoutez la déclaration dans Mes voix',
  cloneStale: (provider) => `Le clone sur ${provider} est obsolète (l’enregistrement de référence a changé) · envoyez-le à nouveau depuis Mes voix`,
  notCloned: (provider) => `Pas encore cloné sur ${provider} · envoyez-le une fois depuis Mes voix`,
  customVoice: 'Voix personnalisée', deletedVoice: 'Voix supprimée', myVoices: 'Mes voix', defaultVoice: 'Voix par défaut',
  cannotSpeak: (model, language) => `${model} ne peut pas lire en ${language}`, voiceDeleted: 'La voix sélectionnée a été supprimée ; choisissez-en une autre',
  tooLong: (model, max) => `${model} accepte au maximum ${max} caractères à la fois ; raccourcissez d’abord le texte`, enterVoiceId: 'Saisissez d’abord un ID de voix',
  pickVoice: 'Choisissez d’abord une voix', noVoices: 'Ce modèle n’a aucune voix disponible', seedInteger: 'La graine doit être un entier', noModel: 'Aucun modèle de synthèse vocale disponible',
  connectFirst: (provider) => `Connectez d’abord ${provider}`, readsMaterial: (model, voice, name) => `${model} · ${voice} · lit le texte de « ${name} »`,
  estimate: (seconds, chars) => ` · environ ${seconds} s · environ ${chars} caractères`, chars: (n) => `${n} ${pluralForm('fr', n, { one: 'caractère', other: 'caractères' })}`,
  speech: 'Voix', presetVoices: (n) => `${n} ${pluralForm('fr', n, { one: 'voix prédéfinie', other: 'voix prédéfinies' })}`, customVoiceId: 'ID de voix personnalisé',
  takesStyle: 'Accepte des indications de style', speedRange: (min, max) => `Vitesse ${min}–${max}×`, maxChars: (max) => `Au maximum ${max} caractères à la fois`,
  headerChip: (provider) => `En ligne · ${provider} · facturation à l’utilisation`,
};
